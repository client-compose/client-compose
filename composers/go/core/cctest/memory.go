package cctest

import (
	"context"
	"sync"
	"time"
)

// MemoryCache is an in-memory cc.Cache for tests: pass it as Config.Cache to test islands that opt
// in with CacheFor. Entries expire after their TTL.
type MemoryCache struct {
	mu      sync.Mutex
	entries map[string]memoryEntry
}

type memoryEntry struct {
	value   []byte
	expires time.Time
}

// NewMemoryCache returns an empty cache.
func NewMemoryCache() *MemoryCache {
	return &MemoryCache{entries: map[string]memoryEntry{}}
}

// Get implements cc.Cache.
func (m *MemoryCache) Get(_ context.Context, key string) ([]byte, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	e, ok := m.entries[key]
	if !ok || time.Now().After(e.expires) {
		return nil, false, nil
	}
	return e.value, true, nil
}

// Set implements cc.Cache.
func (m *MemoryCache) Set(_ context.Context, key string, value []byte, ttl time.Duration) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.entries[key] = memoryEntry{value: append([]byte(nil), value...), expires: time.Now().Add(ttl)}
	return nil
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
