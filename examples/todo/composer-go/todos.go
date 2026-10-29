package main

import (
	"strconv"
	"strings"
	"sync"
	"unicode/utf8"
)

// MaxTitleLength is the longest title a todo can have, in characters.
const MaxTitleLength = 100

// Todo is one thing to do.
type Todo struct {
	ID    string
	Title string
	Done  bool
}

// Todos is the list, kept in memory: a stand-in for your database or service.
type Todos struct {
	mu     sync.Mutex
	todos  []Todo
	nextID int
}

// All returns the todos, oldest first.
func (t *Todos) All() []Todo {
	t.mu.Lock()
	defer t.mu.Unlock()

	return append([]Todo(nil), t.todos...)
}

// Add adds a todo with this title, trimmed, and returns it. It doesn't check the title: see
// CheckTitle.
func (t *Todos) Add(title string) Todo {
	t.mu.Lock()
	defer t.mu.Unlock()

	t.nextID++
	todo := Todo{ID: strconv.Itoa(t.nextID), Title: strings.TrimSpace(title)}
	t.todos = append(t.todos, todo)

	return todo
}

// SetDone marks a todo done, or not done. A todo that isn't there is left alone.
func (t *Todos) SetDone(id string, done bool) {
	t.mu.Lock()
	defer t.mu.Unlock()

	for i := range t.todos {
		if t.todos[i].ID == id {
			t.todos[i].Done = done
		}
	}
}

// Delete deletes a todo. One that isn't there is left alone.
func (t *Todos) Delete(id string) {
	t.remove(func(todo Todo) bool { return todo.ID == id })
}

// ClearDone deletes every todo that's done, and returns how many it deleted.
func (t *Todos) ClearDone() int {
	return t.remove(func(todo Todo) bool { return todo.Done })
}

func (t *Todos) remove(match func(Todo) bool) int {
	t.mu.Lock()
	defer t.mu.Unlock()

	kept := t.todos[:0]
	for _, todo := range t.todos {
		if !match(todo) {
			kept = append(kept, todo)
		}
	}
	removed := len(t.todos) - len(kept)
	t.todos = kept

	return removed
}

// Counts says how many todos are left, and done.
func (t *Todos) Counts() (left, done int) {
	for _, todo := range t.All() {
		if todo.Done {
			done++
		} else {
			left++
		}
	}

	return left, done
}

// TitleProblem is what's wrong with a todo's title, if anything.
type TitleProblem int

const (
	TitleOK TitleProblem = iota
	TitleEmpty
	TitleTooLong
)

// CheckTitle says whether a title can be added.
func CheckTitle(title string) TitleProblem {
	trimmed := strings.TrimSpace(title)
	if trimmed == "" {
		return TitleEmpty
	}

	if utf8.RuneCountInString(trimmed) > MaxTitleLength {
		return TitleTooLong
	}

	return TitleOK
}
