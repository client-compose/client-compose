package cctest

import (
	"context"
	"slices"
	"sync"
	"time"
)

// MemoryCache is an in-memory cc.Cache for tests: pass it as Config.Cache to test data that opts in
// with Data.CacheFor. Entries expire after their TTL, and are invalidated by their tags.
type MemoryCache struct {
	mu      sync.Mutex
	entries map[string]memoryEntry
	tags    map[string]map[string]bool
}

type memoryEntry struct {
	value   []byte
	expires time.Time
}

// NewMemoryCache returns an empty cache.
func NewMemoryCache() *MemoryCache {
	return &MemoryCache{entries: map[string]memoryEntry{}, tags: map[string]map[string]bool{}}
}

// GetMany implements cc.Cache.
func (m *MemoryCache) GetMany(_ context.Context, keys []string) (map[string][]byte, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := map[string][]byte{}
	for _, key := range keys {
		if e, ok := m.entries[key]; ok && time.Now().Before(e.expires) {
			out[key] = e.value
		}
	}
	return out, nil
}

// Set implements cc.Cache.
func (m *MemoryCache) Set(_ context.Context, key string, value []byte, ttl time.Duration, tags []string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.entries[key] = memoryEntry{value: append([]byte(nil), value...), expires: time.Now().Add(ttl)}
	for _, tag := range tags {
		if m.tags[tag] == nil {
			m.tags[tag] = map[string]bool{}
		}
		m.tags[tag][key] = true
	}
	return nil
}

// Invalidate implements cc.Cache.
func (m *MemoryCache) Invalidate(_ context.Context, tags []string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, tag := range tags {
		for key := range m.tags[tag] {
			delete(m.entries, key)
		}
		delete(m.tags, tag)
	}
	return nil
}

// Tags lists the tags each current key is filed under, for assertions.
func (m *MemoryCache) Tags(key string) []string {
	m.mu.Lock()
	defer m.mu.Unlock()
	var tags []string
	for tag, keys := range m.tags {
		if keys[key] {
			tags = append(tags, tag)
		}
	}
	slices.Sort(tags)
	return tags
}

// Keys lists the keys currently stored, for assertions.
func (m *MemoryCache) Keys() []string {
	m.mu.Lock()
	defer m.mu.Unlock()
	keys := make([]string, 0, len(m.entries))
	for k, e := range m.entries {
		if time.Now().Before(e.expires) {
			keys = append(keys, k)
		}
	}
	return keys
}

// MemoryIdempotencyStore is an in-memory cc.IdempotencyStore for tests: pass it in
// Config.Idempotency to test actions that are retried.
type MemoryIdempotencyStore struct {
	mu      sync.Mutex
	entries map[string]idempotencyEntry
}

type idempotencyEntry struct {
	outcome []byte // nil while the call is running
	expires time.Time
}

// NewMemoryIdempotencyStore returns an empty store.
func NewMemoryIdempotencyStore() *MemoryIdempotencyStore {
	return &MemoryIdempotencyStore{entries: map[string]idempotencyEntry{}}
}

// Begin implements cc.IdempotencyStore.
func (m *MemoryIdempotencyStore) Begin(_ context.Context, key string, ttl time.Duration) ([]byte, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if e, ok := m.entries[key]; ok && time.Now().Before(e.expires) {
		return e.outcome, false, nil
	}
	m.entries[key] = idempotencyEntry{expires: time.Now().Add(ttl)}
	return nil, true, nil
}

// Finish implements cc.IdempotencyStore.
func (m *MemoryIdempotencyStore) Finish(_ context.Context, key string, outcome []byte, ttl time.Duration) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.entries[key] = idempotencyEntry{outcome: append([]byte(nil), outcome...), expires: time.Now().Add(ttl)}
	return nil
}

// Release implements cc.IdempotencyStore.
func (m *MemoryIdempotencyStore) Release(_ context.Context, key string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.entries, key)
	return nil
}
