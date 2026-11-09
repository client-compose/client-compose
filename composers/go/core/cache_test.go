package clientcompose_test

import (
	"context"
	"encoding/json"
	"slices"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	cc "github.com/client-compose/client-compose/composers/go/core"
	"github.com/client-compose/client-compose/composers/go/core/cctest"
)

func all(context.Context, cc.Request) string { return "all" }

// cachedList is listComposer's screen with both islands cached, and an action that renames the list's screen, invalidating it. runs counts how often the items island
// really resolves.
func cachedList(s *items, cache cc.Cache, runs *atomic.Int32, use ...cc.Plugin) *cc.Composer {
	itemsIsland := cc.Define(func(context.Context, cc.Request) (itemsV1, error) {
		runs.Add(1)
		return itemsV1{Items: s.all()}, nil
	}).CacheFor(time.Minute, all)
	leftIsland := cc.Define(func(context.Context, cc.Request) (leftV1, error) {
		return leftV1{ID: "all", Left: s.left()}, nil
	}).CacheFor(time.Minute, all)
	return cc.New(cc.Config{
		Screens: []cc.Screen{{ID: "list", Islands: []cc.Placement{
			{Key: "items", Versions: cc.Versions(itemsIsland)},
			{Key: "left", Versions: cc.Versions(leftIsland)},
		}}},
		Actions: []cc.Action{
			cc.DefineAction(func(_ context.Context, _ cc.Call, in finishInput) (struct{}, cc.Effects, error) {
				s.finish(in.ID)
				return struct{}{}, finished(in.ID, s.left()), nil
			}),
			cc.DefineAction(func(_ context.Context, _ cc.Call, in addInput) (struct{}, cc.Effects, error) {
				s.add(in.Name)
				if in.Name == "everything" {
					return struct{}{}, cc.Effects{Invalidate: []cc.ScreenRef{{Screen: "list"}}}, nil
				}
				return struct{}{}, cc.Effects{Update: []cc.IslandRef{{Screen: "list", Key: "items"}}}, nil
			}),
		},
		Cache: cache,
		Use:   use,
	})
}

func names(t *testing.T, screen cctest.Screen) []string {
	t.Helper()
	var out []string
	for _, item := range cctest.Props[itemsV1](t, screen, "items").Items {
		if item.Done {
			out = append(out, item.Name+" (done)")
		} else {
			out = append(out, item.Name)
		}
	}
	return out
}

func TestCachedIslandsAreFiledUnderThemselvesAndTheEntitiesTheyHold(t *testing.T) {
	cache := cctest.NewMemoryCache()
	var runs atomic.Int32
	app := cctest.New(t, cachedList(&items{list: []itemsV1Item{{ID: "1", Name: "Milk"}, {ID: "2", Name: "Eggs"}}}, cache, &runs))
	app.Screen("list", nil)

	got := cache.Tags("island:items:1:all")
	want := []string{"tag:entity:item:1", "tag:entity:item:2", "tag:island:items:1:all"}
	if !slices.Equal(got, want) {
		t.Fatalf("tags %v, want %v", got, want)
	}
}

func TestAChangeToAnEntityInvalidatesTheIslandsHoldingIt(t *testing.T) {
	cache := cctest.NewMemoryCache()
	var runs atomic.Int32
	app := cctest.New(t, cachedList(&items{list: []itemsV1Item{{ID: "1", Name: "Milk"}}}, cache, &runs))
	app.Screen("list", nil)
	app.Screen("list", nil)
	if runs.Load() != 1 {
		t.Fatalf("served from the cache: runs %d", runs.Load())
	}

	cctest.Perform(app, finishInput{ID: "1"})

	if got := names(t, app.Screen("list", nil)); !slices.Equal(got, []string{"Milk (done)"}) {
		t.Fatalf("after the change: %v", got)
	}
	if left := cctest.Props[leftV1](t, app.Screen("list", nil), "left").Left; left != 0 {
		t.Fatalf("what's left: %d", left)
	}
}

func TestAnUpdateInvalidatesTheIslandAndIsResolvedFresh(t *testing.T) {
	cache := cctest.NewMemoryCache()
	var runs atomic.Int32
	app := cctest.New(t, cachedList(&items{}, cache, &runs))
	app.Screen("list", nil)

	out := cctest.Perform(app, addInput{Name: "Milk"})

	if len(out.Effects.Updated) != 1 {
		t.Fatalf("effects %+v", out.Effects)
	}
	raw, _ := json.Marshal(out.Effects.Updated[0].Island.Props)
	var updated itemsV1
	if err := json.Unmarshal(raw, &updated); err != nil || len(updated.Items) != 1 {
		t.Fatalf("the update isn't fresh: %s", raw)
	}
	if got := names(t, app.Screen("list", nil)); !slices.Equal(got, []string{"Milk"}) {
		t.Fatalf("after the update: %v", got)
	}
}

func TestInvalidatingAScreenInvalidatesItsCachedIslands(t *testing.T) {
	cache := cctest.NewMemoryCache()
	var runs atomic.Int32
	app := cctest.New(t, cachedList(&items{}, cache, &runs))
	app.Screen("list", nil)

	cctest.Perform(app, addInput{Name: "everything"})

	if got := names(t, app.Screen("list", nil)); !slices.Equal(got, []string{"everything"}) {
		t.Fatalf("after invalidating: %v", got)
	}
	if left := cctest.Props[leftV1](t, app.Screen("list", nil), "left").Left; left != 1 {
		t.Fatalf("what's left: %d", left)
	}
}

func TestRequestsForAnEntryBeingResolvedWaitForIt(t *testing.T) {
	var runs atomic.Int32
	slow := cc.Define(func(context.Context, cc.Request) (headerV1, error) {
		runs.Add(1)
		time.Sleep(100 * time.Millisecond)
		return headerV1{Name: "Ada"}, nil
	}).CacheFor(time.Minute, all)
	app := cctest.New(t, cc.New(cc.Config{Screens: []cc.Screen{screenWith(slow)}, Cache: cctest.NewMemoryCache()}))

	var wg sync.WaitGroup
	for range 8 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if name := cctest.Props[headerV1](t, app.Screen("profile", nil), "header").Name; name != "Ada" {
				t.Errorf("name %q", name)
			}
		}()
	}
	wg.Wait()

	if runs.Load() != 1 {
		t.Fatalf("resolved %d times", runs.Load())
	}
}

func TestACacheThatCantInvalidateIsReportedAndTheActionStillSucceeds(t *testing.T) {
	var failures []cc.Failure
	var runs atomic.Int32
	report := cc.ReportErrors(func(_ context.Context, f cc.Failure) { failures = append(failures, f) })
	app := cctest.New(t, cachedList(&items{list: []itemsV1Item{{ID: "1", Name: "Milk"}}}, brokenCache{}, &runs, report))

	out := cctest.Perform(app, finishInput{ID: "1"})

	if out.Status != "ok" {
		t.Fatalf("action: %+v", out)
	}
	invalidated := slices.ContainsFunc(failures, func(f cc.Failure) bool {
		return f.Kind == cc.CacheFailed && f.Action == "finish"
	})
	if !invalidated {
		t.Fatalf("failures %+v", failures)
	}
}
