package clientcompose

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"slices"
)

// ErrUnauthenticated is returned (or wrapped) by a layout or action when there's no signed-in user
// and it needs one. The client gets 401 unauthenticated.
var ErrUnauthenticated = errors.New("clientcompose: unauthenticated")

// ErrForbidden is returned (or wrapped) by a layout or action when the user may not see or do it.
// The client gets 403 forbidden.
var ErrForbidden = errors.New("clientcompose: forbidden")

// Call is what an action handler sees besides its input. Auth, tracing and other per-request
// values travel on the context.Context, as for screens.
type Call struct {
	Client ClientContext
	// IdempotencyKey is the client's key for this user intent, if it sent one (spec §5.2). Honouring
	// it (returning the first outcome again instead of repeating the change) is up to the action.
	IdempotencyKey string
}

// ScreenRef refers to screens: those with this id whose params include all of Params (spec §5.3).
type ScreenRef struct {
	Screen string            `json:"screen"`
	Params map[string]string `json:"params,omitempty"`
}

// Effects tells clients what a successful action changed (spec §5.3).
type Effects struct {
	// Invalidate lists screens whose content may have changed. Clients reload the ones on show.
	Invalidate []ScreenRef `json:"invalidate,omitempty"`
	// Navigate suggests a screen to show next. Clients map it to their own routes.
	Navigate *ScreenRef `json:"navigate,omitempty"`
}

func (e Effects) empty() bool { return len(e.Invalidate) == 0 && e.Navigate == nil }

// ActionInput is implemented by generated action input types (see codegen/). It ties the input to
// its action, version, schema, declared errors and result type R.
type ActionInput[R any] interface {
	ActionName() string
	ActionVersion() int
	ActionInputSchema() string
	ActionErrorCodes() []string
	ActionResult(R)
}

// declaredError is implemented by generated declared-error types.
type declaredError interface {
	error
	ActionErrorCode() string
	ActionErrorDetails() any
	ActionErrorOf() (action string, version int)
}

// declares reports whether err is one of this action version's own declared errors.
func (a Action) declares(err declaredError) bool {
	name, version := err.ActionErrorOf()
	return name == a.Name && version == a.Version && slices.Contains(a.errors, err.ActionErrorCode())
}

// Action is one version of an action. Build one with DefineAction.
type Action struct {
	Name    string
	Version int
	schema  *schema
	errors  []string
	run     func(ctx context.Context, call Call, input json.RawMessage) (any, Effects, error)
}

// DefineAction defines how to perform one action version, using its generated types. Return the
// generated error types for this version's declared errors, and ErrNotFound, ErrUnauthenticated or ErrForbidden
// (possibly wrapped) for those protocol errors. Any other error is a failure: the client gets 500
// action_failed and the composer's action error handler is called.
//
//	follow := cc.DefineAction(func(ctx context.Context, call cc.Call, in FollowUserV1Input) (FollowUserV1Result, cc.Effects, error) {
//		...
//		return FollowUserV1Result{Followers: n}, cc.Effects{Invalidate: []cc.ScreenRef{{Screen: "feed"}}}, nil
//	})
func DefineAction[I ActionInput[R], R any](handle func(ctx context.Context, call Call, input I) (R, Effects, error)) Action {
	var zero I
	s, err := parseSchema(zero.ActionInputSchema())
	if err != nil {
		panic(fmt.Sprintf("clientcompose: action %s v%d has an invalid input schema: %v", zero.ActionName(), zero.ActionVersion(), err))
	}
	return Action{
		Name:    zero.ActionName(),
		Version: zero.ActionVersion(),
		schema:  s,
		errors:  zero.ActionErrorCodes(),
		run: func(ctx context.Context, call Call, raw json.RawMessage) (any, Effects, error) {
			var input I
			if err := json.Unmarshal(raw, &input); err != nil {
				return nil, Effects{}, fmt.Errorf("decoding validated input: %w", err)
			}
			return handle(ctx, call, input)
		},
	}
}

// WithActions registers actions alongside the composer's screens. Registering one action version
// twice panics.
func WithActions(actions ...Action) Option {
	return func(c *Composer) {
		for _, a := range actions {
			if c.actions[a.Name] == nil {
				c.actions[a.Name] = map[int]Action{}
			}
			if _, dup := c.actions[a.Name][a.Version]; dup {
				panic(fmt.Sprintf("clientcompose: action %s v%d registered twice", a.Name, a.Version))
			}
			c.actions[a.Name][a.Version] = a
		}
	}
}

// WithActionErrorHandler is called when an action fails with an error that isn't a declared error
// or protocol error (the client gets 500 action_failed).
func WithActionErrorHandler(fn func(ctx context.Context, action string, version int, err error)) Option {
	return func(c *Composer) { c.onActionError = fn }
}

// ActionRequest is the body a client POSTs to /actions/{action}.
type ActionRequest struct {
	Protocol       *int            `json:"protocol"`
	Action         string          `json:"action"`
	Version        int             `json:"version"`
	Input          json.RawMessage `json:"input"`
	Client         *ClientContext  `json:"client"`
	IdempotencyKey string          `json:"idempotencyKey,omitempty"`
}

// ActionError is a declared error in an action response.
type ActionError struct {
	Code    string `json:"code"`
	Message string `json:"message,omitempty"`
	Details any    `json:"details,omitempty"`
}

// ActionResponse is the body of a 200 action response: the action ran and this is its outcome.
type ActionResponse struct {
	Protocol int          `json:"protocol"`
	Action   string       `json:"action"`
	Version  int          `json:"version"`
	Status   string       `json:"status"`
	Result   any          `json:"result,omitempty"`
	Effects  *Effects     `json:"effects,omitempty"`
	Error    *ActionError `json:"error,omitempty"`
}

// Perform runs an action. Most callers use Handler or PerformHTTP instead.
func (c *Composer) Perform(ctx context.Context, req ActionRequest) Result {
	if req.Protocol == nil || *req.Protocol != ProtocolVersion {
		return fail(http.StatusBadRequest, "unsupported_protocol", fmt.Sprintf("composer speaks protocol %d", ProtocolVersion))
	}
	versions, ok := c.actions[req.Action]
	if !ok {
		return fail(http.StatusNotFound, "unknown_action", req.Action)
	}
	action, ok := versions[req.Version]
	if !ok {
		return fail(http.StatusNotFound, "unsupported_action_version", fmt.Sprintf("%s v%d", req.Action, req.Version))
	}
	if err := validateJSON(action.schema, req.Input); err != nil {
		return fail(http.StatusBadRequest, "invalid_input", err.Error())
	}

	ctx, endRequest := withRequestScope(ctx)
	defer endRequest()
	call := Call{IdempotencyKey: req.IdempotencyKey}
	if req.Client != nil {
		call.Client = *req.Client
	}

	result, effects, err := runAction(ctx, action, call, req.Input)
	respond := func(status string) ActionResponse {
		return ActionResponse{Protocol: ProtocolVersion, Action: action.Name, Version: action.Version, Status: status}
	}
	if err == nil {
		resp := respond("ok")
		resp.Result = result
		if resp.Result == nil {
			resp.Result = map[string]any{}
		}
		if !effects.empty() {
			resp.Effects = &effects
		}
		return Result{http.StatusOK, resp}
	}

	var declared declaredError
	switch {
	case errors.As(err, &declared) && action.declares(declared):
		resp := respond("error")
		resp.Error = &ActionError{Code: declared.ActionErrorCode(), Details: declared.ActionErrorDetails()}
		return Result{http.StatusOK, resp}
	case errors.Is(err, ErrNotFound):
		return fail(http.StatusNotFound, "not_found", "")
	case errors.Is(err, ErrUnauthenticated):
		return fail(http.StatusUnauthorized, "unauthenticated", "")
	case errors.Is(err, ErrForbidden):
		return fail(http.StatusForbidden, "forbidden", "")
	}
	if c.onActionError != nil {
		c.onActionError(ctx, action.Name, action.Version, err)
	}
	return fail(http.StatusInternalServerError, "action_failed", "")
}

func runAction(ctx context.Context, action Action, call Call, input json.RawMessage) (result any, effects Effects, err error) {
	defer func() {
		if rec := recover(); rec != nil {
			err = fmt.Errorf("action panicked: %v", rec)
		}
	}()
	return action.run(ctx, call, input)
}
