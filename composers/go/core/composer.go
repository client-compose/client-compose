package clientcompose

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"sync"
	"time"
)

// Request is what layouts and resolvers see. Auth, tracing and other per-request
// values travel on the context.Context, as usual in Go.
type Request struct {
	Params map[string]string
	Client ClientContext
}

// Island is one resolvable version of an island type. Build one with NewIsland.
type Island struct {
	Type    string
	Version int
	resolve func(ctx context.Context, r Request) (any, error)
}

// NewIsland defines how to resolve the props for one version of an island.
// P is typically a struct whose JSON shape matches the island manifest.
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

// Define is NewIsland for generated props types: the island type and version come from P,
// so they can't drift from the manifest.
//
//	header := cc.Define(func(ctx context.Context, r cc.Request) (ProfileHeaderV2, error) { ... })
func Define[P Props](resolve func(ctx context.Context, r Request) (P, error)) Island {
	var zero P
	return NewIsland(zero.IslandType(), zero.IslandVersion(), resolve)
}

// Placement puts an island on a screen. Versions lists every version the composer can
// resolve; the highest one the client also supports is used (spec §4.2).
type Placement struct {
	Key      string
	Versions []Island
	Required bool
	// Timeout overrides the composer's default timeout for this island.
	Timeout time.Duration
}

// Screen decides which islands make up a screen.
type Screen struct {
	ID          string
	Layout      func(ctx context.Context, r Request) ([]Placement, error)
	CacheMaxAge time.Duration
}

// Result is a status code and a JSON-serialisable body (ScreenResponse or ErrorResponse).
type Result struct {
	Status int
	Body   any
}

type Composer struct {
	screens        map[string]Screen
	defaultTimeout time.Duration
	onIslandError  func(ctx context.Context, key, typ string, err error)
}

type Option func(*Composer)

// WithDefaultTimeout sets the per-island timeout used when a Placement doesn't set one.
func WithDefaultTimeout(d time.Duration) Option {
	return func(c *Composer) { c.defaultTimeout = d }
}

// WithIslandErrorHandler is called whenever an island fails or times out.
func WithIslandErrorHandler(fn func(ctx context.Context, key, typ string, err error)) Option {
	return func(c *Composer) { c.onIslandError = fn }
}

func New(screens []Screen, opts ...Option) *Composer {
	c := &Composer{screens: map[string]Screen{}, defaultTimeout: 2 * time.Second}
	for _, s := range screens {
		c.screens[s.ID] = s
	}
	for _, o := range opts {
		o(c)
	}
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

// Compose resolves a screen. Most callers use Handler or ComposeHTTP instead.
func (c *Composer) Compose(ctx context.Context, req ScreenRequest) Result {
	if req.Protocol == nil || *req.Protocol != ProtocolVersion {
		return fail(http.StatusBadRequest, "unsupported_protocol", fmt.Sprintf("composer speaks protocol %d", ProtocolVersion))
	}
	screen, ok := c.screens[req.Screen]
	if !ok {
		return fail(http.StatusNotFound, "unknown_screen", req.Screen)
	}

	r := Request{Params: req.Params, Client: *req.Client}
	if r.Params == nil {
		r.Params = map[string]string{}
	}
	placements, err := screen.Layout(ctx, r)
	if err != nil {
		return fail(http.StatusInternalServerError, "layout_failed", "")
	}

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
			entries[i] = c.resolve(ctx, t.p, t.island, r)
		}()
	}
	wg.Wait()

	for i, e := range entries {
		if e.Status == "error" && toResolve[i].p.Required {
			return fail(http.StatusBadGateway, "required_island_failed", e.Key)
		}
	}

	resp := ScreenResponse{Protocol: ProtocolVersion, Screen: screen.ID, Islands: entries}
	if screen.CacheMaxAge > 0 {
		resp.Cache = &CacheHint{MaxAge: int(screen.CacheMaxAge.Seconds())}
	}
	return Result{http.StatusOK, resp}
}

func (c *Composer) resolve(parent context.Context, p Placement, island Island, r Request) IslandEntry {
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
		props, err := island.resolve(ctx, r)
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

	if c.onIslandError != nil {
		c.onIslandError(parent, p.Key, island.Type, err)
	}
	entry.Status = "error"
	if errors.Is(ctx.Err(), context.DeadlineExceeded) && parent.Err() == nil {
		entry.Error = &IslandError{Code: "timeout", Retryable: true}
	} else {
		entry.Error = &IslandError{Code: "resolve_failed"}
	}
	return entry
}
