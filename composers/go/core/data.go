package clientcompose

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

// Data is one kind of data your islands show (CMP-18): users, articles, a team's members, whether
// the viewer follows someone. Declare each kind once, at startup, with how to fetch many by key,
// and how it may be cached. How long something can be cached is a property of the data, not of the
// islands that show it: a user's name is the same wherever it appears, and whether the viewer
// follows someone is theirs wherever it appears.
//
// Within a request, loads batch and share, as a BatchLoader's do. Across requests, data that opts
// in with CacheFor is kept in the composer's Cache (Config.Cache), shared by every composer using
// it, until its TTL or until an action says it changed:
//
//	var users = cc.NewData("user", func(ctx context.Context, ids []string) (map[string]User, error) {
//		return store.Users(ctx, ids)
//	}).CacheFor(10*time.Minute).Tags(func(id string, _ User) []string {
//		return []string{cc.EntityTag("user", id)} // cleared when an action changes the user
//	})
//
//	var following = cc.NewData("following", store.Following).CacheFor(time.Hour).PerViewer()
//
//	// in any island's resolver:
//	author, err := users.Load(ctx, article.AuthorID)
//
// Every entry is filed under its own tag (Tag) and the tags Tags returns. An action clears them by
// returning entity changes (Set, Delete clear EntityTag(entity, id)) or by naming them in
// Effects.Stale: use EntityTag for one thing, and tags of your own for lists, which change when
// something joins or leaves them.
//
// Actions read fresh data: their loads skip the cache, since they check what they change. Islands
// an action updates are resolved after its changes are cleared, so they read fresh data too.
// Failures and missing keys are never cached. A cache that errors is reported and bypassed. When
// several requests miss the same entry at once, one fetches it and the others wait for it.
type Data[K comparable, V any] struct {
	name      string
	fetch     func(ctx context.Context, keys []K) (map[K]V, error)
	ttl       time.Duration
	perViewer bool
	tags      func(key K, value V) []string
	loader    *BatchLoader[K, V]
	batch     []BatchOption
}

// NewData declares a kind of data, named for its cache keys and tags (unique per composer's
// cache), with how to fetch many by key. Keys missing from what fetch returns load as ErrNotFound.
// Without CacheFor, it's loaded fresh on every request, batched within each.
func NewData[K comparable, V any](name string, fetch func(ctx context.Context, keys []K) (map[K]V, error)) *Data[K, V] {
	if name == "" || strings.ContainsAny(name, ": ") {
		panic(fmt.Sprintf("clientcompose: data name %q must be set, without spaces or colons", name))
	}
	d := &Data[K, V]{name: name, fetch: fetch}
	d.loader = NewBatchLoader(d.load)
	return d
}

// CacheFor keeps each value for ttl across requests, when the composer has a Cache: the longest it
// may be out of date if it changes without an action saying so.
func (d *Data[K, V]) CacheFor(ttl time.Duration) *Data[K, V] {
	d.ttl = ttl
	return d
}

// PerViewer keeps each viewer's values apart, by Config.Viewer: for data that differs by who's
// asking (what they've saved, whom they follow). It's never shared between viewers.
func (d *Data[K, V]) PerViewer() *Data[K, V] {
	d.perViewer = true
	return d
}

// Tags files each value under more tags than its own, for actions to clear it by: EntityTag for
// each entity it holds, and tags of your own (a list's, so actions that add to it can clear it).
func (d *Data[K, V]) Tags(fn func(key K, value V) []string) *Data[K, V] {
	d.tags = fn
	return d
}

// Batch sets how its loads batch within a request (WithBatchWindow, WithMaxBatchSize).
func (d *Data[K, V]) Batch(opts ...BatchOption) *Data[K, V] {
	d.batch = opts
	d.loader = NewBatchLoader(d.load, opts...)
	return d
}

// Load returns the value for key: from this request's loads, then the cache, then fetch.
func (d *Data[K, V]) Load(ctx context.Context, key K) (V, error) {
	return d.loader.Load(ctx, key)
}

// LoadMany returns the values for keys, as Load does, in one batch. It fails if any key fails,
// missing keys included.
func (d *Data[K, V]) LoadMany(ctx context.Context, keys []K) (map[K]V, error) {
	return d.loader.LoadMany(ctx, keys)
}

// Tag is the tag of key's entry, for an action's Effects.Stale: the value changed. For data kept
// per viewer, it's the viewer's entry, the one asking.
func (d *Data[K, V]) Tag(ctx context.Context, key K) string {
	return "tag:data:" + d.entry(ctx, key)
}

// EntityTag is the tag of every value holding one entity: an action changing the entity (Set,
// Delete) clears them. Return it from Data.Tags.
func EntityTag(entity, id string) string {
	return fmt.Sprintf("tag:entity:%s:%s", entity, id)
}

// entry is key's cache key, without its prefix: the data's name, the viewer when it's kept per
// viewer, and the key.
func (d *Data[K, V]) entry(ctx context.Context, key K) string {
	k := fmt.Sprint(key)
	if d.perViewer {
		viewer := ""
		if s := scopeFrom(ctx); s != nil && s.viewer != nil {
			viewer = s.viewer(ctx)
		}
		return fmt.Sprintf("%s:viewer:%s:%s", d.name, viewer, k)
	}
	return fmt.Sprintf("%s:%s", d.name, k)
}

// load fetches a batch of keys: from the cache where it can, the rest by fetch.
func (d *Data[K, V]) load(ctx context.Context, keys []K) (map[K]V, error) {
	s := scopeFrom(ctx)
	if d.ttl <= 0 || s == nil || s.cache == nil || !s.cacheReads || (d.perViewer && s.viewer == nil) {
		// Not cached: it doesn't opt in, there's no cache, an action is reading it fresh, or it's
		// kept per viewer and the composer can't say who's asking, so it's never shared.
		return d.fetch(ctx, keys)
	}
	out := make(map[K]V, len(keys))
	cacheKeys := make(map[K]string, len(keys))
	asked := make([]string, 0, len(keys))
	for _, k := range keys {
		cacheKeys[k] = "data:" + d.entry(ctx, k)
		asked = append(asked, cacheKeys[k])
	}
	found, err := s.cache.GetMany(ctx, asked)
	if err != nil {
		s.reportCache(ctx, fmt.Errorf("cache get %s: %w", d.name, err))
		found = nil
	}
	var missing []K
	for _, k := range keys {
		var v V
		raw, ok := found[cacheKeys[k]]
		if ok && json.Unmarshal(raw, &v) == nil {
			out[k] = v
			continue
		}
		missing = append(missing, k)
	}
	if len(missing) == 0 {
		return out, nil
	}

	// One fetch per missing entry across every request this composer serves: lead the entries no
	// one is fetching, wait for the rest.
	var lead []K
	waiting := map[K]*flight{}
	flights := map[K]*flight{}
	for _, k := range missing {
		f, leader := s.flights.join(cacheKeys[k])
		flights[k] = f
		if leader {
			lead = append(lead, k)
		} else {
			waiting[k] = f
		}
	}
	if len(lead) > 0 {
		values, err := d.fetch(ctx, lead)
		for _, k := range lead {
			v, ok := values[k]
			switch {
			case err != nil:
				s.flights.land(cacheKeys[k], flights[k], nil, err)
			case !ok:
				s.flights.land(cacheKeys[k], flights[k], nil, errMissing)
			default:
				out[k] = v
				encoded, encErr := json.Marshal(v)
				s.flights.land(cacheKeys[k], flights[k], encoded, encErr)
				if encErr != nil {
					s.reportCache(ctx, fmt.Errorf("cache encode %s: %w", cacheKeys[k], encErr))
					continue
				}
				tags := []string{"tag:" + cacheKeys[k]}
				if d.tags != nil {
					tags = append(tags, d.tags(k, v)...)
				}
				if setErr := s.cache.Set(ctx, cacheKeys[k], encoded, d.ttl, tags); setErr != nil {
					s.reportCache(ctx, fmt.Errorf("cache set %s: %w", cacheKeys[k], setErr))
				}
			}
		}
		if err != nil {
			return nil, err
		}
	}
	var retry []K
	for k, f := range waiting {
		select {
		case <-f.done:
		case <-ctx.Done():
			return nil, ctx.Err()
		}
		var v V
		switch {
		case errors.Is(f.err, errMissing):
		case f.err != nil || json.Unmarshal(f.props, &v) != nil:
			// The first request failed, perhaps only for its own reasons (its deadline): try ours.
			retry = append(retry, k)
		default:
			out[k] = v
		}
	}
	if len(retry) > 0 {
		values, err := d.fetch(ctx, retry)
		if err != nil {
			return nil, err
		}
		for k, v := range values {
			out[k] = v
		}
	}
	return out, nil
}

// errMissing is a fetch that returned no value for a key: those waiting for it miss it too.
var errMissing = errors.New("missing")
