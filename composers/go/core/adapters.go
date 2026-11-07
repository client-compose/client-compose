package clientcompose

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"slices"
	"strconv"
	"time"
)

// Cache keeps island props between requests (CMP-18). Implement it with whatever your app runs:
// Redis, Memcached, a map in memory. It's optional: without one (Config.Cache), islands resolve on
// every request, whether they opt in with CacheFor or not.
//
// Each entry is filed under tags: the island it is (its type, version and key) and each entity its
// props hold. After an action, the composer invalidates the tags of what its effects say changed,
// so a change shows on the next request, from every composer sharing the cache. A Redis
// implementation keeps each tag as a set of keys:
//
//	func (c redisCache) Set(ctx context.Context, key string, value []byte, ttl time.Duration, tags []string) error {
//		_, err := c.rdb.TxPipelined(ctx, func(p redis.Pipeliner) error {
//			p.Set(ctx, key, value, ttl)
//			for _, tag := range tags {
//				p.SAdd(ctx, tag, key)
//				p.Expire(ctx, tag, ttl) // at least as long as its newest key
//			}
//			return nil
//		})
//		return err
//	}
type Cache interface {
	// Get returns the value stored under key, and whether there was one.
	Get(ctx context.Context, key string) (value []byte, found bool, err error)
	// Set stores value under key for ttl, filed under each of tags.
	Set(ctx context.Context, key string, value []byte, ttl time.Duration, tags []string) error
	// Invalidate removes every value filed under any of tags.
	Invalidate(ctx context.Context, tags []string) error
}

// CacheKey says what an island's props depend on for this request, other than who's asking: the
// params it reads, the locale. Return "" to skip the cache for this request.
type CacheKey func(ctx context.Context, r Request) string

// CacheOption configures an island's caching (CacheFor).
type CacheOption func(*islandCache)

// VaryBy says who sees the same props: an audience, such as "visitor" or "member:<team>", never
// one person unless the island is theirs alone. Each audience gets its own entry, and invalidating
// the island invalidates every audience's. Without it, everyone shares one entry.
func VaryBy(audience func(ctx context.Context, r Request) string) CacheOption {
	return func(c *islandCache) { c.vary = audience }
}

type islandCache struct {
	ttl  time.Duration
	key  CacheKey
	vary func(ctx context.Context, r Request) string
}

// CacheFor returns the island with its props cached for ttl, under the key that key returns, when
// the composer has a Cache. The island's type and version are added to the key. Failures are never
// cached. Actions invalidate it through their effects: changes to entities it holds, an update to
// it, or invalidating its screen. The ttl is how long it can be out of date if something changes
// another way.
//
//	trending := cc.Define(resolveTrending).CacheFor(5*time.Minute, func(context.Context, cc.Request) string { return "all" })
//	feed := cc.Define(resolveFeed).CacheFor(30*time.Second, func(ctx context.Context, r cc.Request) string {
//		return r.Params["team"]
//	}, cc.VaryBy(audienceOf))
func (i Island) CacheFor(ttl time.Duration, key CacheKey, options ...CacheOption) Island {
	if i.paged {
		// A page depends on its cursor, and the cache keeps props alone, not where they go on.
		panic(fmt.Sprintf("clientcompose: %s v%d has pages, which aren't cached", i.Type, i.Version))
	}
	settings := islandCache{ttl: ttl, key: key}
	for _, option := range options {
		option(&settings)
	}
	i.cache = &settings
	return i
}

// islandTag is the tag of every entry of one island, for every audience.
func islandTag(island Island, appKey string) string {
	return fmt.Sprintf("tag:island:%s:%d:%s", island.Type, island.Version, appKey)
}

// entityTag is the tag of every entry holding one entity.
func entityTag(entity, id string) string {
	return fmt.Sprintf("tag:entity:%s:%s", entity, id)
}

// flight is one resolve of a missing entry that other requests for it wait on.
type flight struct {
	done  chan struct{}
	props json.RawMessage
	err   error
}

// resolveIsland is the innermost island resolver: from the cache when the island opts in and the
// composer has one, otherwise by the island's own function. Requests for an entry this composer is
// already resolving wait for it, rather than resolving it again.
func (c *Composer) resolveIsland(ctx context.Context, call IslandCall) (any, error) {
	ic := call.Island.cache
	if c.cache == nil || ic == nil {
		return call.Island.resolve(ctx, call.Request)
	}
	appKey := ic.key(ctx, call.Request)
	if appKey == "" {
		return call.Island.resolve(ctx, call.Request)
	}
	key := fmt.Sprintf("island:%s:%d:%s", call.Island.Type, call.Island.Version, appKey)
	if ic.vary != nil {
		key += "@" + ic.vary(ctx, call.Request)
	}
	report := func(err error) {
		c.report(ctx, Failure{Kind: CacheFailed, Screen: call.Screen, Key: call.Key, Type: call.Island.Type, Err: err})
	}

	cached, found, err := c.cache.Get(ctx, key)
	if err != nil {
		report(fmt.Errorf("cache get %s: %w", key, err))
	} else if found && json.Valid(cached) {
		return json.RawMessage(cached), nil
	}

	f, leader := c.join(key)
	if !leader {
		select {
		case <-f.done:
			if f.err == nil {
				return f.props, nil
			}
			// The first request failed, perhaps only for its own reasons (its deadline): try ours.
		case <-ctx.Done():
			return nil, ctx.Err()
		}
		return call.Island.resolve(ctx, call.Request)
	}

	props, err := call.Island.resolve(ctx, call.Request)
	if err != nil {
		c.land(key, f, nil, err)
		return nil, err
	}
	encoded, err := json.Marshal(props)
	if err != nil {
		c.land(key, f, nil, err)
		report(fmt.Errorf("cache encode %s: %w", key, err))
		return props, nil
	}
	c.land(key, f, encoded, nil)
	tags := []string{islandTag(call.Island, appKey)}
	for _, held := range heldEntities(encoded, call.Island.entities) {
		tags = append(tags, entityTag(held.entity, held.id))
	}
	if err := c.cache.Set(ctx, key, encoded, ic.ttl, tags); err != nil {
		report(fmt.Errorf("cache set %s: %w", key, err))
	}
	return props, nil
}

// join returns the flight resolving key, starting one if there's none: leader says it's the
// caller's to resolve.
func (c *Composer) join(key string) (f *flight, leader bool) {
	c.flightsMu.Lock()
	defer c.flightsMu.Unlock()
	if f, ok := c.flights[key]; ok {
		return f, false
	}
	f = &flight{done: make(chan struct{})}
	c.flights[key] = f
	return f, true
}

// land ends a flight, with what it resolved to.
func (c *Composer) land(key string, f *flight, props json.RawMessage, err error) {
	c.flightsMu.Lock()
	delete(c.flights, key)
	c.flightsMu.Unlock()
	f.props, f.err = props, err
	close(f.done)
}

type held struct{ entity, id string }

// heldEntities are the entities encoded props hold, by the island's entity paths (spec §2.1).
func heldEntities(encoded []byte, paths []EntityPath) []held {
	if len(paths) == 0 {
		return nil
	}
	var props any
	if err := json.Unmarshal(encoded, &props); err != nil {
		return nil
	}
	var out []held
	for _, path := range paths {
		out = appendHeld(out, props, path, path.Path)
	}
	return out
}

func appendHeld(out []held, value any, path EntityPath, rest []string) []held {
	if len(rest) == 0 {
		object, ok := value.(map[string]any)
		if !ok {
			return out
		}
		switch id := object[path.ID].(type) {
		case string:
			return append(out, held{path.Entity, id})
		case float64:
			return append(out, held{path.Entity, strconv.FormatFloat(id, 'f', -1, 64)})
		}
		return out
	}
	step, next := rest[0], rest[1:]
	switch v := value.(type) {
	case []any:
		if step == "[]" {
			for _, item := range v {
				out = appendHeld(out, item, path, next)
			}
		}
	case map[string]any:
		for key, item := range v {
			if step == "{}" || step == key {
				out = appendHeld(out, item, path, next)
			}
		}
	}
	return out
}

// invalidateCached invalidates the cached islands an action's effects say changed, before its
// updates are resolved: those holding the entities it changed, the islands it updates and every
// island of the screens it invalidates, for every audience. Islands are found as the caller's
// request would place them. A cache that errors is reported; its entries stay until their ttl.
func (c *Composer) invalidateCached(ctx context.Context, action Action, effects Effects, client ClientContext) {
	if c.cache == nil {
		return
	}
	var tags []string
	for _, change := range effects.Changes {
		tags = append(tags, entityTag(change.Entity, change.ID))
	}
	for _, ref := range effects.Update {
		tags = append(tags, c.placedTags(ctx, ref.Screen, ref.Params, client, ref.Key)...)
	}
	for _, ref := range effects.Invalidate {
		tags = append(tags, c.placedTags(ctx, ref.Screen, ref.Params, client, "")...)
	}
	if len(tags) == 0 {
		return
	}
	slices.Sort(tags)
	tags = slices.Compact(tags)
	if err := c.cache.Invalidate(ctx, tags); err != nil {
		c.report(ctx, Failure{Kind: CacheFailed, Action: action.Name, Version: action.Version, Err: fmt.Errorf("cache invalidate: %w", err)})
	}
}

// placedTags are the tags of the cached islands a screen places for these params, or only the one
// with key when it's set.
func (c *Composer) placedTags(parent context.Context, id string, params map[string]string, client ClientContext, key string) []string {
	screen, ok := c.screens[id]
	if !ok {
		return nil
	}
	ctx, endRequest := withRequestScope(parent)
	defer endRequest()
	if params == nil {
		params = map[string]string{}
	}
	r := Request{Screen: id, Params: params, Client: client, words: c.words(client.Locale)}
	placements, err := c.placements(ctx, screen, r)
	if err != nil {
		return nil
	}
	var tags []string
	for _, p := range placements {
		if key != "" && p.Key != key {
			continue
		}
		for _, island := range p.Versions {
			if island.cache == nil {
				continue
			}
			if appKey := island.cache.key(ctx, r); appKey != "" {
				tags = append(tags, islandTag(island, appKey))
			}
		}
	}
	return tags
}

// IdempotencyStore keeps action outcomes by idempotency key (CMP-19), so a retried action returns
// its first outcome instead of running again. Implement it with whatever your app runs; with Redis,
// Begin is a SET NX of a "running" marker, Finish a SET of the outcome, and Release a DEL. It's
// optional: without Config.Idempotency, keys pass through to your actions (Call.IdempotencyKey).
type IdempotencyStore interface {
	// Begin claims key for ttl. If a call with this key has finished, it returns that call's stored
	// outcome instead. If another call holds the key and hasn't finished, it returns neither.
	Begin(ctx context.Context, key string, ttl time.Duration) (stored []byte, claimed bool, err error)
	// Finish stores the outcome of the call that claimed key, for ttl.
	Finish(ctx context.Context, key string, outcome []byte, ttl time.Duration) error
	// Release drops a claim without an outcome, so a retry runs the action again.
	Release(ctx context.Context, key string) error
}

// Idempotency configures the idempotency store (CMP-19).
type Idempotency struct {
	Store IdempotencyStore
	// Scope says whose keys these are, usually the viewer's id, so one caller can never replay
	// another's. Required. Return "" for actions anyone may share.
	Scope func(ctx context.Context) string
	// TTL is how long outcomes are kept. Default 24h.
	TTL time.Duration
	// Wait is how long a duplicate waits for a call with its key that's still running. Default 10s.
	Wait time.Duration
}

// performIdempotent runs an action at most once per scope and idempotency key, when the composer has
// an idempotency store. Only completed outcomes (results and declared errors) are kept; anything
// else releases the key, so a retry runs again. A store that errors is reported, and the action runs.
func (c *Composer) performIdempotent(ctx context.Context, req ActionRequest) Result {
	idem := c.idempotency
	if idem == nil || req.IdempotencyKey == "" {
		return c.performAction(ctx, req)
	}
	key := fmt.Sprintf("action:%s:%d:%s:%s", req.Action, req.Version, idem.Scope(ctx), req.IdempotencyKey)
	report := func(err error) {
		c.report(ctx, Failure{Kind: IdempotencyFailed, Action: req.Action, Version: req.Version, Err: err})
	}

	deadline := time.Now().Add(idem.Wait)
	for {
		stored, claimed, err := idem.Store.Begin(ctx, key, idem.TTL)
		if err != nil {
			report(fmt.Errorf("idempotency begin %s: %w", key, err))
			return c.performAction(ctx, req)
		}
		if stored != nil && json.Valid(stored) {
			return Result{http.StatusOK, json.RawMessage(stored)}
		}
		if claimed {
			break
		}
		if time.Now().After(deadline) {
			report(fmt.Errorf("idempotency %s: still running after %s", key, idem.Wait))
			return fail(http.StatusInternalServerError, "action_failed", "a call with this idempotency key is still running")
		}
		select {
		case <-ctx.Done():
			return fail(http.StatusInternalServerError, "action_failed", "")
		case <-time.After(50 * time.Millisecond):
		}
	}

	res := c.performAction(ctx, req)
	if res.Status == http.StatusOK {
		outcome, err := json.Marshal(res.Body)
		if err == nil {
			err = idem.Store.Finish(ctx, key, outcome, idem.TTL)
		}
		if err != nil {
			report(fmt.Errorf("idempotency finish %s: %w", key, err))
		}
		return res
	}
	if err := idem.Store.Release(ctx, key); err != nil {
		report(fmt.Errorf("idempotency release %s: %w", key, err))
	}
	return res
}
