package main

import (
	"context"

	cc "github.com/client-compose/client-compose/composers/go/core"
)

// countsID identifies the list's counts (entity "todo-counts"): there's one list.
const countsID = "all"

// screen is the todos screen, which every action changes.
var screen = cc.ScreenRef{Screen: "todos"}

// Each action says what it changed as narrowly as it can (spec §5.3): the todos and counts it
// changed, the list when a new todo joins it, and the whole screen only when the summary appears or
// goes, because the list became empty or stopped being empty.

// counted is the change to the list's counts, after an action.
func counted(todos *Todos) cc.EntityChange {
	left, done := todos.Counts()

	return cc.Set(countsID, TodoCountsEntity{Left: &left, Done: &done})
}

// emptied is the screen to reload when an action left the list empty: the summary goes.
func emptied(todos *Todos, effects cc.Effects) cc.Effects {
	if len(todos.All()) == 0 {
		return cc.Effects{Invalidate: []cc.ScreenRef{screen}}
	}

	return effects
}

func todoActions(todos *Todos) []cc.Action {
	addTodo := cc.DefineAction(func(_ context.Context, _ cc.Call, in AddTodoV1Input) (AddTodoV1Result, cc.Effects, error) {
		switch CheckTitle(in.Title) {
		case TitleEmpty:
			return AddTodoV1Result{}, cc.Effects{}, AddTodoV1EmptyTitle{}
		case TitleTooLong:
			return AddTodoV1Result{}, cc.Effects{}, AddTodoV1TitleTooLong{MaxLength: MaxTitleLength}
		case TitleOK:
		}
		first := len(todos.All()) == 0
		todo := todos.Add(in.Title)

		// The first todo brings the summary with it.
		if first {
			return AddTodoV1Result{ID: todo.ID}, cc.Effects{Invalidate: []cc.ScreenRef{screen}}, nil
		}

		return AddTodoV1Result{ID: todo.ID}, cc.Effects{
			Changes: []cc.EntityChange{counted(todos)},
			Update:  []cc.IslandRef{{Screen: screen.Screen, Key: "list"}},
		}, nil
	})

	toggleTodo := cc.DefineAction(func(_ context.Context, _ cc.Call, in ToggleTodoV1Input) (ToggleTodoV1Result, cc.Effects, error) {
		todos.SetDone(in.ID, in.Done)

		return ToggleTodoV1Result{}, cc.Effects{Changes: []cc.EntityChange{
			cc.Set(in.ID, TodoEntity{Done: &in.Done}),
			counted(todos),
		}}, nil
	})

	deleteTodo := cc.DefineAction(func(_ context.Context, _ cc.Call, in DeleteTodoV1Input) (DeleteTodoV1Result, cc.Effects, error) {
		todos.Delete(in.ID)

		return DeleteTodoV1Result{}, emptied(todos, cc.Effects{Changes: []cc.EntityChange{
			cc.Delete[TodoEntity](in.ID),
			counted(todos),
		}}), nil
	})

	clearCompleted := cc.DefineAction(func(context.Context, cc.Call, ClearCompletedV1Input) (ClearCompletedV1Result, cc.Effects, error) {
		done := []cc.EntityChange{}
		for _, todo := range todos.All() {
			if todo.Done {
				done = append(done, cc.Delete[TodoEntity](todo.ID))
			}
		}
		cleared := todos.ClearDone()

		return ClearCompletedV1Result{Cleared: cleared}, emptied(todos, cc.Effects{Changes: append(done, counted(todos))}), nil
	})

	return []cc.Action{addTodo, toggleTodo, deleteTodo, clearCompleted}
}
