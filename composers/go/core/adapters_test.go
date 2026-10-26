package clientcompose_test

import (
	"context"
	"errors"
	"slices"
	"strconv"
	"sync/atomic"
	"testing"
	"time"

	cc "github.com/client-compose/client-compose/composers/go/core"
	"github.com/client-compose/client-compose/composers/go/core/cctest"
	ca "github.com/client-compose/client-compose/composers/go/core/internal/conformanceaction"
)

// countedHeader is a header island that counts how often it really resolves.
func countedHeader(runs *atomic.Int32, fail *atomic.Bool) cc.Island {
	return cc.Define(func(_ context.Context, r cc.Request) (headerV1, error) {
		if fail != nil && fail.Load() {
			return headerV1{}, errors.New("users service down")
		}
		return headerV1{Name: r.Params["userId"] + strconv.Itoa(int(runs.Add(1)))}, nil
	})
}

func byUser(_ context.Context, r cc.Request) string { return r.Params["userId"] }

func screenWith(island cc.Island) cc.Screen {
	return cc.Screen{ID: "profile", Islands: []cc.Placement{{Key: "header", Versions: cc.Versions(island)}}}
}

func TestCachedIslandsAreServedFromTheCache(t *testing.T) {
	var runs atomic.Int32
	cache := cctest.NewMemoryCache()
	app := cctest.New(t, cc.New(cc.Config{
		Screens: []cc.Screen{screenWith(countedHeader(&runs, nil).CacheFor(time.Minute, byUser))},
		Cache:   cache,
	}))

	first := cctest.Props[headerV1](t, app.Screen("profile", cctest.Params{"userId": "ada"}), "header")
	second := cctest.Props[headerV1](t, app.Screen("profile", cctest.Params{"userId": "ada"}), "header")
	other := cctest.Props[headerV1](t, app.Screen("profile", cctest.Params{"userId": "grace"}), "header")
	if first.Name != "ada1" || second.Name != "ada1" || other.Name != "grace2" || runs.Load() != 2 {
		t.Fatalf("first %v, second %v, other %v, runs %d", first, second, other, runs.Load())
	}
	keys := cache.Keys()
	slices.Sort(keys)
	if !slices.Equal(keys, []string{"island:header:1:ada", "island:header:1:grace"}) {
		t.Fatalf("keys %v", keys)
	}
}

func TestWithoutACacheIslandsAlwaysResolve(t *testing.T) {
	var runs atomic.Int32
	app := cctest.New(t, cc.New(cc.Config{Screens: []cc.Screen{screenWith(countedHeader(&runs, nil).CacheFor(time.Minute, byUser))}}))
	app.Screen("profile", cctest.Params{"userId": "ada"})
	app.Screen("profile", cctest.Params{"userId": "ada"})
	if runs.Load() != 2 {
		t.Fatalf("runs %d", runs.Load())
	}
}

func TestAnEmptyKeySkipsTheCache(t *testing.T) {
	var runs atomic.Int32
	noKey := func(context.Context, cc.Request) string { return "" }
	cache := cctest.NewMemoryCache()
	app := cctest.New(t, cc.New(cc.Config{Screens: []cc.Screen{screenWith(countedHeader(&runs, nil).CacheFor(time.Minute, noKey))}, Cache: cache}))
	app.Screen("profile", cctest.Params{"userId": "ada"})
	app.Screen("profile", cctest.Params{"userId": "ada"})
	if runs.Load() != 2 || len(cache.Keys()) != 0 {
		t.Fatalf("runs %d, keys %v", runs.Load(), cache.Keys())
	}
}

func TestFailuresAreNeverCached(t *testing.T) {
	var runs atomic.Int32
	var fail atomic.Bool
	fail.Store(true)
	cache := cctest.NewMemoryCache()
	app := cctest.New(t, cc.New(cc.Config{Screens: []cc.Screen{screenWith(countedHeader(&runs, &fail).CacheFor(time.Minute, byUser))}, Cache: cache}))
	if island, _ := app.Screen("profile", cctest.Params{"userId": "ada"}).Island("header"); island.Status != "error" {
		t.Fatalf("expected the island to fail: %+v", island)
	}
	fail.Store(false)
	if name := cctest.Props[headerV1](t, app.Screen("profile", cctest.Params{"userId": "ada"}), "header").Name; name != "ada1" {
		t.Fatalf("after recovering: %s", name)
	}
}

// brokenCache fails every call.
type brokenCache struct{}

func (brokenCache) Get(context.Context, string) ([]byte, bool, error) {
	return nil, false, errors.New("redis down")
}

func (brokenCache) Set(context.Context, string, []byte, time.Duration) error {
	return errors.New("redis down")
}

func TestABrokenCacheIsReportedAndBypassed(t *testing.T) {
	var runs atomic.Int32
	var failures []cc.Failure
	app := cctest.New(t, cc.New(cc.Config{
		Screens: []cc.Screen{screenWith(countedHeader(&runs, nil).CacheFor(time.Minute, byUser))},
		Cache:   brokenCache{},
		Use:     []cc.Plugin{cc.ReportErrors(func(_ context.Context, f cc.Failure) { failures = append(failures, f) })},
	}))
	if name := cctest.Props[headerV1](t, app.Screen("profile", cctest.Params{"userId": "ada"}), "header").Name; name != "ada1" {
		t.Fatalf("name %s", name)
	}
	if len(failures) != 2 || failures[0].Kind != cc.CacheFailed || failures[0].Key != "header" || failures[0].Screen != "profile" {
		t.Fatalf("failures %+v", failures)
	}
}

// echoAction counts its runs; "fail" fails, "reject" returns a declared error, "wait" blocks until
// release is closed.
func echoAction(runs *atomic.Int32, release chan struct{}) cc.Action {
	return cc.DefineAction(func(_ context.Context, _ cc.Call, in ca.ConformanceV1Input) (ca.ConformanceV1Result, cc.Effects, error) {
		n := runs.Add(1)
		switch in.Outcome {
		case "fail":
			return ca.ConformanceV1Result{}, cc.Effects{}, errors.New("boom")
		case "rejected":
			return ca.ConformanceV1Result{}, cc.Effects{}, ca.ConformanceV1Rejected{Echo: in.Echo}
		}
		if release != nil {
			<-release
		}
		return ca.ConformanceV1Result{Echo: in.Echo + strconv.Itoa(int(n)), Version: 1}, cc.Effects{Invalidate: []cc.ScreenRef{{Screen: "feed"}}}, nil
	})
}

func idempotent(store cc.IdempotencyStore) *cc.Idempotency {
	return &cc.Idempotency{Store: store, Scope: func(ctx context.Context) string {
		viewer, _ := ctx.Value(viewerKey{}).(string)
		return viewer
	}}
}

func TestRetriedActionsReturnTheirFirstOutcome(t *testing.T) {
	var runs atomic.Int32
	app := cctest.New(t, cc.New(cc.Config{
		Actions:     []cc.Action{echoAction(&runs, nil)},
		Context:     viewerFromHeader,
		Idempotency: idempotent(cctest.NewMemoryIdempotencyStore()),
	}))
	ada, grace := cctest.Header("Authorization", "ada"), cctest.Header("Authorization", "grace")
	in := ca.ConformanceV1Input{Outcome: "ok", Echo: "hi"}

	first := cctest.Perform(app, in, ada, cctest.IdempotencyKey("k1"))
	retry := cctest.Perform(app, in, ada, cctest.IdempotencyKey("k1"))
	if first.Result.Echo != "hi1" || retry.Result.Echo != "hi1" || len(retry.Effects.Invalidate) != 1 || runs.Load() != 1 {
		t.Fatalf("first %+v, retry %+v, runs %d", first, retry, runs.Load())
	}
	// Another viewer's call with the same key is theirs; a new key is a new intent; no key, no memory.
	if other := cctest.Perform(app, in, grace, cctest.IdempotencyKey("k1")); other.Result.Echo != "hi2" {
		t.Fatalf("another viewer: %+v", other)
	}
	if next := cctest.Perform(app, in, ada, cctest.IdempotencyKey("k2")); next.Result.Echo != "hi3" {
		t.Fatalf("a new key: %+v", next)
	}
	cctest.Perform(app, in, ada)
	cctest.Perform(app, in, ada)
	if runs.Load() != 5 {
		t.Fatalf("runs %d", runs.Load())
	}
}

func TestDeclaredErrorsAreKeptAndFailuresReleaseTheKey(t *testing.T) {
	var runs atomic.Int32
	app := cctest.New(t, cc.New(cc.Config{
		Actions:     []cc.Action{echoAction(&runs, nil)},
		Idempotency: idempotent(cctest.NewMemoryIdempotencyStore()),
	}))
	rejected := ca.ConformanceV1Input{Outcome: "rejected", Echo: "taken"}
	for range 2 {
		if out := cctest.Perform(app, rejected, cctest.IdempotencyKey("k1")); out.Error != "rejected" {
			t.Fatalf("rejected: %+v", out)
		}
	}
	failing := ca.ConformanceV1Input{Outcome: "fail", Echo: "x"}
	for range 2 {
		if out := cctest.Perform(app, failing, cctest.IdempotencyKey("k2")); out.Error != "action_failed" {
			t.Fatalf("failing: %+v", out)
		}
	}
	if runs.Load() != 3 { // the declared error once, the failure twice
		t.Fatalf("runs %d", runs.Load())
	}
}

func TestADuplicateInFlightWaitsForTheFirst(t *testing.T) {
	var runs atomic.Int32
	release := make(chan struct{})
	app := cctest.New(t, cc.New(cc.Config{
		Actions:     []cc.Action{echoAction(&runs, release)},
		Idempotency: idempotent(cctest.NewMemoryIdempotencyStore()),
	}))
	in := ca.ConformanceV1Input{Outcome: "ok", Echo: "hi"}
	results := make(chan string, 2)
	for range 2 {
		go func() { results <- cctest.Perform(app, in, cctest.IdempotencyKey("k1")).Result.Echo }()
	}
	time.Sleep(100 * time.Millisecond)
	close(release)
	if a, b := <-results, <-results; a != "hi1" || b != "hi1" || runs.Load() != 1 {
		t.Fatalf("results %s %s, runs %d", a, b, runs.Load())
	}
}

// brokenStore fails every call.
type brokenStore struct{}

func (brokenStore) Begin(context.Context, string, time.Duration) ([]byte, bool, error) {
	return nil, false, errors.New("redis down")
}
func (brokenStore) Finish(context.Context, string, []byte, time.Duration) error { return nil }
func (brokenStore) Release(context.Context, string) error                       { return nil }

func TestABrokenIdempotencyStoreIsReportedAndTheActionRuns(t *testing.T) {
	var runs atomic.Int32
	var failures []cc.Failure
	app := cctest.New(t, cc.New(cc.Config{
		Actions:     []cc.Action{echoAction(&runs, nil)},
		Idempotency: idempotent(brokenStore{}),
		Use:         []cc.Plugin{cc.ReportErrors(func(_ context.Context, f cc.Failure) { failures = append(failures, f) })},
	}))
	if out := cctest.Perform(app, ca.ConformanceV1Input{Outcome: "ok", Echo: "hi"}, cctest.IdempotencyKey("k1")); out.Status != "ok" {
		t.Fatalf("out %+v", out)
	}
	if len(failures) != 1 || failures[0].Kind != cc.IdempotencyFailed || failures[0].Action != "conformance" {
		t.Fatalf("failures %+v", failures)
	}
}

func TestIdempotencyNeedsAScope(t *testing.T) {
	defer func() {
		if rec := recover(); rec == nil {
			t.Fatal("expected a panic")
		}
	}()
	cc.New(cc.Config{Idempotency: &cc.Idempotency{Store: cctest.NewMemoryIdempotencyStore()}})
}
