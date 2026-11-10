package clientcompose

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"slices"
	"sync"
	"time"
)

// Cache keeps data between requests (CMP-18), for every kind of data that opts in with
// Data.CacheFor. Implement it with whatever your app runs: Redis, Memcached, a map in memory. It's
// optional: without one (Config.Cache), data is fetched on every request.
//
// Each entry is filed under tags: its own, and those its Data's Tags gives it (the entities it
// holds, the lists it's on). After an action, the composer invalidates the tags of what it says
// changed, so a change shows on the next request, from every composer sharing the cache. A Redis
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
	// GetMany returns the values stored under any of keys, by key: keys with none are left out.
	GetMany(ctx context.Context, keys []string) (map[string][]byte, error)
	// Set stores value under key for ttl, filed under each of tags.
	Set(ctx context.Context, key string, value []byte, ttl time.Duration, tags []string) error
	// Invalidate removes every value filed under any of tags.
	Invalidate(ctx context.Context, tags []string) error
}

// flight is one fetch of a missing entry that other requests for it wait on.
type flight struct {
	done  chan struct{}
	props json.RawMessage
	err   error
}

// flights are the fetches of missing entries in progress, across every request a composer serves.
type flights struct {
	mu sync.Mutex
	in map[string]*flight
}

// join returns the flight fetching key, starting one if there's none: leader says it's the
// caller's to fetch.
func (fs *flights) join(key string) (f *flight, leader bool) {
	fs.mu.Lock()
	defer fs.mu.Unlock()
	if f, ok := fs.in[key]; ok {
		return f, false
	}
	f = &flight{done: make(chan struct{})}
	fs.in[key] = f
	return f, true
}

// land ends a flight, with what it fetched.
func (fs *flights) land(key string, f *flight, value json.RawMessage, err error) {
	fs.mu.Lock()
	delete(fs.in, key)
	fs.mu.Unlock()
	f.props, f.err = value, err
	close(f.done)
}

// resolveIsland is the innermost island resolver: the island's own function. What it loads comes
// from Data, cached as each kind of data says.
func resolveIsland(ctx context.Context, call IslandCall) (any, error) {
	return call.Island.resolve(ctx, call.Request)
}

// invalidateCached clears the data an action's effects say changed, before its updates are
// resolved: what holds the entities it changed (EntityTag), and the tags it names (Stale). A cache
// that errors is reported; its entries stay until their ttl.
func (c *Composer) invalidateCached(ctx context.Context, action Action, effects Effects) {
	if c.cache == nil {
		return
	}
	tags := slices.Clone(effects.Stale)
	for _, change := range effects.Changes {
		tags = append(tags, EntityTag(change.Entity, change.ID))
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
