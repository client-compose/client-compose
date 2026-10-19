package clientcompose

import (
	"context"
	"errors"
	"slices"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// composeIslands runs a screen whose islands use the given resolvers (types t0, t1, …).
func composeIslands(t *testing.T, layout func(ctx context.Context), timeout time.Duration, resolvers ...func(ctx context.Context) (any, error)) []IslandEntry {
	t.Helper()
	var placements []Placement
	caps := map[string][]int{}
	for i, fn := range resolvers {
		typ := string(rune('a' + i))
		caps[typ] = []int{1}
		placements = append(placements, Placement{
			Key:      typ,
			Timeout:  timeout,
			Versions: []Island{NewIsland(typ, 1, func(ctx context.Context, _ Request) (any, error) { return fn(ctx) })},
		})
	}
	c := New([]Screen{{
		ID: "s",
		Layout: func(ctx context.Context, _ Request) ([]Placement, error) {
			if layout != nil {
				layout(ctx)
			}
			return placements, nil
		},
	}})
	protocol := ProtocolVersion
	res := c.Compose(context.Background(), ScreenRequest{Protocol: &protocol, Screen: "s", Client: &ClientContext{}, Islands: caps})
	body, ok := res.Body.(ScreenResponse)
	if !ok {
		t.Fatalf("unexpected result %+v", res)
	}
	return body.Islands
}

func outcomes(entries []IslandEntry) []any {
	var out []any
	for _, e := range entries {
		if e.Status == "ok" {
			out = append(out, e.Props)
		} else {
			out = append(out, e.Error.Code)
		}
	}
	return out
}

func TestLoadIsSharedByLayoutAndResolvers(t *testing.T) {
	var calls atomic.Int32
	user := func(ctx context.Context) (string, error) {
		return Load(ctx, "user:1", func(context.Context) (string, error) {
			calls.Add(1)
			time.Sleep(5 * time.Millisecond)
			return "Ada", nil
		})
	}
	resolve := func(ctx context.Context) (any, error) { return user(ctx) }
	got := outcomes(composeIslands(t, func(ctx context.Context) { _, _ = user(ctx) }, 0, resolve, resolve, resolve))
	if !slices.Equal(got, []any{"Ada", "Ada", "Ada"}) || calls.Load() != 1 {
		t.Fatalf("got %v with %d calls", got, calls.Load())
	}
}

func TestLoadSharesErrorsAndPanics(t *testing.T) {
	failing := func(ctx context.Context) (any, error) {
		return Load(ctx, "down", func(context.Context) (int, error) { return 0, errors.New("users service down") })
	}
	panicking := func(ctx context.Context) (any, error) {
		return Load(ctx, "boom", func(context.Context) (int, error) { panic("oh no") })
	}
	got := outcomes(composeIslands(t, nil, 0, failing, failing, panicking))
	if !slices.Equal(got, []any{"resolve_failed", "resolve_failed", "resolve_failed"}) {
		t.Fatalf("got %v", got)
	}
}

func TestLoadReportsMismatchedTypes(t *testing.T) {
	asInt := func(ctx context.Context) (any, error) {
		return Load(ctx, "k", func(context.Context) (int, error) { return 1, nil })
	}
	asString := func(ctx context.Context) (any, error) {
		time.Sleep(5 * time.Millisecond) // let the int load claim the key first
		return Load(ctx, "k", func(context.Context) (string, error) { return "x", nil })
	}
	got := outcomes(composeIslands(t, nil, 0, asInt, asString))
	if !slices.Equal(got, []any{1, "resolve_failed"}) {
		t.Fatalf("got %v", got)
	}
}

func TestSharedWorkIsCancelledWhenTheRequestEnds(t *testing.T) {
	cancelled := make(chan struct{})
	slow := func(ctx context.Context) (any, error) {
		return Load(ctx, "slow", func(shared context.Context) (int, error) {
			<-shared.Done()
			close(cancelled)
			return 0, shared.Err()
		})
	}
	if got := outcomes(composeIslands(t, nil, 20*time.Millisecond, slow)); !slices.Equal(got, []any{"timeout"}) {
		t.Fatalf("got %v", got)
	}
	select {
	case <-cancelled:
	case <-time.After(time.Second):
		t.Fatal("shared work was not cancelled after the request finished")
	}
}

func TestLoadOutsideARequestJustCalls(t *testing.T) {
	v, err := Load(context.Background(), "k", func(context.Context) (int, error) { return 7, nil })
	if v != 7 || err != nil {
		t.Fatalf("got %v %v", v, err)
	}
}

func TestBatchLoaderCombinesAndDeduplicatesKeys(t *testing.T) {
	var mu sync.Mutex
	var batches [][]string
	users := NewBatchLoader(func(_ context.Context, ids []string) (map[string]string, error) {
		mu.Lock()
		batches = append(batches, slices.Sorted(slices.Values(ids)))
		mu.Unlock()
		out := map[string]string{}
		for _, id := range ids {
			if id != "missing" {
				out[id] = "user " + id
			}
		}
		return out, nil
	})
	load := func(id string) func(ctx context.Context) (any, error) {
		return func(ctx context.Context) (any, error) { return users.Load(ctx, id) }
	}
	got := outcomes(composeIslands(t, nil, 0, load("1"), load("2"), load("1"), load("missing")))
	if !slices.Equal(got, []any{"user 1", "user 2", "user 1", "resolve_failed"}) {
		t.Fatalf("got %v", got)
	}
	if len(batches) != 1 || !slices.Equal(batches[0], []string{"1", "2", "missing"}) {
		t.Fatalf("batches %v", batches)
	}

	// A second request gets its own batch.
	composeIslands(t, nil, 0, load("1"))
	if len(batches) != 2 {
		t.Fatalf("batches %v", batches)
	}
}

func TestBatchLoaderSplitsAtMaxBatchSize(t *testing.T) {
	var sizes []int
	var mu sync.Mutex
	square := NewBatchLoader(func(_ context.Context, ns []int) (map[int]int, error) {
		mu.Lock()
		sizes = append(sizes, len(ns))
		mu.Unlock()
		out := map[int]int{}
		for _, n := range ns {
			out[n] = n * n
		}
		return out, nil
	}, WithMaxBatchSize(2), WithBatchWindow(10*time.Millisecond))
	load := func(n int) func(ctx context.Context) (any, error) {
		return func(ctx context.Context) (any, error) { return square.Load(ctx, n) }
	}
	got := outcomes(composeIslands(t, nil, 0, load(1), load(2), load(3)))
	if !slices.Equal(got, []any{1, 4, 9}) {
		t.Fatalf("got %v", got)
	}
	slices.Sort(sizes)
	if !slices.Equal(sizes, []int{1, 2}) {
		t.Fatalf("batch sizes %v", sizes)
	}
}

func TestBatchLoaderOutsideARequestFetchesDirectly(t *testing.T) {
	l := NewBatchLoader(func(_ context.Context, ids []string) (map[string]int, error) { return map[string]int{"a": 1}, nil })
	if v, err := l.Load(context.Background(), "a"); v != 1 || err != nil {
		t.Fatalf("got %v %v", v, err)
	}
	if _, err := l.Load(context.Background(), "b"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("got %v", err)
	}
}

func TestLayoutNotFoundAndMetaFailure(t *testing.T) {
	users := NewBatchLoader(func(_ context.Context, ids []string) (map[string]string, error) { return map[string]string{}, nil })
	protocol := ProtocolVersion
	req := ScreenRequest{Protocol: &protocol, Screen: "s", Client: &ClientContext{}, Islands: map[string][]int{"x": {1}}}

	// A batch loader's missing key in the layout is a 404 not_found.
	notFound := New([]Screen{{ID: "s", Layout: func(ctx context.Context, r Request) ([]Placement, error) {
		_, err := users.Load(ctx, "missing")
		return nil, err
	}}})
	if res := notFound.Compose(context.Background(), req); res.Status != 404 || res.Body.(ErrorResponse).Error.Code != "not_found" {
		t.Fatalf("got %+v", res)
	}

	// A failing Meta drops the meta, not the islands.
	var metaErr error
	c := New([]Screen{{
		ID:   "s",
		Meta: func(context.Context, Request) (ScreenMeta, error) { return ScreenMeta{}, errors.New("meta broke") },
		Layout: func(context.Context, Request) ([]Placement, error) {
			return []Placement{{Key: "k", Versions: []Island{NewIsland("x", 1, func(context.Context, Request) (int, error) { return 1, nil })}}}, nil
		},
	}}, WithMetaErrorHandler(func(_ context.Context, _ string, err error) { metaErr = err }))
	res := c.Compose(context.Background(), req)
	body := res.Body.(ScreenResponse)
	if res.Status != 200 || body.Meta != nil || len(body.Islands) != 1 || metaErr == nil {
		t.Fatalf("got %+v (meta error %v)", res, metaErr)
	}
}
