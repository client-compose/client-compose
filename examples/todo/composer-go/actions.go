package main

import (
	"context"

	cc "github.com/client-compose/client-compose/composers/go/core"
)

// changedTodos tells apps that the todos screen changed, so the one on show reloads.
var changedTodos = cc.Effects{Invalidate: []cc.ScreenRef{{Screen: "todos"}}}

func todoActions(todos *Todos) []cc.Action {
	addTodo := cc.DefineAction(func(_ context.Context, _ cc.Call, in AddTodoV1Input) (AddTodoV1Result, cc.Effects, error) {
		switch CheckTitle(in.Title) {
		case TitleEmpty:
			return AddTodoV1Result{}, cc.Effects{}, AddTodoV1EmptyTitle{}
		case TitleTooLong:
			return AddTodoV1Result{}, cc.Effects{}, AddTodoV1TitleTooLong{MaxLength: MaxTitleLength}
		case TitleOK:
		}
		todo := todos.Add(in.Title)

		return AddTodoV1Result{ID: todo.ID}, changedTodos, nil
	})

	toggleTodo := cc.DefineAction(func(_ context.Context, _ cc.Call, in ToggleTodoV1Input) (ToggleTodoV1Result, cc.Effects, error) {
		todos.SetDone(in.ID, in.Done)

		return ToggleTodoV1Result{}, changedTodos, nil
	})

	deleteTodo := cc.DefineAction(func(_ context.Context, _ cc.Call, in DeleteTodoV1Input) (DeleteTodoV1Result, cc.Effects, error) {
		todos.Delete(in.ID)

		return DeleteTodoV1Result{}, changedTodos, nil
	})

	clearCompleted := cc.DefineAction(func(context.Context, cc.Call, ClearCompletedV1Input) (ClearCompletedV1Result, cc.Effects, error) {
		cleared := todos.ClearDone()

		return ClearCompletedV1Result{Cleared: cleared}, changedTodos, nil
	})

	return []cc.Action{addTodo, toggleTodo, deleteTodo, clearCompleted}
}
