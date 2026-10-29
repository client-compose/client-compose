package main

import (
	"os"
	"testing"

	cc "github.com/client-compose/client-compose/composers/go/core"
	"github.com/client-compose/client-compose/composers/go/core/cctest"
)

// The shared suite in ../tests checks this composer over HTTP, as it does every todo composer.
// These tests check the same things in-process, in Go.

func newApp(t *testing.T, locale string) *cctest.App {
	t.Helper()
	catalog, err := cc.LoadCatalog(os.DirFS("../strings"))
	if err != nil {
		t.Fatal(err)
	}

	return cctest.New(t, newComposer(&Todos{}, catalog), cctest.Client(cc.ClientContext{Platform: "test", AppVersion: "1", Locale: locale}))
}

func TestAnEmptyListHasNoSummary(t *testing.T) {
	app := newApp(t, "en")

	screen := app.Screen("todos", nil)
	if keys := screen.Keys(); len(keys) != 2 || keys[0] != "new" || keys[1] != "list" {
		t.Fatalf("islands: %v", keys)
	}
}

func TestAddingTodosCountsWhatsLeft(t *testing.T) {
	app := newApp(t, "en")

	// The first brings the summary, so the screen reloads; the next joins the list.
	if out := cctest.Perform(app, AddTodoV1Input{Title: "Buy milk"}); out.Status != "ok" || len(out.Effects.Invalidate) != 1 {
		t.Fatalf("first: %+v", out)
	}
	if out := cctest.Perform(app, AddTodoV1Input{Title: "  Walk the dog  "}); len(out.Effects.Updated) != 1 || len(out.Effects.Changes) != 1 {
		t.Fatalf("second: %+v", out)
	}

	screen := app.Screen("todos", nil)
	list := cctest.Props[TodoListV1](t, screen, "list")
	if len(list.Todos) != 2 || list.Todos[1].Title != "Walk the dog" {
		t.Fatalf("list: %+v", list)
	}

	summary := cctest.Props[TodoSummaryV1](t, screen, "summary")
	if summary.ID != "all" || summary.Left != 2 || summary.Done != 0 {
		t.Fatalf("summary: %+v", summary)
	}
}

func TestATitleMustSaySomething(t *testing.T) {
	app := newApp(t, "en")

	if out := cctest.Perform(app, AddTodoV1Input{Title: "   "}); out.Error != "empty_title" {
		t.Fatalf("empty: %+v", out)
	}

	long := make([]rune, MaxTitleLength+1)
	for i := range long {
		long[i] = 'a'
	}

	if out := cctest.Perform(app, AddTodoV1Input{Title: string(long)}); out.Error != "title_too_long" {
		t.Fatalf("too long: %+v", out)
	}
}

func TestTheScreenIsInTheClientsLanguage(t *testing.T) {
	app := newApp(t, "pl-PL")

	screen := app.Screen("todos", nil)
	if screen.Head.Meta == nil || screen.Head.Meta.Title != "Zadania" {
		t.Fatalf("meta: %+v", screen.Head.Meta)
	}
}

// Every action says what it changed, and nothing it forgot: applied to the screen as an app would,
// its effects match the screen composed again.
func TestEachActionSaysEverythingItChanged(t *testing.T) {
	app := newApp(t, "en")
	add := func(title string) cctest.Outcome[AddTodoV1Result] {
		return cctest.CheckEffects(app, "todos", nil, func() cctest.Outcome[AddTodoV1Result] {
			return cctest.Perform(app, AddTodoV1Input{Title: title})
		})
	}

	milk := add("Buy milk")
	add("Walk the dog")
	cctest.CheckEffects(app, "todos", nil, func() cctest.Outcome[ToggleTodoV1Result] {
		return cctest.Perform(app, ToggleTodoV1Input{ID: milk.Result.ID, Done: true})
	})
	cctest.CheckEffects(app, "todos", nil, func() cctest.Outcome[ClearCompletedV1Result] {
		return cctest.Perform(app, ClearCompletedV1Input{})
	})
	dog := cctest.Props[TodoListV1](t, app.Screen("todos", nil), "list").Todos[0]
	cctest.CheckEffects(app, "todos", nil, func() cctest.Outcome[DeleteTodoV1Result] {
		return cctest.Perform(app, DeleteTodoV1Input{ID: dog.ID})
	})
}
