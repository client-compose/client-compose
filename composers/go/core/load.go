package clientcompose

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"
)

// Request-scoped data loading: islands (and the layout) that need the same data within one screen
// request share one call, and batch loaders combine their keys into one call.
//
// Shared work runs under the request's context, never one island's: if an island times out, the
// work it shares with other islands keeps going for them. Compose cancels the request context once
// the response is ready, cancelling anything still running.

type scopeKey struct{}

type requestScope struct {
	ctx     context.Context // the request context, carrying this scope
	mu      sync.Mutex
	entries map[string]*loadEntry
	batches map[any]any // *BatchLoader -> *batchState
}

type loadEntry struct {
	done  chan struct{}
	value any
	err   error
}

// withRequestScope returns a context carrying a new request scope; cancel ends the request.
func withRequestScope(parent context.Context) (ctx context.Context, cancel context.CancelFunc) {
	ctx, cancel = context.WithCancel(parent)
	s := &requestScope{entries: map[string]*loadEntry{}, batches: map[any]any{}}
	ctx = context.WithValue(ctx, scopeKey{}, s)
	s.ctx = ctx
	return ctx, cancel
}

func scopeFrom(ctx context.Context) *requestScope {
	s, _ := ctx.Value(scopeKey{}).(*requestScope)
	return s
}

// Load runs fn once per key for the current screen request, sharing the result (or error) with every
// island and the layout that ask for the same key. fn gets the request's context, not the caller's,
// so an island timing out never cancels work other islands are waiting on; each caller still
// returns as soon as its own ctx is done.
//
// Outside a composer request (e.g. in a unit test of a helper), Load just calls fn with ctx.
//
//	user, err := cc.Load(ctx, "user:"+id, func(ctx context.Context) (User, error) {
//		return users.Get(ctx, id)
//	})
func Load[T any](ctx context.Context, key string, fn func(ctx context.Context) (T, error)) (T, error) {
	var zero T
	s := scopeFrom(ctx)
	if s == nil {
		return fn(ctx)
	}

	s.mu.Lock()
	e, ok := s.entries[key]
	if !ok {
		e = &loadEntry{done: make(chan struct{})}
		s.entries[key] = e
		go func() {
			defer close(e.done)
			defer func() {
				if rec := recover(); rec != nil {
					e.err = fmt.Errorf("load %q panicked: %v", key, rec)
				}
			}()
			e.value, e.err = fn(s.ctx)
		}()
	}
	s.mu.Unlock()

	select {
	case <-e.done:
		if e.err != nil {
			return zero, e.err
		}
		v, ok := e.value.(T)
		if !ok && e.value != nil {
			return zero, fmt.Errorf("load key %q was used with different result types (%T and %T)", key, e.value, zero)
		}
		return v, nil
	case <-ctx.Done():
		return zero, ctx.Err()
	}
}

// ErrNotFound is returned by BatchLoader.Load when the fetch returned no value for the key.
var ErrNotFound = errors.New("clientcompose: no value loaded for key")

// BatchLoader combines the keys requested by every island in a screen request into batched calls,
// de-duplicating keys. Create one per data source, at startup; each request gets its own batches
// and results.
type BatchLoader[K comparable, V any] struct {
	fetch    func(ctx context.Context, keys []K) (map[K]V, error)
	window   time.Duration
	maxBatch int
}

type BatchOption func(*batchOptions)

type batchOptions struct {
	window   time.Duration
	maxBatch int
}

// WithBatchWindow sets how long to collect keys before fetching. Default 2ms.
func WithBatchWindow(d time.Duration) BatchOption { return func(o *batchOptions) { o.window = d } }

// WithMaxBatchSize caps the keys per fetch; larger batches are split. Default: unlimited.
func WithMaxBatchSize(n int) BatchOption { return func(o *batchOptions) { o.maxBatch = n } }

// NewBatchLoader creates a batch loader. fetch receives de-duplicated keys and returns the values
// it found; keys missing from the map fail with ErrNotFound.
//
//	var userByID = cc.NewBatchLoader(func(ctx context.Context, ids []string) (map[string]User, error) {
//		return users.GetMany(ctx, ids)
//	})
//	// in a resolver:
//	user, err := userByID.Load(ctx, r.Params["userId"])
func NewBatchLoader[K comparable, V any](fetch func(ctx context.Context, keys []K) (map[K]V, error), opts ...BatchOption) *BatchLoader[K, V] {
	o := batchOptions{window: 2 * time.Millisecond}
	for _, opt := range opts {
		opt(&o)
	}
	return &BatchLoader[K, V]{fetch: fetch, window: o.window, maxBatch: o.maxBatch}
}

type batchState[K comparable, V any] struct {
	mu      sync.Mutex
	results map[K]*loadEntry
	pending []K
	timer   *time.Timer
}

// Load returns the value for key, batched with every other key requested in the same request and
// window. Outside a composer request, it fetches the single key directly.
func (l *BatchLoader[K, V]) Load(ctx context.Context, key K) (V, error) {
	var zero V
	s := scopeFrom(ctx)
	if s == nil {
		values, err := l.fetch(ctx, []K{key})
		if err != nil {
			return zero, err
		}
		v, ok := values[key]
		if !ok {
			return zero, fmt.Errorf("%w: %v", ErrNotFound, key)
		}
		return v, nil
	}

	s.mu.Lock()
	state, _ := s.batches[l].(*batchState[K, V])
	if state == nil {
		state = &batchState[K, V]{results: map[K]*loadEntry{}}
		s.batches[l] = state
	}
	s.mu.Unlock()

	state.mu.Lock()
	e, ok := state.results[key]
	if !ok {
		e = &loadEntry{done: make(chan struct{})}
		state.results[key] = e
		state.pending = append(state.pending, key)
		if l.maxBatch > 0 && len(state.pending) >= l.maxBatch {
			l.flushLocked(s, state)
		} else if state.timer == nil {
			state.timer = time.AfterFunc(l.window, func() {
				state.mu.Lock()
				defer state.mu.Unlock()
				l.flushLocked(s, state)
			})
		}
	}
	state.mu.Unlock()

	select {
	case <-e.done:
		if e.err != nil {
			return zero, e.err
		}
		return e.value.(V), nil
	case <-ctx.Done():
		return zero, ctx.Err()
	}
}

// flushLocked starts fetches for every pending key. state.mu must be held.
func (l *BatchLoader[K, V]) flushLocked(s *requestScope, state *batchState[K, V]) {
	if state.timer != nil {
		state.timer.Stop()
		state.timer = nil
	}
	for len(state.pending) > 0 {
		n := len(state.pending)
		if l.maxBatch > 0 && n > l.maxBatch {
			n = l.maxBatch
		}
		keys := state.pending[:n:n]
		state.pending = state.pending[n:]
		entries := make([]*loadEntry, len(keys))
		for i, k := range keys {
			entries[i] = state.results[k]
		}
		go func() {
			values, err := l.fetchSafely(s.ctx, keys)
			for i, k := range keys {
				e := entries[i]
				switch v, ok := values[k]; {
				case err != nil:
					e.err = err
				case !ok:
					e.err = fmt.Errorf("%w: %v", ErrNotFound, k)
				default:
					e.value = v
				}
				close(e.done)
			}
		}()
	}
}

func (l *BatchLoader[K, V]) fetchSafely(ctx context.Context, keys []K) (values map[K]V, err error) {
	defer func() {
		if rec := recover(); rec != nil {
			err = fmt.Errorf("batch load panicked: %v", rec)
		}
	}()
	return l.fetch(ctx, keys)
}
