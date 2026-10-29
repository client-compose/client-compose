package clientcompose

import (
	"context"
)

// Entity is implemented by generated entity types (see codegen/): what an action can set on one
// entity (spec §2.1), each property absent unless it changed.
type Entity interface {
	EntityName() string
}

// EntityPath says where an island's props hold an entity (spec §2.1). Generated islands that hold
// entities list theirs in IslandEntities.
type EntityPath struct {
	// Path runs from the props down: property names, "[]" for an array's items, "{}" for a map's
	// values.
	Path   []string `json:"path"`
	Entity string   `json:"entity"`
	// ID is the property that identifies one.
	ID string `json:"id"`
	// Properties are the entity's properties the island shows, the id among them.
	Properties []string `json:"properties"`
}

// EntityChange is what an action changed about one entity (spec §5.3): properties it set, or that
// it's gone. Build one with Set or Delete.
type EntityChange struct {
	Entity string `json:"entity"`
	ID     string `json:"id"`
	Set    any    `json:"set,omitempty"`
	Delete bool   `json:"delete,omitempty"`
}

// Set says an action changed some of an entity's properties: the ones set in change.
//
//	cc.Set("3", TodoEntity{Done: &done})
func Set[E Entity](id string, change E) EntityChange {
	return EntityChange{Entity: change.EntityName(), ID: id, Set: change}
}

// Delete says an entity is gone. Clients remove it from the lists that hold it.
//
//	cc.Delete[TodoEntity]("3")
func Delete[E Entity](id string) EntityChange {
	var zero E
	return EntityChange{Entity: zero.EntityName(), ID: id, Delete: true}
}

// IslandRef names an island on the screen with exactly these params (spec §5.3), for an action to
// say its content changed.
type IslandRef struct {
	Screen string
	Params map[string]string
	Key    string
}

// IslandUpdate is an island's new entry, for the screen with these exact params (spec §5.3).
type IslandUpdate struct {
	Screen string            `json:"screen"`
	Params map[string]string `json:"params"`
	Island IslandEntry       `json:"island"`
}

// islandEntities is implemented by generated props types whose islands hold entities.
type islandEntities interface {
	IslandEntities() []EntityPath
}

// entitiesOf are where props of type P hold entities, if any.
func entitiesOf[P any]() []EntityPath {
	var zero P
	if e, ok := any(zero).(islandEntities); ok {
		return e.IslandEntities()
	}
	return nil
}

// EntityPaths are where an island version's props hold entities (spec §2.1), for test kits to
// apply changes the way clients do.
func (c *Composer) EntityPaths(typ string, version int) []EntityPath {
	for _, s := range c.screens {
		for _, p := range s.Islands {
			for _, v := range p.Versions {
				if v.Type == typ && v.Version == version {
					return v.entities
				}
			}
		}
	}
	return nil
}

// resolveUpdates resolves the islands an action named in Update, as island requests would (spec
// §5.3), at the versions the client knows. An island that isn't on its screen any more, that fails,
// or that the client has no version of is its screen's to reload instead: it's invalidated.
//
// Each is resolved in a request scope of its own, so it doesn't read what the action loaded before
// it made its change.
func (c *Composer) resolveUpdates(ctx context.Context, effects Effects, client ClientContext, islands map[string][]int) Effects {
	for _, ref := range effects.Update {
		entry, ok := c.resolveUpdate(ctx, ref, client, islands)
		if !ok {
			effects.Invalidate = append(effects.Invalidate, ScreenRef{Screen: ref.Screen, Params: ref.Params})
			continue
		}
		effects.Updated = append(effects.Updated, IslandUpdate{Screen: ref.Screen, Params: ref.Params, Island: entry})
	}
	effects.Update = nil
	return effects
}

func (c *Composer) resolveUpdate(parent context.Context, ref IslandRef, client ClientContext, islands map[string][]int) (IslandEntry, bool) {
	screen, ok := c.screens[ref.Screen]
	if !ok {
		return IslandEntry{}, false
	}

	ctx, endRequest := withRequestScope(parent)
	defer endRequest()

	params := ref.Params
	if params == nil {
		params = map[string]string{}
	}
	words := c.words(client.Locale)
	r := Request{Screen: screen.ID, Params: params, Client: client, words: words}
	placements, err := c.placements(ctx, screen, r)
	if err != nil {
		return IslandEntry{}, false
	}

	for _, p := range placements {
		if p.Key != ref.Key || len(p.Versions) == 0 {
			continue
		}
		island, ok := Negotiate(p.Versions, islands[p.Versions[0].Type])
		if !ok {
			return IslandEntry{}, false
		}
		entry, err := c.resolveEntry(ctx, p, island, r, words)

		return entry, err == nil && entry.Status == "ok"
	}

	return IslandEntry{}, false
}
