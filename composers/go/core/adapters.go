package clientcompose

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

// Cache keeps island props between requests (CMP-18). Implement it with whatever your app runs:
// Redis, Memcached, a map in memory. It's optional: without one (Config.Cache), islands resolve on
// every request, whether they opt in with CacheFor or not.
//
//	type redisCache struct{ rdb *redis.Client }
//
//	func (c redisCache) Get(ctx context.Context, key string) ([]byte, bool, error) {
//		v, err := c.rdb.Get(ctx, key).Bytes()
//		if errors.Is(err, redis.Nil) {
//			return nil, false, nil
//		}
//		return v, err == nil, err
//	}
//
//	func (c redisCache) Set(ctx context.Context, key string, value []byte, ttl time.Duration) error {
//		return c.rdb.Set(ctx, key, value, ttl).Err()
//	}
type Cache interface {
	// Get returns the value stored under key, and whether there was one.
	Get(ctx context.Context, key string) (value []byte, found bool, err error)
	// Set stores value under key for ttl.
	Set(ctx context.Context, key string, value []byte, ttl time.Duration) error
}

// CacheKey says what an island's props depend on for this request: the params it reads, the viewer
// for a personalised island, the locale. Return "" to skip the cache for this request, e.g. when
// someone is signed in.
type CacheKey func(ctx context.Context, r Request) string

type islandCache struct {
	ttl time.Duration
	key CacheKey
}

// CacheFor returns the island with its props cached for ttl, under the key that key returns, when
// the composer has a Cache. The island's type and version are added to the key. Failures are never
// cached.
//
//	trending := cc.Define(resolveTrending).CacheFor(5*time.Minute, func(context.Context, cc.Request) string { return "all" })
//	feed := cc.Define(resolveFeed).CacheFor(30*time.Second, func(ctx context.Context, r cc.Request) string {
//		return viewerID(ctx) + ":" + r.Params["page"]
//	})
func (i Island) CacheFor(ttl time.Duration, key CacheKey) Island {
	if i.paged {
		// A page depends on its cursor, and the cache keeps props alone, not where they go on.
		panic(fmt.Sprintf("clientcompose: %s v%d has pages, which aren't cached", i.Type, i.Version))
	}
	i.cache = &islandCache{ttl: ttl, key: key}
	return i
}

// resolveIsland is the innermost island resolver: from the cache when the island opts in and the
// composer has one, otherwise by the island's own function.
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
	report := func(err error) {
		c.report(ctx, Failure{Kind: CacheFailed, Screen: call.Screen, Key: call.Key, Type: call.Island.Type, Err: err})
	}

	cached, found, err := c.cache.Get(ctx, key)
	if err != nil {
		report(fmt.Errorf("cache get %s: %w", key, err))
	} else if found && json.Valid(cached) {
		return json.RawMessage(cached), nil
	}

	props, err := call.Island.resolve(ctx, call.Request)
	if err != nil {
		return nil, err
	}
	encoded, err := json.Marshal(props)
	if err != nil {
		report(fmt.Errorf("cache encode %s: %w", key, err))
		return props, nil
	}
	if err := c.cache.Set(ctx, key, encoded, ic.ttl); err != nil {
		report(fmt.Errorf("cache set %s: %w", key, err))
	}
	return props, nil
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
