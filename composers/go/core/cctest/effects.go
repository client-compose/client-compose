package cctest

import (
	"encoding/json"
	"slices"

	cc "github.com/client-compose/client-compose/composers/go/core"
)

// CheckEffects checks that an action leaves a screen as resolving it again would (spec §5.3). It
// shows the screen, performs the action, applies its changes and updates to what it showed, as a
// client would, and composes the screen again: any island that differs fails the test. A change
// the action forgot, such as a count it didn't update, shows here rather than in an app.
//
//	out := cctest.CheckEffects(app, "todos", nil, func() cctest.Outcome[ToggleTodoV1Result] {
//		return cctest.Perform(app, ToggleTodoV1Input{ID: "3", Done: true})
//	})
//
// A screen the action invalidates is reloaded by clients, so there's nothing to check on it. The
// screen is requested with opts, such as the session of whoever's looking at it:
//
//	cctest.CheckEffects(app, "drafts", nil, perform, cctest.Header("Authorization", "Bearer "+token))
func CheckEffects[R any](a *App, screen string, params Params, perform func() Outcome[R], opts ...RequestOption) Outcome[R] {
	a.t.Helper()
	if a.composer == nil {
		a.t.Fatal("cctest: CheckEffects needs the composer: pass cctest.Composer when the handler wraps it")
	}
	before := a.Screen(screen, params, opts...)
	out := perform()
	if out.Status != "ok" || invalidates(out.Effects.Invalidate, screen, params) {
		return out
	}

	shown, reload := a.applyEffects(before.Response.Islands, out.Effects, screen, params)
	if reload {
		return out
	}
	after := a.Screen(screen, params, opts...)
	if !slices.Equal(keysOf(shown), after.Keys()) {
		a.t.Errorf("cctest: after its effects, screen %q shows %v, but composed again it has %v: invalidate it", screen, keysOf(shown), after.Keys())
		return out
	}
	for i, entry := range shown {
		got, want := asJSON(a, entry.Props), asJSON(a, after.Response.Islands[i].Props)
		if got != want {
			a.t.Errorf("cctest: after its effects, island %q shows\n\t%s\nbut composed again it's\n\t%s", entry.Key, got, want)
		}
	}
	return out
}

// applyEffects applies an action's changes and updates to a screen's islands, as a client would,
// and says when the client would reload it instead.
func (a *App) applyEffects(islands []cc.IslandEntry, effects cc.Effects, screen string, params Params) ([]cc.IslandEntry, bool) {
	out := slices.Clone(islands)
	for i, entry := range out {
		if entry.Status != "ok" {
			continue
		}
		props := roundTrip(a, entry.Props)
		for _, path := range a.composer.EntityPaths(entry.Type, entry.Version) {
			var reload bool
			props, reload = applyAlong(props, path, path.Path, effects.Changes, false)
			if reload {
				return nil, true
			}
		}
		out[i].Props = props
	}
	for _, update := range effects.Updated {
		if update.Screen != screen || !sameParams(update.Params, params) {
			continue
		}
		i := slices.IndexFunc(out, func(e cc.IslandEntry) bool { return e.Key == update.Island.Key })
		if i < 0 || out[i].Type != update.Island.Type {
			return nil, true
		}
		out[i] = update.Island
	}
	return out, false
}

// applyAlong applies changes to the entities at the end of a path (spec §5.3). It returns the new
// value, nil for an entity deleted from an array, and reload when one was deleted from anywhere
// else.
func applyAlong(value any, path cc.EntityPath, rest []string, changes []cc.EntityChange, inArray bool) (any, bool) {
	if len(rest) == 0 {
		object, ok := value.(map[string]any)
		if !ok {
			return value, false
		}
		change, ok := changeFor(object, path, changes)
		if !ok {
			return value, false
		}
		if change.Delete {
			return nil, !inArray
		}
		set, _ := roundTripMap(change.Set)
		copied := copyMap(object)
		for name, v := range set {
			if slices.Contains(path.Properties, name) {
				copied[name] = v
			}
		}
		return copied, false
	}

	step, next := rest[0], rest[1:]
	switch v := value.(type) {
	case []any:
		if step != "[]" {
			return value, false
		}
		kept := []any{}
		for _, item := range v {
			changed, reload := applyAlong(item, path, next, changes, len(next) == 0)
			if reload {
				return nil, true
			}
			if changed != nil || len(next) > 0 {
				kept = append(kept, changed)
			}
		}
		return kept, false
	case map[string]any:
		copied := copyMap(v)
		for key, item := range v {
			if step != "{}" && step != key {
				continue
			}
			changed, reload := applyAlong(item, path, next, changes, false)
			if reload {
				return nil, true
			}
			copied[key] = changed
		}
		return copied, false
	}
	return value, false
}

func changeFor(object map[string]any, path cc.EntityPath, changes []cc.EntityChange) (cc.EntityChange, bool) {
	for _, c := range changes {
		if c.Entity == path.Entity && object[path.ID] == c.ID {
			return c, true
		}
	}
	return cc.EntityChange{}, false
}

func invalidates(refs []cc.ScreenRef, screen string, params Params) bool {
	for _, ref := range refs {
		if ref.Screen != screen {
			continue
		}
		matches := true
		for k, v := range ref.Params {
			if params[k] != v {
				matches = false
			}
		}
		if matches {
			return true
		}
	}
	return false
}

func sameParams(a map[string]string, b Params) bool {
	if len(a) != len(b) {
		return false
	}
	for k, v := range a {
		if b[k] != v {
			return false
		}
	}
	return true
}

func keysOf(islands []cc.IslandEntry) []string {
	keys := make([]string, len(islands))
	for i, e := range islands {
		keys[i] = e.Key
	}
	return keys
}

func copyMap(m map[string]any) map[string]any {
	out := make(map[string]any, len(m))
	for k, v := range m {
		out[k] = v
	}
	return out
}

// roundTrip is a value as JSON decodes it: maps, slices and plain values.
func roundTrip(a *App, value any) any {
	raw, err := json.Marshal(value)
	if err != nil {
		a.t.Fatal(err)
	}
	var out any
	decode(a.t, raw, &out)
	return out
}

func roundTripMap(value any) (map[string]any, error) {
	raw, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	var out map[string]any
	err = json.Unmarshal(raw, &out)
	return out, err
}

func asJSON(a *App, value any) string {
	raw, err := json.Marshal(value)
	if err != nil {
		a.t.Fatal(err)
	}
	return string(raw)
}
