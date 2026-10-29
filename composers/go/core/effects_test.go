package clientcompose_test

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"testing"

	cc "github.com/client-compose/client-compose/composers/go/core"
	"github.com/client-compose/client-compose/composers/go/core/cctest"
)

// As codegen generates them for a list of items, and a count of what's left.

type itemsV1 struct {
	Items []itemsV1Item `json:"items"`
}

type itemsV1Item struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Done bool   `json:"done"`
}

func (itemsV1) IslandType() string { return "items" }
func (itemsV1) IslandVersion() int { return 1 }
func (itemsV1) IslandEntities() []cc.EntityPath {
	return []cc.EntityPath{{Path: []string{"items", "[]"}, Entity: "item", ID: "id", Properties: []string{"id", "name", "done"}}}
}

type leftV1 struct {
	ID   string `json:"id"`
	Left int    `json:"left"`
}

func (leftV1) IslandType() string { return "left" }
func (leftV1) IslandVersion() int { return 1 }
func (leftV1) IslandEntities() []cc.EntityPath {
	return []cc.EntityPath{{Path: []string{}, Entity: "item-count", ID: "id", Properties: []string{"id", "left"}}}
}

type itemEntity struct {
	Name *string `json:"name,omitempty"`
	Done *bool   `json:"done,omitempty"`
}

func (itemEntity) EntityName() string { return "item" }

type itemCountEntity struct {
	Left *int `json:"left,omitempty"`
}

func (itemCountEntity) EntityName() string { return "item-count" }

type finishInput struct {
	ID string `json:"id"`
}

func (finishInput) ActionName() string { return "finish" }
func (finishInput) ActionVersion() int { return 1 }
func (finishInput) ActionInputSchema() string {
	return `{"type":"object","required":["id"],"properties":{"id":{"type":"string"}}}`
}

func (finishInput) ActionErrorCodes() []string {
	return nil
}
func (finishInput) ActionResult(struct{}) {}

type addInput struct {
	Name string `json:"name"`
}

func (addInput) ActionName() string { return "add" }
func (addInput) ActionVersion() int { return 1 }
func (addInput) ActionInputSchema() string {
	return `{"type":"object","required":["name"],"properties":{"name":{"type":"string"}}}`
}

func (addInput) ActionErrorCodes() []string {
	return nil
}
func (addInput) ActionResult(struct{}) {}

// items is the list the islands show, and the actions change.
type items struct {
	mu   sync.Mutex
	list []itemsV1Item
}

func (s *items) all() []itemsV1Item {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]itemsV1Item(nil), s.list...)
}

func (s *items) left() int {
	n := 0
	for _, item := range s.all() {
		if !item.Done {
			n++
		}
	}
	return n
}

func (s *items) finish(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.list {
		if s.list[i].ID == id {
			s.list[i].Done = true
		}
	}
}

func (s *items) add(name string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.list = append(s.list, itemsV1Item{ID: fmt.Sprint(len(s.list) + 1), Name: name})
}

// listComposer serves a screen of items and what's left, and actions to finish and add one. The
// items island loads the list through Load, so it would see the action's own load if it shared it.
func listComposer(s *items, finish func(id string) cc.Effects, opts ...func(*cc.Screen)) *cc.Composer {
	itemsIsland := cc.Define(func(ctx context.Context, _ cc.Request) (itemsV1, error) {
		all, err := cc.Load(ctx, "items", func(context.Context) ([]itemsV1Item, error) { return s.all(), nil })
		return itemsV1{Items: all}, err
	})
	leftIsland := cc.Define(func(context.Context, cc.Request) (leftV1, error) {
		return leftV1{ID: "all", Left: s.left()}, nil
	})
	screen := cc.Screen{ID: "list", Islands: []cc.Placement{
		{Key: "items", Versions: cc.Versions(itemsIsland)},
		{Key: "left", Versions: cc.Versions(leftIsland)},
	}}
	for _, o := range opts {
		o(&screen)
	}
	return cc.New(cc.Config{
		Screens: []cc.Screen{screen},
		Actions: []cc.Action{
			cc.DefineAction(func(_ context.Context, _ cc.Call, in finishInput) (struct{}, cc.Effects, error) {
				s.finish(in.ID)
				return struct{}{}, finish(in.ID), nil
			}),
			cc.DefineAction(func(ctx context.Context, _ cc.Call, in addInput) (struct{}, cc.Effects, error) {
				// Loaded before the change, as an action checking the list first would.
				if _, err := cc.Load(ctx, "items", func(context.Context) ([]itemsV1Item, error) { return s.all(), nil }); err != nil {
					return struct{}{}, cc.Effects{}, err
				}
				s.add(in.Name)
				return struct{}{}, cc.Effects{Update: []cc.IslandRef{{Screen: "list", Key: "items"}, {Screen: "list", Key: "left"}}}, nil
			}),
		},
	})
}

func finished(id string, left int) cc.Effects {
	done := true
	return cc.Effects{Changes: []cc.EntityChange{
		cc.Set(id, itemEntity{Done: &done}),
		cc.Set("all", itemCountEntity{Left: &left}),
	}}
}

func TestChangesGoToClientsAsTheActionSetThem(t *testing.T) {
	s := &items{list: []itemsV1Item{{ID: "1", Name: "Milk"}}}
	app := cctest.New(t, listComposer(s, func(id string) cc.Effects {
		return cc.Effects{Changes: []cc.EntityChange{cc.Set(id, itemEntity{Name: nil}), cc.Delete[itemEntity]("2")}}
	}))

	out := cctest.Perform(app, finishInput{ID: "1"})

	if len(out.Effects.Changes) != 2 {
		t.Fatalf("changes: %+v", out.Effects.Changes)
	}
	if set, _ := out.Effects.Changes[0].Set.(map[string]any); out.Effects.Changes[0].Entity != "item" || out.Effects.Changes[0].ID != "1" || len(set) != 0 {
		t.Fatalf("set: %+v", out.Effects.Changes[0])
	}
	if del := out.Effects.Changes[1]; !del.Delete || del.ID != "2" || del.Set != nil {
		t.Fatalf("delete: %+v", del)
	}
}

func TestAnUpdateIsTheIslandResolvedAgainInAFreshScope(t *testing.T) {
	s := &items{}
	app := cctest.New(t, listComposer(s, func(string) cc.Effects { return cc.Effects{} }))

	out := cctest.Perform(app, addInput{Name: "Milk"})

	if len(out.Effects.Updated) != 2 || len(out.Effects.Invalidate) != 0 {
		t.Fatalf("effects: %+v", out.Effects)
	}
	update := out.Effects.Updated[0]
	if update.Screen != "list" || update.Island.Key != "items" || update.Island.Version != 1 || update.Island.Status != "ok" {
		t.Fatalf("update: %+v", update)
	}
	// The action loaded the list before adding to it; the update has the item it added.
	if got := fmt.Sprint(update.Island.Props); got != "map[items:[map[done:false id:1 name:Milk]]]" {
		t.Fatalf("props: %s", got)
	}
}

func TestAnUpdateTheClientCantTakeInvalidatesTheScreen(t *testing.T) {
	gone := func(screen *cc.Screen) {
		screen.Islands[1].When = func(context.Context, cc.Request) (bool, error) { return false, nil }
	}
	failing := func(screen *cc.Screen) {
		screen.Islands[0].Versions = cc.Versions(cc.Define(func(context.Context, cc.Request) (itemsV1, error) {
			return itemsV1{}, errors.New("down")
		}))
	}
	for name, app := range map[string]*cctest.App{
		"not on the screen any more":  cctest.New(t, listComposer(&items{}, nil, gone)),
		"failing":                     cctest.New(t, listComposer(&items{}, nil, failing)),
		"no version the client knows": cctest.New(t, listComposer(&items{}, nil), cctest.Declare(leftV1{})),
	} {
		out := cctest.Perform(app, addInput{Name: "Milk"})
		if len(out.Effects.Invalidate) == 0 || out.Effects.Invalidate[0].Screen != "list" {
			t.Errorf("%s: %+v", name, out.Effects)
		}
	}
}

func TestCheckEffectsPassesWhenAnActionSaysEverythingItChanged(t *testing.T) {
	s := &items{list: []itemsV1Item{{ID: "1", Name: "Milk"}, {ID: "2", Name: "Eggs"}}}
	app := cctest.New(t, listComposer(s, func(id string) cc.Effects { return finished(id, s.left()) }))

	cctest.CheckEffects(app, "list", nil, func() cctest.Outcome[struct{}] {
		return cctest.Perform(app, finishInput{ID: "1"})
	})
	cctest.CheckEffects(app, "list", nil, func() cctest.Outcome[struct{}] {
		return cctest.Perform(app, addInput{Name: "Bread"})
	})
}

// recorder is a test that keeps its errors, to check a check fails.
type recorder struct {
	testing.TB
	errors []string
}

func (r *recorder) Errorf(format string, args ...any) {
	r.errors = append(r.errors, fmt.Sprintf(format, args...))
}

func TestCheckEffectsCatchesWhatAnActionForgot(t *testing.T) {
	s := &items{list: []itemsV1Item{{ID: "1", Name: "Milk"}, {ID: "2", Name: "Eggs"}}}
	forgetsTheCount := func(id string) cc.Effects {
		done := true
		return cc.Effects{Changes: []cc.EntityChange{cc.Set(id, itemEntity{Done: &done})}}
	}
	r := &recorder{TB: t}
	app := cctest.New(r, listComposer(s, forgetsTheCount))

	cctest.CheckEffects(app, "list", nil, func() cctest.Outcome[struct{}] {
		return cctest.Perform(app, finishInput{ID: "1"})
	})

	if len(r.errors) != 1 {
		t.Fatalf("errors: %q", r.errors)
	}
}
