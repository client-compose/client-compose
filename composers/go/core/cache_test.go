package clientcompose_test

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	cc "github.com/client-compose/client-compose/composers/go/core"
	"github.com/client-compose/client-compose/composers/go/core/cctest"
)

// Data that opts in to the cache (CMP-18): kept between requests by kind, cleared by what actions
// say changed.

// cachedItems is the list as Data: all of it under one key, tagged with each item it holds and as
// the list ("tag:list"), so that adding to it clears it. fetches counts how often it's fetched.
func cachedItems(s *items, fetches *atomic.Int32) *cc.Data[string, []itemsV1Item] {
	return cc.NewData("items", func(_ context.Context, keys []string) (map[string][]itemsV1Item, error) {
		fetches.Add(1)
		out := map[string][]itemsV1Item{}
		for _, k := range keys {
			out[k] = s.all()
		}
		return out, nil
	}).CacheFor(time.Minute).Tags(func(_ string, list []itemsV1Item) []string {
		tags := []string{"tag:list"}
		for _, item := range list {
			tags = append(tags, cc.EntityTag("item", item.ID))
		}
		return tags
	})
}

// cachedList is listComposer's screen, its islands reading the list from cached data, with an
// action that finishes an item (an entity change) and one that adds one (naming the list as
// stale), each optionally reading the list itself.
func cachedList(s *items, cache cc.Cache, fetches *atomic.Int32, use ...cc.Plugin) *cc.Composer {
	data := cachedItems(s, fetches)
	itemsIsland := cc.Define(func(ctx context.Context, _ cc.Request) (itemsV1, error) {
		list, err := data.Load(ctx, "all")
		return itemsV1{Items: list}, err
	})
	leftIsland := cc.Define(func(ctx context.Context, _ cc.Request) (leftV1, error) {
		list, err := data.Load(ctx, "all")
		left := 0
		for _, item := range list {
			if !item.Done {
				left++
			}
		}
		return leftV1{ID: "all", Left: left}, err
	})
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
			cc.DefineAction(func(ctx context.Context, _ cc.Call, in addInput) (struct{}, cc.Effects, error) {
				// Actions read fresh: a name already on the list (as it is now) isn't added twice.
				list, err := data.Load(ctx, "all")
				if err != nil {
					return struct{}{}, cc.Effects{}, err
				}
				if slices.ContainsFunc(list, func(i itemsV1Item) bool { return i.Name == in.Name }) {
					return struct{}{}, cc.Effects{}, nil
				}
				s.add(in.Name)
				return struct{}{}, cc.Effects{
					Stale:  []string{"tag:list"},
					Update: []cc.IslandRef{{Screen: "list", Key: "items"}},
				}, nil
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

func TestDataIsKeptBetweenRequestsAndSharedByIslands(t *testing.T) {
	cache := cctest.NewMemoryCache()
	var fetches atomic.Int32
	app := cctest.New(t, cachedList(&items{list: []itemsV1Item{{ID: "1", Name: "Milk"}}}, cache, &fetches))

	app.Screen("list", nil)
	app.Screen("list", nil)

	if fetches.Load() != 1 {
		t.Fatalf("fetched %d times", fetches.Load())
	}
	if keys := cache.Keys(); !slices.Equal(keys, []string{"data:items:all"}) {
		t.Fatalf("keys %v", keys)
	}
	want := []string{"tag:data:items:all", "tag:entity:item:1", "tag:list"}
	if got := cache.Tags("data:items:all"); !slices.Equal(got, want) {
		t.Fatalf("tags %v, want %v", got, want)
	}
}

func TestWithoutACacheDataIsFetchedOnEveryRequest(t *testing.T) {
	var fetches atomic.Int32
	app := cctest.New(t, cachedList(&items{}, nil, &fetches))
	app.Screen("list", nil)
	app.Screen("list", nil)
	if fetches.Load() != 2 {
		t.Fatalf("fetched %d times", fetches.Load())
	}
}

func TestAChangeToAnEntityClearsTheDataHoldingIt(t *testing.T) {
	cache := cctest.NewMemoryCache()
	var fetches atomic.Int32
	app := cctest.New(t, cachedList(&items{list: []itemsV1Item{{ID: "1", Name: "Milk"}}}, cache, &fetches))
	app.Screen("list", nil)

	cctest.Perform(app, finishInput{ID: "1"})

	if got := names(t, app.Screen("list", nil)); !slices.Equal(got, []string{"Milk (done)"}) {
		t.Fatalf("after the change: %v", got)
	}
	if left := cctest.Props[leftV1](t, app.Screen("list", nil), "left").Left; left != 0 {
		t.Fatalf("what's left: %d", left)
	}
}

func TestStaleClearsWhatItNamesAndUpdatesAreResolvedFresh(t *testing.T) {
	cache := cctest.NewMemoryCache()
	var fetches atomic.Int32
	app := cctest.New(t, cachedList(&items{}, cache, &fetches))
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

func TestActionsReadFreshData(t *testing.T) {
	cache := cctest.NewMemoryCache()
	var fetches atomic.Int32
	s := &items{}
	app := cctest.New(t, cachedList(s, cache, &fetches))
	app.Screen("list", nil) // kept: an empty list

	s.add("Milk") // behind the cache's back
	cctest.Perform(app, addInput{Name: "Milk"})

	if got := s.all(); len(got) != 1 {
		t.Fatalf("the action read the kept list, not the list as it is: %v", got)
	}
}

func TestFailuresAndMissingKeysAreNeverCached(t *testing.T) {
	cache := cctest.NewMemoryCache()
	var fetches atomic.Int32
	var fail atomic.Bool
	fail.Store(true)
	users := cc.NewData("user", func(_ context.Context, ids []string) (map[string]headerV1, error) {
		fetches.Add(1)
		if fail.Load() {
			return nil, errors.New("users service down")
		}
		out := map[string]headerV1{}
		for _, id := range ids {
			if id != "nobody" {
				out[id] = headerV1{Name: id}
			}
		}
		return out, nil
	}).CacheFor(time.Minute)
	header := cc.Define(func(ctx context.Context, r cc.Request) (headerV1, error) {
		return users.Load(ctx, r.Params["userId"])
	})
	app := cctest.New(t, cc.New(cc.Config{Screens: []cc.Screen{screenWith(header)}, Cache: cache}))

	if island, _ := app.Screen("profile", cctest.Params{"userId": "ada"}).Island("header"); island.Status != "error" {
		t.Fatalf("expected the island to fail: %+v", island)
	}
	fail.Store(false)
	if name := cctest.Props[headerV1](t, app.Screen("profile", cctest.Params{"userId": "ada"}), "header").Name; name != "ada" {
		t.Fatalf("after recovering: %s", name)
	}
	app.Screen("profile", cctest.Params{"userId": "nobody"})
	app.Screen("profile", cctest.Params{"userId": "nobody"})
	if keys := cache.Keys(); !slices.Equal(keys, []string{"data:user:ada"}) || fetches.Load() != 4 {
		t.Fatalf("keys %v, fetches %d", keys, fetches.Load())
	}
}

// viewerKey carries who's asking, as an app's Context function would.
type askingKey struct{}

func TestDataKeptPerViewerIsNeverShared(t *testing.T) {
	saved := func(fetches *atomic.Int32) *cc.Data[string, bool] {
		return cc.NewData("saved", func(ctx context.Context, ids []string) (map[string]bool, error) {
			fetches.Add(1)
			viewer, _ := ctx.Value(askingKey{}).(string)
			out := map[string]bool{}
			for _, id := range ids {
				out[id] = viewer == "ada"
			}
			return out, nil
		}).CacheFor(time.Minute).PerViewer()
	}
	asViewer := func(ctx context.Context, r *http.Request) (context.Context, error) {
		return context.WithValue(ctx, askingKey{}, r.Header.Get("X-Viewer")), nil
	}
	compose := func(data *cc.Data[string, bool], cache cc.Cache, viewer func(context.Context) string) *cctest.App {
		island := cc.Define(func(ctx context.Context, _ cc.Request) (headerV1, error) {
			on, err := data.Load(ctx, "pasta")
			return headerV1{Name: fmt.Sprint(on)}, err
		})
		return cctest.New(t, cc.New(cc.Config{Screens: []cc.Screen{screenWith(island)}, Cache: cache, Context: asViewer, Viewer: viewer}))
	}
	viewer := func(ctx context.Context) string { s, _ := ctx.Value(askingKey{}).(string); return s }
	as := func(who string) cctest.RequestOption { return cctest.Header("X-Viewer", who) }

	cache := cctest.NewMemoryCache()
	var fetches atomic.Int32
	app := compose(saved(&fetches), cache, viewer)
	ada := cctest.Props[headerV1](t, app.Screen("profile", nil, as("ada")), "header").Name
	grace := cctest.Props[headerV1](t, app.Screen("profile", nil, as("grace")), "header").Name
	again := cctest.Props[headerV1](t, app.Screen("profile", nil, as("ada")), "header").Name
	keys := cache.Keys()
	slices.Sort(keys)
	if ada != "true" || grace != "false" || again != "true" || fetches.Load() != 2 ||
		!slices.Equal(keys, []string{"data:saved:viewer:ada:pasta", "data:saved:viewer:grace:pasta"}) {
		t.Fatalf("ada %s, grace %s, again %s, fetches %d, keys %v", ada, grace, again, fetches.Load(), keys)
	}

	// A composer that can't say who's asking never caches it.
	unknown := cctest.NewMemoryCache()
	var fresh atomic.Int32
	app = compose(saved(&fresh), unknown, nil)
	app.Screen("profile", nil, as("ada"))
	app.Screen("profile", nil, as("ada"))
	if len(unknown.Keys()) != 0 || fresh.Load() != 2 {
		t.Fatalf("cached without a viewer: keys %v, fetches %d", unknown.Keys(), fresh.Load())
	}
}

func TestRequestsMissingTheSameEntryShareOneFetch(t *testing.T) {
	var fetches atomic.Int32
	users := cc.NewData("user", func(_ context.Context, ids []string) (map[string]headerV1, error) {
		fetches.Add(1)
		time.Sleep(100 * time.Millisecond)
		return map[string]headerV1{ids[0]: {Name: "Ada"}}, nil
	}).CacheFor(time.Minute)
	header := cc.Define(func(ctx context.Context, _ cc.Request) (headerV1, error) { return users.Load(ctx, "ada") })
	app := cctest.New(t, cc.New(cc.Config{Screens: []cc.Screen{screenWith(header)}, Cache: cctest.NewMemoryCache()}))

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

	if fetches.Load() != 1 {
		t.Fatalf("fetched %d times", fetches.Load())
	}
}

// brokenCache fails every call.
type brokenCache struct{}

func (brokenCache) GetMany(context.Context, []string) (map[string][]byte, error) {
	return nil, errors.New("redis down")
}

func (brokenCache) Set(context.Context, string, []byte, time.Duration, []string) error {
	return errors.New("redis down")
}

func (brokenCache) Invalidate(context.Context, []string) error {
	return errors.New("redis down")
}

func TestABrokenCacheIsReportedAndBypassed(t *testing.T) {
	var failures []cc.Failure
	var mu sync.Mutex
	var fetches atomic.Int32
	report := cc.ReportErrors(func(_ context.Context, f cc.Failure) {
		mu.Lock()
		defer mu.Unlock()
		failures = append(failures, f)
	})
	app := cctest.New(t, cachedList(&items{list: []itemsV1Item{{ID: "1", Name: "Milk"}}}, brokenCache{}, &fetches, report))

	if got := names(t, app.Screen("list", nil)); !slices.Equal(got, []string{"Milk"}) {
		t.Fatalf("names %v", got)
	}
	out := cctest.Perform(app, finishInput{ID: "1"})

	mu.Lock()
	defer mu.Unlock()
	if out.Status != "ok" {
		t.Fatalf("action: %+v", out)
	}
	read := slices.ContainsFunc(failures, func(f cc.Failure) bool { return f.Kind == cc.CacheFailed && f.Action == "" })
	invalidated := slices.ContainsFunc(failures, func(f cc.Failure) bool {
		return f.Kind == cc.CacheFailed && f.Action == "finish"
	})
	if !read || !invalidated {
		t.Fatalf("failures %+v", failures)
	}
}

func TestCheckEffectsCatchesDataAnActionDidntSayChanged(t *testing.T) {
	s := &items{}
	var fetches atomic.Int32
	data := cachedItems(s, &fetches)
	itemsIsland := cc.Define(func(ctx context.Context, _ cc.Request) (itemsV1, error) {
		list, err := data.Load(ctx, "all")
		return itemsV1{Items: list}, err
	})
	forgetsTheList := cc.DefineAction(func(_ context.Context, _ cc.Call, in addInput) (struct{}, cc.Effects, error) {
		s.add(in.Name)
		// Updates the island, but doesn't say the list's data changed (Stale): it's re-resolved from
		// the cache, as it was.
		return struct{}{}, cc.Effects{Update: []cc.IslandRef{{Screen: "list", Key: "items"}}}, nil
	})
	r := &recorder{TB: t}
	app := cctest.New(r, cc.New(cc.Config{
		Screens: []cc.Screen{{ID: "list", Islands: []cc.Placement{{Key: "items", Versions: cc.Versions(itemsIsland)}}}},
		Actions: []cc.Action{forgetsTheList},
		Cache:   cctest.NewMemoryCache(),
	}))

	cctest.CheckEffects(app, "list", nil, func() cctest.Outcome[struct{}] {
		return cctest.Perform(app, addInput{Name: "Milk"})
	})

	if len(r.errors) != 1 || !strings.Contains(r.errors[0], "served from the cache") {
		t.Fatalf("errors: %q", r.errors)
	}
}
