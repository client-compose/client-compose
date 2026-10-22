package clientcompose

import (
	"context"
	"encoding/json"
	"fmt"
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
