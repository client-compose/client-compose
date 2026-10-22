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
