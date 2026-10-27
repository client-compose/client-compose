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
	// words are the catalog's in the client's language, for ScreenStrings.
	words *LocaleStrings
}

// ScreenStrings returns screen strings (spec §4.7) in the client's language, for words an action's
// result carries. Generated screen strings types read them: SearchScreenStringsFor(call).Creators().
func (c Call) ScreenStrings(screen string) StringsTable { return c.words.table(screen) }

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
	// requires must all hold before the input is validated and the handler runs.
	requires []Requirement
	schema   *schema
	errors   []string
	run      func(ctx context.Context, call Call, input json.RawMessage) (any, Effects, error)
}

// Requires returns the action with requirements that must hold before it runs (401 or 403
// otherwise):
//
//	follow := cc.DefineAction(followUser).Requires(signedIn)
func (a Action) Requires(requirements ...Requirement) Action {
	a.requires = append(append([]Requirement(nil), a.requires...), requirements...)
	return a
}

// DefineAction defines how to perform one action version, using its generated types. Return the
// generated error types for this version's declared errors, and ErrNotFound, ErrUnauthenticated or ErrForbidden
// (possibly wrapped) for those protocol errors. Any other error is a failure: the client gets 500
// action_failed, and plugins' Error hooks are told.
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

// Perform performs an action in-process, through the plugins' Action hooks. The context should
// already carry what Config.Context would add. Most callers serve HTTP instead; tests use cctest.
func (c *Composer) Perform(ctx context.Context, req ActionRequest) Result {
	if req.Protocol == nil || *req.Protocol != ProtocolVersion {
		return fail(http.StatusBadRequest, "unsupported_protocol", fmt.Sprintf("composer speaks protocol %d", ProtocolVersion))
	}
	versions, ok := c.actions[req.Action]
	if !ok {
		return fail(http.StatusNotFound, "unknown_action", req.Action)
	}
	if _, ok := versions[req.Version]; !ok {
		return fail(http.StatusNotFound, "unsupported_action_version", fmt.Sprintf("%s v%d", req.Action, req.Version))
	}
	return c.perform(ctx, req)
}

func (c *Composer) performAction(ctx context.Context, req ActionRequest) Result {
	action := c.actions[req.Action][req.Version]
	ctx, endRequest := withRequestScope(ctx)
	defer endRequest()

	var client ClientContext
	if req.Client != nil {
		client = *req.Client
	}
	if err := check(ctx, action.requires, Request{Client: client, Params: map[string]string{}}); err != nil {
		if res, ok := protocolError(err); ok {
			return res
		}
		c.report(ctx, Failure{Kind: ActionFailed, Action: action.Name, Version: action.Version, Err: err})
		return fail(http.StatusInternalServerError, "action_failed", "")
	}
	if err := validateJSON(action.schema, req.Input); err != nil {
		return fail(http.StatusBadRequest, "invalid_input", err.Error())
	}
	call := Call{IdempotencyKey: req.IdempotencyKey, Client: client, words: c.words(client.Locale)}

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
	if errors.As(err, &declared) && action.declares(declared) {
		resp := respond("error")
		resp.Error = &ActionError{Code: declared.ActionErrorCode(), Details: declared.ActionErrorDetails()}
		return Result{http.StatusOK, resp}
	}
	if res, ok := protocolError(err); ok {
		return res
	}
	c.report(ctx, Failure{Kind: ActionFailed, Action: action.Name, Version: action.Version, Err: err})
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
