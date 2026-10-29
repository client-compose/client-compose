package main

import (
	"context"

	cc "github.com/client-compose/client-compose/composers/go/core"
)

// todosScreen is the one screen: a field for a new todo, the list, and a summary while there's
// anything in it.
func todosScreen(todos *Todos) cc.Screen {
	list := cc.Define(func(context.Context, cc.Request) (TodoListV1, error) {
		items := []TodoListV1Todo{}
		for _, todo := range todos.All() {
			items = append(items, TodoListV1Todo(todo))
		}

		return TodoListV1{Todos: items}, nil
	})

	summary := cc.Define(func(context.Context, cc.Request) (TodoSummaryV1, error) {
		var out TodoSummaryV1
		for _, todo := range todos.All() {
			if todo.Done {
				out.Done++
			} else {
				out.Left++
			}
		}

		return out, nil
	})

	anyTodos := func(context.Context, cc.Request) (bool, error) {
		return len(todos.All()) > 0, nil
	}

	return cc.Screen{
		ID: "todos",
		Islands: []cc.Placement{
			cc.Static("new", NewTodoV1{MaxLength: MaxTitleLength}),
			{Key: "list", Versions: cc.Versions(list), Required: true},
			{Key: "summary", Versions: cc.Versions(summary), When: anyTodos},
		},
		Meta: func(_ context.Context, r cc.Request) (cc.ScreenMeta, error) {
			return cc.ScreenMeta{Title: TodosScreenStringsFor(r).Title()}, nil
		},
	}
}
