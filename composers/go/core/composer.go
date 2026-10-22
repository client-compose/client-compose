package clientcompose

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"sync"
	"time"
)

// Request is what layouts, conditions and resolvers see. Auth, tracing and other per-request values
// travel on the context.Context, put there by Config.Context or a plugin.
type Request struct {
	// Screen is the screen being composed.
	Screen string
	Params map[string]string
	Client ClientContext
}

// Island is one resolvable version of an island type. Build one with Define (or NewIsland).
type Island struct {
	Type    string
	Version int
	resolve func(ctx context.Context, r Request) (any, error)
	// cache, if set with CacheFor, caches the island's props when the composer has a Cache.
	cache *islandCache
}

// NewIsland defines how to resolve the props for one version of an island, for props types that
// codegen didn't generate. Prefer Define.
func NewIsland[P any](typ string, version int, resolve func(ctx context.Context, r Request) (P, error)) Island {
	return Island{
		Type:    typ,
		Version: version,
		resolve: func(ctx context.Context, r Request) (any, error) { return resolve(ctx, r) },
	}
}

// Props is implemented by generated island props types (see codegen/), tying a Go type
// to its island type and version.
type Props interface {
	IslandType() string
	IslandVersion() int
}

// Define defines how to resolve one island version, by its generated props type: the island type
// and version come from P, so they can't drift from the manifest.
//
//	header := cc.Define(func(ctx context.Context, r cc.Request) (ProfileHeaderV2, error) { ... })
func Define[P Props](resolve func(ctx context.Context, r Request) (P, error)) Island {
	var zero P
	return NewIsland(zero.IslandType(), zero.IslandVersion(), resolve)
}

// Versions lists the versions of an island a placement can resolve.
func Versions(islands ...Island) []Island { return islands }

// Placement puts an island on a screen.
type Placement struct {
	// Key is unique on the screen and stable across requests.
	Key string
	// Versions lists every version the composer can resolve; the highest the client also
	// supports is used (spec §4.2).
	Versions []Island
	// Required fails the whole screen when the island can't be placed or fails (spec §4.3).
	Required bool
	// Timeout overrides Config.DefaultTimeout for this island.
	Timeout time.Duration
	// When, if set, decides per request whether the island appears. Its loads are shared with the
	// islands'. An error is handled like a Layout's: ErrNotFound, ErrUnauthenticated and ErrForbidden
	// answer 404, 401 and 403, and anything else fails the screen.
	When func(ctx context.Context, r Request) (bool, error)
}

// Static places an island whose props are known up front: a form, a button, a heading.
func Static[P Props](key string, props P) Placement {
	island := Define(func(context.Context, Request) (P, error) { return props, nil })
	return Placement{Key: key, Versions: []Island{island}}
}

// Screen is what a screen is made of.
type Screen struct {
	ID string
	// Requires must all hold before anything else runs (401 or 403 otherwise).
	Requires []Requirement
	// Islands are the screen's islands, in order. Set either Islands or Layout.
	Islands []Placement
	// Layout decides the islands per request, for screens that can't be declared up front (a CMS,
	// an experiment). Return an error wrapping ErrNotFound when what the params refer to doesn't
	// exist (404 not_found), or ErrUnauthenticated / ErrForbidden (401 / 403).
	Layout func(ctx context.Context, r Request) ([]Placement, error)
	// Meta optionally describes the screen as a whole. It runs alongside the islands and shares
	// their Loads; if it fails, the response has no meta and the islands are unaffected.
	Meta func(ctx context.Context, r Request) (ScreenMeta, error)
	// CacheMaxAge is the cache hint clients get (spec §4).
	CacheMaxAge time.Duration
}

// Config is everything a composer is made of.
type Config struct {
	Screens []Screen
	Actions []Action
	// Context turns each HTTP request into the context everything else receives, as a Plugin's
	// Context does. It runs before the plugins'.
	Context func(ctx context.Context, r *http.Request) (context.Context, error)
	// Use lists plugins, outermost first.
	Use []Plugin
	// Cache, if set, serves islands that opt in with Island.CacheFor (CMP-18). Without it, every
	// island resolves on every request.
	Cache Cache
	// DefaultTimeout is each island's timeout unless its placement sets one. Default 2s.
	DefaultTimeout time.Duration
}

// Result is a status code and a JSON-serialisable body (ScreenResponse, ActionResponse or
// ErrorResponse).
type Result struct {
	Status int
	Body   any
}

// Composer composes screens and performs actions. It's an http.Handler serving
// POST /screens/{screen} and POST /actions/{action}.
type Composer struct {
	screens        map[string]Screen
	actions        map[string]map[int]Action
	plugins        []Plugin
	cache          Cache
	defaultTimeout time.Duration
	mux            *http.ServeMux
	compose        ComposeFunc
	perform        PerformFunc
	resolve        ResolveFunc
}

// New builds a composer. It panics on mistakes in the config: two screens with one id, an action
// version registered twice, or a screen with both or neither of Islands and Layout.
func New(cfg Config) *Composer {
	c := &Composer{
		screens:        map[string]Screen{},
		actions:        map[string]map[int]Action{},
		defaultTimeout: cfg.DefaultTimeout,
		cache:          cfg.Cache,
	}
	if c.defaultTimeout == 0 {
		c.defaultTimeout = 2 * time.Second
	}
	for _, s := range cfg.Screens {
		if _, dup := c.screens[s.ID]; dup {
			panic(fmt.Sprintf("clientcompose: screen %q registered twice", s.ID))
		}
		if (s.Layout == nil) == (s.Islands == nil) {
			panic(fmt.Sprintf("clientcompose: screen %q needs either Islands or Layout", s.ID))
		}
		c.screens[s.ID] = s
	}
	for _, a := range cfg.Actions {
		if c.actions[a.Name] == nil {
			c.actions[a.Name] = map[int]Action{}
		}
		if _, dup := c.actions[a.Name][a.Version]; dup {
			panic(fmt.Sprintf("clientcompose: action %s v%d registered twice", a.Name, a.Version))
		}
		c.actions[a.Name][a.Version] = a
	}
	if cfg.Context != nil {
		c.plugins = append(c.plugins, Plugin{Context: cfg.Context})
	}
	c.plugins = append(c.plugins, cfg.Use...)

	c.compose, c.perform, c.resolve = c.composeScreen, c.performAction, c.resolveIsland
	for i := len(c.plugins) - 1; i >= 0; i-- {
		p := c.plugins[i]
		if p.Screen != nil {
			c.compose = p.Screen(c.compose)
		}
		if p.Action != nil {
			c.perform = p.Action(c.perform)
		}
		if p.Island != nil {
			c.resolve = p.Island(c.resolve)
		}
	}
	c.mux = c.routes()
	return c
}

func fail(status int, code, message string) Result {
	return Result{status, ErrorResponse{Protocol: ProtocolVersion, Error: IslandError{Code: code, Message: message}}}
}

// Negotiate returns the highest version both sides support (spec §4.2).
func Negotiate(versions []Island, supported []int) (Island, bool) {
	var best Island
	found := false
	for _, v := range versions {
		for _, s := range supported {
			if v.Version == s && (!found || v.Version > best.Version) {
				best, found = v, true
			}
		}
	}
	return best, found
}

// Compose composes a screen in-process, through the plugins' Screen and Island hooks. The context
// should already carry what Config.Context would add. Most callers serve HTTP instead; tests use
// cctest.
func (c *Composer) Compose(ctx context.Context, req ScreenRequest) Result {
	if req.Protocol == nil || *req.Protocol != ProtocolVersion {
		return fail(http.StatusBadRequest, "unsupported_protocol", fmt.Sprintf("composer speaks protocol %d", ProtocolVersion))
	}
	if _, ok := c.screens[req.Screen]; !ok {
		return fail(http.StatusNotFound, "unknown_screen", req.Screen)
	}
	if req.Client == nil {
		req.Client = &ClientContext{}
	}
	return c.compose(ctx, req)
}

// protocolError is the response for ErrNotFound, ErrUnauthenticated and ErrForbidden, if err is
// one of them.
func protocolError(err error) (Result, bool) {
	switch {
	case errors.Is(err, ErrNotFound):
		return fail(http.StatusNotFound, "not_found", ""), true
	case errors.Is(err, ErrUnauthenticated):
		return fail(http.StatusUnauthorized, "unauthenticated", ""), true
	case errors.Is(err, ErrForbidden):
		return fail(http.StatusForbidden, "forbidden", ""), true
	}
	return Result{}, false
}

func (c *Composer) composeScreen(ctx context.Context, req ScreenRequest) Result {
	screen := c.screens[req.Screen]

	// Shared loads (Load, BatchLoader) live as long as this request; whatever is still running when
	// the response is ready is cancelled.
	ctx, endRequest := withRequestScope(ctx)
	defer endRequest()

	r := Request{Screen: screen.ID, Params: req.Params, Client: *req.Client}
	if r.Params == nil {
		r.Params = map[string]string{}
	}
	placements, err := c.placements(ctx, screen, r)
	if err != nil {
		if res, ok := protocolError(err); ok {
			return res
		}
		c.report(ctx, Failure{Kind: LayoutFailed, Screen: screen.ID, Err: err})
		return fail(http.StatusInternalServerError, "layout_failed", "")
	}

	// Started now so it runs alongside the islands (and can share their Loads).
	metaDone := make(chan *ScreenMeta, 1)
	go func() { metaDone <- c.meta(ctx, screen, r) }()

	type placed struct {
		p      Placement
		island Island
	}
	var toResolve []placed
	for _, p := range placements {
		if len(p.Versions) == 0 {
			continue
		}
		island, ok := Negotiate(p.Versions, req.Islands[p.Versions[0].Type])
		if !ok {
			if p.Required {
				return fail(http.StatusBadGateway, "required_island_unsupported", p.Key)
			}
			continue
		}
		toResolve = append(toResolve, placed{p, island})
	}

	entries := make([]IslandEntry, len(toResolve))
	var wg sync.WaitGroup
	for i, t := range toResolve {
		wg.Add(1)
		go func() {
			defer wg.Done()
			entries[i] = c.resolveEntry(ctx, t.p, t.island, r)
		}()
	}
	wg.Wait()

	for i, e := range entries {
		if e.Status == "error" && toResolve[i].p.Required {
			return fail(http.StatusBadGateway, "required_island_failed", e.Key)
		}
	}

	resp := ScreenResponse{Protocol: ProtocolVersion, Screen: screen.ID, Islands: entries, Meta: <-metaDone}
	if screen.CacheMaxAge > 0 {
		resp.Cache = &CacheHint{MaxAge: int(screen.CacheMaxAge.Seconds())}
	}
	return Result{http.StatusOK, resp}
}

// placements checks the screen's requirements, then lays it out: its declared islands that show
// for this request, or what its Layout returns.
func (c *Composer) placements(ctx context.Context, screen Screen, r Request) (out []Placement, err error) {
	defer func() {
		if rec := recover(); rec != nil {
			err = fmt.Errorf("layout panicked: %v", rec)
		}
	}()
	if err := check(ctx, screen.Requires, r); err != nil {
		return nil, err
	}
	if screen.Layout != nil {
		return screen.Layout(ctx, r)
	}
	for _, p := range screen.Islands {
		show := true
		if p.When != nil {
			if show, err = p.When(ctx, r); err != nil {
				return nil, err
			}
		}
		if show {
			out = append(out, p)
		}
	}
	return out, nil
}

func (c *Composer) meta(ctx context.Context, screen Screen, r Request) (out *ScreenMeta) {
	if screen.Meta == nil {
		return nil
	}
	defer func() {
		if rec := recover(); rec != nil {
			c.report(ctx, Failure{Kind: MetaFailed, Screen: screen.ID, Err: fmt.Errorf("meta panicked: %v", rec)})
			out = nil
		}
	}()
	meta, err := screen.Meta(ctx, r)
	if err != nil {
		c.report(ctx, Failure{Kind: MetaFailed, Screen: screen.ID, Err: err})
		return nil
	}
	if meta == (ScreenMeta{}) {
		return nil // nothing to say: omit meta
	}
	return &meta
}

func (c *Composer) resolveEntry(parent context.Context, p Placement, island Island, r Request) IslandEntry {
	entry := IslandEntry{Key: p.Key, Type: island.Type, Version: island.Version}
	timeout := p.Timeout
	if timeout == 0 {
		timeout = c.defaultTimeout
	}
	ctx, cancel := context.WithTimeout(parent, timeout)
	defer cancel()

	type outcome struct {
		props any
		err   error
	}
	done := make(chan outcome, 1)
	go func() {
		defer func() {
			if rec := recover(); rec != nil {
				done <- outcome{err: fmt.Errorf("island panicked: %v", rec)}
			}
		}()
		props, err := c.resolve(ctx, IslandCall{Screen: r.Screen, Key: p.Key, Island: island, Request: r})
		done <- outcome{props, err}
	}()

	var err error
	select {
	case o := <-done:
		if o.err == nil {
			entry.Status = "ok"
			entry.Props = o.props
			if entry.Props == nil {
				entry.Props = map[string]any{}
			}
			return entry
		}
		err = o.err
	case <-ctx.Done():
		err = ctx.Err()
	}

	c.report(parent, Failure{Kind: IslandFailed, Screen: r.Screen, Key: p.Key, Type: island.Type, Err: err})
	entry.Status = "error"
	if errors.Is(ctx.Err(), context.DeadlineExceeded) && parent.Err() == nil {
		entry.Error = &IslandError{Code: "timeout", Retryable: true}
	} else {
		entry.Error = &IslandError{Code: "resolve_failed"}
	}
	return entry
}

// Islands lists the island types and versions placed by screens with declared Islands, as a client
// would declare them (spec §3). Test kits use it to ask for every island; screens with a Layout
// aren't included, because their islands are only known per request.
func (c *Composer) Islands() map[string][]int {
	out := map[string][]int{}
	for _, s := range c.screens {
		for _, p := range s.Islands {
			for _, v := range p.Versions {
				if !slices.Contains(out[v.Type], v.Version) {
					out[v.Type] = append(out[v.Type], v.Version)
				}
			}
		}
	}
	for _, versions := range out {
		slices.Sort(versions)
	}
	return out
}
