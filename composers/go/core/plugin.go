package clientcompose

import (
	"context"
	"net/http"
)

// A Plugin hooks into a composer (spec/CAPABILITIES.md, "Extension points"). Set the hooks you
// need and leave the rest nil. Plugins run in the order they're listed in Config.Use: the first
// is the outermost.
//
//	tracing := cc.Plugin{
//		Island: func(next cc.ResolveFunc) cc.ResolveFunc {
//			return func(ctx context.Context, call cc.IslandCall) (any, error) {
//				ctx, span := tracer.Start(ctx, call.Island.Type)
//				defer span.End()
//				return next(ctx, call)
//			}
//		},
//	}
type Plugin struct {
	// Context runs once per HTTP request, before anything else, and returns the context every
	// requirement, layout, island and action of that request receives: the viewer from a session
	// or token, their locale, a tenant. Return an error wrapping ErrUnauthenticated or ErrForbidden
	// to answer 401 or 403 straight away.
	Context func(ctx context.Context, r *http.Request) (context.Context, error)
	// Screen wraps composing a whole screen: requirements, layout, islands and meta.
	Screen func(next ComposeFunc) ComposeFunc
	// Island wraps resolving one island version.
	Island func(next ResolveFunc) ResolveFunc
	// Action wraps performing an action: requirements, input validation and the handler.
	Action func(next PerformFunc) PerformFunc
	// Error is told about every failure: an island, a layout, a screen's meta, an action or a
	// context function. The client has already been answered; this is for logs and error tracking.
	Error func(ctx context.Context, f Failure)
}

// ComposeFunc composes a screen.
type ComposeFunc func(ctx context.Context, req ScreenRequest) Result

// PerformFunc performs an action.
type PerformFunc func(ctx context.Context, req ActionRequest) Result

// ResolveFunc resolves one island version's props.
type ResolveFunc func(ctx context.Context, call IslandCall) (any, error)

// IslandCall is one island version being resolved on a screen.
type IslandCall struct {
	Screen string
	// Key is the island's key on the screen.
	Key     string
	Island  Island
	Request Request
}

// FailureKind says what failed.
type FailureKind string

const (
	IslandFailed  FailureKind = "island"
	LayoutFailed  FailureKind = "layout"
	MetaFailed    FailureKind = "meta"
	ActionFailed  FailureKind = "action"
	ContextFailed FailureKind = "context"
)

// Failure is something that went wrong while answering a request.
type Failure struct {
	Kind FailureKind
	// Screen is set for island, layout and meta failures.
	Screen string
	// Key and Type are set for island failures.
	Key, Type string
	// Action and Version are set for action failures.
	Action  string
	Version int
	Err     error
}

// ReportErrors is a plugin that passes every failure to report, e.g. to log it.
func ReportErrors(report func(ctx context.Context, f Failure)) Plugin {
	return Plugin{Error: report}
}

// A Requirement must hold before a screen's islands or an action's handler run (CMP-16). Return an
// error wrapping ErrUnauthenticated, ErrForbidden or ErrNotFound; the client gets 401, 403 or 404.
// Requirements read what a Context function put on the context, and, for screens, the request's
// params:
//
//	var signedIn cc.Requirement = func(ctx context.Context, _ cc.Request) error {
//		if _, ok := viewerFrom(ctx); !ok {
//			return cc.ErrUnauthenticated
//		}
//		return nil
//	}
//
//	// 404 for a recipe that doesn't exist, 403 unless the viewer may edit it.
//	editsRecipe := func(ctx context.Context, r cc.Request) error {
//		_, err := recipes.Editable(ctx, r.Params["recipeId"])
//		return err
//	}
//
// For an action, the request has its client context but no params: check the input in the action.
type Requirement func(ctx context.Context, r Request) error

func check(ctx context.Context, requirements []Requirement, req Request) error {
	for _, r := range requirements {
		if err := r(ctx, req); err != nil {
			return err
		}
	}
	return nil
}

func (c *Composer) report(ctx context.Context, f Failure) {
	for _, p := range c.plugins {
		if p.Error != nil {
			p.Error(ctx, f)
		}
	}
}
