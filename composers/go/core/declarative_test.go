package clientcompose_test

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"strings"
	"sync"
	"testing"

	cc "github.com/client-compose/client-compose/composers/go/core"
	"github.com/client-compose/client-compose/composers/go/core/cctest"
	ca "github.com/client-compose/client-compose/composers/go/core/internal/conformanceaction"
)

// Hand-written stand-ins for generated props types.
type headerV1 struct {
	Name string `json:"name"`
}

func (headerV1) IslandType() string { return "header" }
func (headerV1) IslandVersion() int { return 1 }

type formV1 struct {
	Label string `json:"label"`
}

func (formV1) IslandType() string { return "form" }
func (formV1) IslandVersion() int { return 1 }

type viewerKey struct{}

// signedIn and the context function are what an auth integration would provide.
var signedIn cc.Requirement = func(ctx context.Context, _ cc.Request) error {
	if _, ok := ctx.Value(viewerKey{}).(string); !ok {
		return cc.ErrUnauthenticated
	}
	return nil
}

func viewerFromHeader(ctx context.Context, r *http.Request) (context.Context, error) {
	switch token := r.Header.Get("Authorization"); token {
	case "":
		return ctx, nil
	case "bad":
		return ctx, cc.ErrUnauthenticated
	default:
		return context.WithValue(ctx, viewerKey{}, token), nil
	}
}

func profileScreen() cc.Screen {
	header := cc.Define(func(ctx context.Context, r cc.Request) (headerV1, error) {
		return headerV1{Name: r.Params["userId"]}, nil
	})
	return cc.Screen{
		ID: "profile",
		Islands: []cc.Placement{
			{Key: "header", Versions: cc.Versions(header), Required: true},
			cc.Static("edit", formV1{Label: "Edit profile"}),
		},
	}
}

func TestDeclaredScreens(t *testing.T) {
	ownProfile := func(ctx context.Context, r cc.Request) (bool, error) {
		return ctx.Value(viewerKey{}) == r.Params["userId"], nil
	}
	screen := profileScreen()
	screen.Islands[1].When = ownProfile
	app := cctest.New(t, cc.New(cc.Config{Screens: []cc.Screen{screen}, Context: viewerFromHeader}))

	// The kit declares every island the composer's declared screens place.
	mine := app.Screen("profile", cctest.Params{"userId": "ada"}, cctest.Header("Authorization", "ada"))
	if got := mine.Keys(); !slices.Equal(got, []string{"header", "edit"}) {
		t.Fatalf("own profile: %v", got)
	}
	if cctest.Props[headerV1](t, mine, "header").Name != "ada" || cctest.Props[formV1](t, mine, "edit").Label != "Edit profile" {
		t.Fatalf("props: %+v", mine.Response.Islands)
	}
	// When hides the form on someone else's profile.
	if got := app.Screen("profile", cctest.Params{"userId": "grace"}, cctest.Header("Authorization", "ada")).Keys(); !slices.Equal(got, []string{"header"}) {
		t.Fatalf("someone else's: %v", got)
	}
}

func TestRequirementsAndContext(t *testing.T) {
	screen := profileScreen()
	screen.Requires = []cc.Requirement{signedIn}
	follow := cc.DefineAction(func(_ context.Context, _ cc.Call, in ca.ConformanceV1Input) (ca.ConformanceV1Result, cc.Effects, error) {
		return ca.ConformanceV1Result{Echo: in.Echo, Version: 1}, cc.Effects{}, nil
	}).Requires(signedIn)
	app := cctest.New(t, cc.New(cc.Config{Screens: []cc.Screen{screen}, Actions: []cc.Action{follow}, Context: viewerFromHeader}))

	if s := app.Screen("profile", nil); s.Status != 401 || s.Error != "unauthenticated" {
		t.Fatalf("signed out: %d %s", s.Status, s.Error)
	}
	if s := app.Screen("profile", nil, cctest.Header("Authorization", "bad")); s.Status != 401 {
		t.Fatalf("a bad token: %d %s", s.Status, s.Error)
	}
	if s := app.Screen("profile", nil, cctest.Header("Authorization", "ada")); s.Status != 200 {
		t.Fatalf("signed in: %d %s", s.Status, s.Error)
	}
	input := ca.ConformanceV1Input{Outcome: "ok", Echo: "hi"}
	if out := cctest.Perform(app, input); out.HTTPStatus != 401 || out.Error != "unauthenticated" {
		t.Fatalf("action signed out: %+v", out)
	}
	// Requirements come before input validation: a signed-out caller learns nothing about the input.
	if out := cctest.Perform(app, ca.ConformanceV1Input{}); out.Error != "unauthenticated" {
		t.Fatalf("invalid input signed out: %+v", out)
	}
	if out := cctest.Perform(app, input, cctest.Header("Authorization", "ada")); out.Status != "ok" || out.Result.Echo != "hi" {
		t.Fatalf("action signed in: %+v", out)
	}
}

func TestRequirementsSeeParamsAndWhenCanFail(t *testing.T) {
	// The viewer may only see their own profile; missing profiles are 404s.
	ownProfileOnly := func(ctx context.Context, r cc.Request) error {
		switch id := r.Params["userId"]; {
		case id == "nobody":
			return fmt.Errorf("profile %s: %w", id, cc.ErrNotFound)
		case ctx.Value(viewerKey{}) != id:
			return cc.ErrForbidden
		}
		return nil
	}
	screen := profileScreen()
	screen.Requires = []cc.Requirement{signedIn, ownProfileOnly}
	screen.Islands[1].When = func(_ context.Context, r cc.Request) (bool, error) {
		switch r.Params["form"] {
		case "gone":
			return false, cc.ErrNotFound
		case "broken":
			return false, errors.New("forms service down")
		}
		return true, nil
	}
	var failures []cc.Failure
	app := cctest.New(t, cc.New(cc.Config{
		Screens: []cc.Screen{screen},
		Context: viewerFromHeader,
		Use:     []cc.Plugin{cc.ReportErrors(func(_ context.Context, f cc.Failure) { failures = append(failures, f) })},
	}))
	ada := cctest.Header("Authorization", "ada")

	for _, tc := range []struct {
		params cctest.Params
		status int
		error  string
	}{
		{cctest.Params{"userId": "ada"}, 200, ""},
		{cctest.Params{"userId": "grace"}, 403, "forbidden"},
		{cctest.Params{"userId": "nobody"}, 404, "not_found"},
		{cctest.Params{"userId": "ada", "form": "gone"}, 404, "not_found"},
		{cctest.Params{"userId": "ada", "form": "broken"}, 500, "layout_failed"},
	} {
		if s := app.Screen("profile", tc.params, ada); s.Status != tc.status || s.Error != tc.error {
			t.Errorf("%v: %d %s, want %d %s", tc.params, s.Status, s.Error, tc.status, tc.error)
		}
	}
	if len(failures) != 1 || failures[0].Kind != cc.LayoutFailed || failures[0].Err.Error() != "forms service down" {
		t.Fatalf("failures %+v", failures)
	}
}

func TestPluginsWrapInOrderAndHearFailures(t *testing.T) {
	var mu sync.Mutex
	var calls []string
	record := func(s string) {
		mu.Lock()
		defer mu.Unlock()
		calls = append(calls, s)
	}
	tracing := func(name string) cc.Plugin {
		return cc.Plugin{
			Screen: func(next cc.ComposeFunc) cc.ComposeFunc {
				return func(ctx context.Context, req cc.ScreenRequest) cc.Result {
					record(name + ":screen:" + req.Screen)
					return next(ctx, req)
				}
			},
			Island: func(next cc.ResolveFunc) cc.ResolveFunc {
				return func(ctx context.Context, call cc.IslandCall) (any, error) {
					record(name + ":island:" + call.Key)
					return next(ctx, call)
				}
			},
		}
	}
	var failures []cc.Failure
	broken := cc.NewIsland("broken", 1, func(context.Context, cc.Request) (struct{}, error) { return struct{}{}, errors.New("down") })
	screen := cc.Screen{ID: "s", Islands: []cc.Placement{{Key: "b", Versions: cc.Versions(broken)}}}
	app := cctest.New(t, cc.New(cc.Config{
		Screens: []cc.Screen{screen},
		Use: []cc.Plugin{tracing("outer"), tracing("inner"), cc.ReportErrors(func(_ context.Context, f cc.Failure) {
			failures = append(failures, f)
		})},
	}))

	if s := app.Screen("s", nil); s.Status != 200 || s.Response.Islands[0].Error.Code != "resolve_failed" {
		t.Fatalf("screen: %+v", s)
	}
	if want := []string{"outer:screen:s", "inner:screen:s", "outer:island:b", "inner:island:b"}; !slices.Equal(calls, want) {
		t.Fatalf("calls %v, want %v", calls, want)
	}
	if len(failures) != 1 || failures[0].Kind != cc.IslandFailed || failures[0].Key != "b" || failures[0].Screen != "s" {
		t.Fatalf("failures %+v", failures)
	}
}

func TestConfigMistakesPanic(t *testing.T) {
	for name, cfg := range map[string]cc.Config{
		"two screens with one id":      {Screens: []cc.Screen{profileScreen(), profileScreen()}},
		"neither islands nor a layout": {Screens: []cc.Screen{{ID: "empty"}}},
		"both islands and a layout": {Screens: []cc.Screen{{
			ID:      "both",
			Islands: []cc.Placement{},
			Layout:  func(context.Context, cc.Request) ([]cc.Placement, error) { return nil, nil },
		}}},
	} {
		t.Run(name, func(t *testing.T) {
			defer func() {
				if rec := recover(); rec == nil || !strings.Contains(fmt.Sprint(rec), "clientcompose:") {
					t.Fatalf("recovered %v", rec)
				}
			}()
			cc.New(cfg)
		})
	}
}

func TestLoadMany(t *testing.T) {
	var fetches [][]string
	var mu sync.Mutex
	users := cc.NewBatchLoader(func(_ context.Context, ids []string) (map[string]string, error) {
		mu.Lock()
		fetches = append(fetches, slices.Sorted(slices.Values(ids)))
		mu.Unlock()
		out := map[string]string{}
		for _, id := range ids {
			if id != "missing" {
				out[id] = strings.ToUpper(id)
			}
		}
		return out, nil
	})
	var got map[string]string
	var missing error
	screen := cc.Screen{ID: "s", Layout: func(ctx context.Context, _ cc.Request) ([]cc.Placement, error) {
		var err error
		got, err = users.LoadMany(ctx, []string{"a", "b", "a"})
		if err != nil {
			return nil, err
		}
		_, missing = users.LoadMany(ctx, []string{"c", "missing"})
		return nil, nil
	}}
	cctest.New(t, cc.New(cc.Config{Screens: []cc.Screen{screen}})).Screen("s", nil)
	if got["a"] != "A" || got["b"] != "B" || len(got) != 2 {
		t.Fatalf("got %v", got)
	}
	if !errors.Is(missing, cc.ErrNotFound) {
		t.Fatalf("missing: %v", missing)
	}
	if !slices.Equal(fetches[0], []string{"a", "b"}) {
		t.Fatalf("fetches %v", fetches)
	}
}
