package clientcompose

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"time"
)

// Request is what layouts, conditions and resolvers see. Auth, tracing and other per-request values
// travel on the context.Context, put there by Config.Context or a plugin.
type Request struct {
	// Screen is the screen being composed.
	Screen string
	Params map[string]string
	Client ClientContext
	// Cursor is the page an island request asks for (spec §4.5): an island's own Next, from an
	// earlier page. It's empty for a screen, and for an island's first page.
	Cursor string
}

// Island is one resolvable version of an island type. Build one with Define (or NewIsland).
type Island struct {
	Type    string
	Version int
	resolve func(ctx context.Context, r Request) (any, error)
	// cache, if set with CacheFor, caches the island's props when the composer has a Cache.
	cache *islandCache
	// paged islands resolve to a page: their props, and the cursor of the page after (DefinePaged).
	paged bool
}

// page is what a paged island resolves to.
type page struct {
	props any
	next  string
}

// ErrInvalidCursor means a paged island can't read the cursor it was given: one it didn't make, or
// one that's no longer good. The client gets 400 invalid_cursor (spec §4.5).
var ErrInvalidCursor = errors.New("clientcompose: invalid cursor")

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

// NewPagedIsland is NewIsland for an island with pages (spec §4.5). Prefer DefinePaged.
func NewPagedIsland[P any](typ string, version int, resolve func(ctx context.Context, r Request) (P, string, error)) Island {
	return Island{
		Type:    typ,
		Version: version,
		paged:   true,
		resolve: func(ctx context.Context, r Request) (any, error) {
			props, next, err := resolve(ctx, r)
			if err != nil {
				return nil, err
			}
			return page{props: props, next: next}, nil
		},
	}
}

// DefinePaged defines an island version with pages, such as a feed or search results (spec §4.5).
// It resolves the page r.Cursor asks for (the first when it's empty) to that page's props, and the
// cursor of the page after it, or "" when it's the last. The cursor is the app's own: anything it
// needs to go on, such as an offset and the time the first page was made. A cursor it can't read
// is an error wrapping ErrInvalidCursor.
//
//	results := cc.DefinePaged(func(ctx context.Context, r cc.Request) (ResultListV1, string, error) {
//		offset, err := readCursor(r.Cursor)
//		if err != nil {
//			return ResultListV1{}, "", fmt.Errorf("results: %w", cc.ErrInvalidCursor)
//		}
//		...
//	})
func DefinePaged[P Props](resolve func(ctx context.Context, r Request) (P, string, error)) Island {
	var zero P
	return NewPagedIsland(zero.IslandType(), zero.IslandVersion(), resolve)
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
	// Idempotency, if set, runs each action at most once per scope and idempotency key (CMP-19).
	// Without it, keys pass through to actions.
	Idempotency *Idempotency
	// DefaultTimeout is each island's timeout unless its placement sets one. Default 2s.
	DefaultTimeout time.Duration
	// Strings, if set, are the words islands and the app show, in each language (spec §4.7).
	// Without it, entries carry no strings, and POST /strings answers 404.
	Strings *StringsConfig
}

// Result is a status code and a body: a *ScreenStream for a screen (spec §4.6), or a
// JSON-serialisable IslandResponse, ActionResponse or ErrorResponse.
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
	idempotency    *Idempotency
	defaultTimeout time.Duration
	strings        *StringsConfig
	mux            *http.ServeMux
	compose        ComposeFunc
	perform        PerformFunc
	resolve        ResolveFunc
}

// New builds a composer. It panics on mistakes in the config: two screens with one id, an action
// version registered twice, a screen with both or neither of Islands and Layout, or Idempotency
// without a Store or Scope.
func New(cfg Config) *Composer {
	c := &Composer{
		screens:        map[string]Screen{},
		actions:        map[string]map[int]Action{},
		defaultTimeout: cfg.DefaultTimeout,
		cache:          cfg.Cache,
		strings:        cfg.Strings,
	}
	if idem := cfg.Idempotency; idem != nil {
		if idem.Store == nil || idem.Scope == nil {
			panic("clientcompose: Idempotency needs a Store and a Scope")
		}
		settings := *idem
		if settings.TTL == 0 {
			settings.TTL = 24 * time.Hour
		}
		if settings.Wait == 0 {
			settings.Wait = 10 * time.Second
		}
		c.idempotency = &settings
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

	c.compose, c.perform, c.resolve = c.composeScreen, c.performIdempotent, c.resolveIsland
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

	// Shared loads (Load, BatchLoader) live as long as this request: until its stream ends, or it
	// fails. Whatever is still running then is cancelled.
	ctx, endRequest := withRequestScope(ctx)
	streaming := false
	defer func() {
		if !streaming {
			endRequest()
		}
	}()

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

	toResolve, res, ok := c.negotiate(placements, req.Islands)
	if !ok {
		return res
	}
	words := c.words(req.Client.Locale)

	// Every island resolves at once; each says when it's done.
	type resolved struct {
		i     int
		entry IslandEntry
	}
	done := make(chan resolved, len(toResolve))
	for i, t := range toResolve {
		go func() {
			entry, _ := c.resolveEntry(ctx, t.p, t.island, r, words) // a failure is in its entry
			done <- resolved{i, entry}
		}()
	}

	// The head waits for the required islands (spec §4.6): one failing fails the screen.
	entries := make([]*IslandEntry, len(toResolve))
	waitingFor := 0
	for _, t := range toResolve {
		if t.p.Required {
			waitingFor++
		}
	}
	keep := func(d resolved) { entries[d.i] = &d.entry }
	for waitingFor > 0 {
		d := <-done
		keep(d)
		if toResolve[d.i].p.Required {
			if d.entry.Status == "error" {
				return fail(http.StatusBadGateway, "required_island_failed", d.entry.Key)
			}
			waitingFor--
		}
	}
	meta := <-metaDone
	// And takes the other islands that are ready by then.
	for ready := true; ready; {
		select {
		case d := <-done:
			keep(d)
		default:
			ready = false
		}
	}

	head := ScreenResponse{Protocol: ProtocolVersion, Screen: screen.ID, Islands: make([]IslandEntry, len(toResolve)), Meta: meta}
	if screen.CacheMaxAge > 0 {
		head.Cache = &CacheHint{MaxAge: int(screen.CacheMaxAge.Seconds())}
	}
	if words != nil {
		head.Locale, head.Plurals = words.Locale, &words.Plurals
	}
	pending := 0
	for i, t := range toResolve {
		if entries[i] != nil {
			head.Islands[i] = *entries[i]
			continue
		}
		head.Islands[i] = IslandEntry{Key: t.p.Key, Type: t.island.Type, Version: t.island.Version, Status: statusPending}
		pending++
	}

	// The rest follow as they're resolved; the request ends with the last.
	rest := make(chan IslandEntry, pending)
	streaming = true
	go func() {
		defer endRequest()
		defer close(rest)
		for range pending {
			rest <- (<-done).entry
		}
	}()
	return Result{http.StatusOK, &ScreenStream{Head: head, Islands: rest}}
}

// placed is an island the screen places, at the version it's resolved at.
type placed struct {
	p      Placement
	island Island
}

// negotiate picks the version of each placement to resolve, the highest the client supports
// (spec §4.2). Placements it supports none of are left out, or fail the screen if they're required.
func (c *Composer) negotiate(placements []Placement, supported map[string][]int) ([]placed, Result, bool) {
	var out []placed
	for _, p := range placements {
		if len(p.Versions) == 0 {
			continue
		}
		island, ok := Negotiate(p.Versions, supported[p.Versions[0].Type])
		if !ok {
			if p.Required {
				return nil, fail(http.StatusBadGateway, "required_island_unsupported", p.Key), false
			}
			continue
		}
		out = append(out, placed{p, island})
	}
	return out, Result{}, true
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

// resolveEntry resolves one island to its entry. A failure is in the entry; it's returned too, so
// an island request can tell an invalid cursor from a failure.
func (c *Composer) resolveEntry(parent context.Context, p Placement, island Island, r Request, words *LocaleStrings) (IslandEntry, error) {
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
			if pg, ok := o.props.(page); ok {
				entry.Props, entry.Next = pg.props, pg.next
			}
			if entry.Props == nil {
				entry.Props = map[string]any{}
			}
			if words != nil {
				entry.Strings = words.Island(island.Type, island.Version)
			}
			return entry, nil
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
	return entry, err
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
