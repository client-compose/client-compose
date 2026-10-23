package clientcompose_test

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strconv"
	"sync"
	"testing"

	cc "github.com/client-compose/client-compose/composers/go/core"
	"github.com/client-compose/client-compose/composers/go/core/cctest"
)

// A hand-written stand-in for a generated props type: one page of a list.
type listV1 struct {
	Items []int `json:"items"`
}

func (listV1) IslandType() string { return "list" }
func (listV1) IslandVersion() int { return 1 }

// numbers is a paged island over 1..total, size at a time. Its cursor is the next offset.
func numbers(total, size int) cc.Island {
	return cc.DefinePaged(func(_ context.Context, r cc.Request) (listV1, string, error) {
		offset := 0
		if r.Cursor != "" {
			n, err := strconv.Atoi(r.Cursor)
			if err != nil || n <= 0 || n >= total {
				return listV1{}, "", fmt.Errorf("numbers: %q: %w", r.Cursor, cc.ErrInvalidCursor)
			}
			offset = n
		}
		var items []int
		for i := offset; i < min(offset+size, total); i++ {
			items = append(items, i+1)
		}
		next := ""
		if offset+size < total {
			next = strconv.Itoa(offset + size)
		}
		return listV1{Items: items}, next, nil
	})
}

func TestPagesFollowOnFromTheScreen(t *testing.T) {
	composer := cc.New(cc.Config{Screens: []cc.Screen{{
		ID: "numbers",
		Islands: []cc.Placement{
			{Key: "header", Versions: cc.Versions(cc.Define(func(context.Context, cc.Request) (headerV1, error) {
				return headerV1{Name: "Numbers"}, nil
			}))},
			{Key: "list", Versions: cc.Versions(numbers(5, 2))},
		},
	}}})
	app := cctest.New(t, composer)

	screen := app.Screen("numbers", cctest.Params{"q": "all"})
	first, _ := screen.Island("list")
	if got := cctest.Props[listV1](t, screen, "list").Items; !slices.Equal(got, []int{1, 2}) || first.Next != "2" {
		t.Fatalf("first page: %v, next %q", got, first.Next)
	}
	if header, _ := screen.Island("header"); header.Next != "" {
		t.Fatalf("an island without pages has no next: %q", header.Next)
	}

	second := app.NextPage(screen, "list")
	if got := cctest.IslandProps[listV1](t, second).Items; !slices.Equal(got, []int{3, 4}) || second.Entry.Next != "4" {
		t.Fatalf("second page: %v, next %q", got, second.Entry.Next)
	}
	third := app.Next(second)
	if got := cctest.IslandProps[listV1](t, third).Items; !slices.Equal(got, []int{5}) || third.Entry.Next != "" {
		t.Fatalf("last page: %v, next %q", got, third.Entry.Next)
	}

	// Without a cursor, the island is resolved again from its first page.
	again := app.Island("numbers", screen.Params, "list", 1, "")
	if got := cctest.IslandProps[listV1](t, again).Items; !slices.Equal(got, []int{1, 2}) {
		t.Fatalf("refreshed: %v", got)
	}
	refreshed := app.Island("numbers", nil, "header", 1, "")
	if cctest.IslandProps[headerV1](t, refreshed).Name != "Numbers" {
		t.Fatalf("an island without pages refreshes: %+v", refreshed)
	}

	for name, c := range map[string]struct {
		key     string
		version int
		cursor  string
		status  int
		code    string
	}{
		"a cursor it didn't make":   {"list", 1, "nope", 400, "invalid_cursor"},
		"a cursor without pages":    {"header", 1, "2", 400, "invalid_cursor"},
		"a version it doesn't have": {"list", 2, "", 400, "unsupported_island_version"},
		"a key it doesn't have":     {"footer", 1, "", 404, "unknown_island"},
	} {
		if got := app.Island("numbers", nil, c.key, c.version, c.cursor); got.Status != c.status || got.Error != c.code {
			t.Errorf("%s: %d %q, want %d %q", name, got.Status, got.Error, c.status, c.code)
		}
	}
	if got := app.Island("nowhere", nil, "list", 1, ""); got.Status != 404 || got.Error != "unknown_screen" {
		t.Errorf("unknown screen: %d %q", got.Status, got.Error)
	}
}

func TestAnIslandRequestIsLaidOutAsItsScreen(t *testing.T) {
	var mu sync.Mutex
	var resolved []string
	trace := cc.Plugin{Island: func(next cc.ResolveFunc) cc.ResolveFunc {
		return func(ctx context.Context, call cc.IslandCall) (any, error) {
			mu.Lock()
			resolved = append(resolved, fmt.Sprintf("%s:%s:%q", call.Screen, call.Key, call.Request.Cursor))
			mu.Unlock()
			return next(ctx, call)
		}
	}}
	shown := func(_ context.Context, r cc.Request) (bool, error) { return r.Params["show"] == "yes", nil }
	composer := cc.New(cc.Config{
		Context: viewerFromHeader,
		Use:     []cc.Plugin{trace},
		Screens: []cc.Screen{{
			ID:       "mine",
			Requires: []cc.Requirement{signedIn},
			Islands:  []cc.Placement{{Key: "list", Versions: cc.Versions(numbers(4, 2)), When: shown}},
		}},
	})
	app := cctest.New(t, composer)
	asAda := cctest.Header("Authorization", "ada")

	if got := app.Island("mine", cctest.Params{"show": "yes"}, "list", 1, "2"); got.Status != 401 || got.Error != "unauthenticated" {
		t.Fatalf("signed out: %d %q", got.Status, got.Error)
	}
	// The placement's condition runs too: hidden, it isn't there.
	if got := app.Island("mine", cctest.Params{"show": "no"}, "list", 1, "2", asAda); got.Status != 404 || got.Error != "unknown_island" {
		t.Fatalf("hidden: %d %q", got.Status, got.Error)
	}
	got := app.Island("mine", cctest.Params{"show": "yes"}, "list", 1, "2", asAda)
	if items := cctest.IslandProps[listV1](t, got).Items; !slices.Equal(items, []int{3, 4}) {
		t.Fatalf("page: %v", items)
	}
	// Plugins wrap an island request's resolver as they do a screen's, and see its cursor.
	if !slices.Equal(resolved, []string{`mine:list:"2"`}) {
		t.Fatalf("resolved: %v", resolved)
	}
}

func TestAFailingPageIsTheIslands(t *testing.T) {
	var reported []cc.Failure
	failing := cc.DefinePaged(func(context.Context, cc.Request) (listV1, string, error) {
		return listV1{}, "", errors.New("boom")
	})
	composer := cc.New(cc.Config{
		Use:     []cc.Plugin{cc.ReportErrors(func(_ context.Context, f cc.Failure) { reported = append(reported, f) })},
		Screens: []cc.Screen{{ID: "s", Islands: []cc.Placement{{Key: "list", Versions: cc.Versions(failing), Required: true}}}},
	})
	got := cctest.New(t, composer).Island("s", nil, "list", 1, "")
	if got.Status != 200 || got.Entry.Status != "error" || got.Entry.Error.Code != "resolve_failed" {
		t.Fatalf("got %+v", got)
	}
	if len(reported) != 1 || reported[0].Kind != cc.IslandFailed || reported[0].Key != "list" {
		t.Fatalf("reported %+v", reported)
	}
}

func TestPagedIslandsArentCached(t *testing.T) {
	defer func() {
		if recover() == nil {
			t.Fatal("CacheFor on a paged island should panic")
		}
	}()
	numbers(3, 1).CacheFor(0, func(context.Context, cc.Request) string { return "all" })
}
