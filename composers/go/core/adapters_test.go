package clientcompose_test

import (
	"context"
	"errors"
	"slices"
	"sync/atomic"
	"testing"
	"time"

	cc "github.com/client-compose/client-compose/composers/go/core"
	"github.com/client-compose/client-compose/composers/go/core/cctest"
)

// countedHeader is a header island that counts how often it really resolves.
func countedHeader(runs *atomic.Int32, fail *atomic.Bool) cc.Island {
	return cc.Define(func(_ context.Context, r cc.Request) (headerV1, error) {
		if fail != nil && fail.Load() {
			return headerV1{}, errors.New("users service down")
		}
		return headerV1{Name: r.Params["userId"] + string(rune('0'+runs.Add(1)))}, nil
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
