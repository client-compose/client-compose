package clientcompose

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"time"
)

type mockPlacement struct {
	Key       string `json:"key"`
	Type      string `json:"type"`
	Versions  []int  `json:"versions"`
	Outcome   string `json:"outcome"`
	Required  bool   `json:"required"`
	TimeoutMs int    `json:"timeoutMs"`
	// Load this key through the request-scoped Load before resolving (spec §9).
	Load        string `json:"load"`
	LoadDelayMs int    `json:"loadDelayMs"`
	// Wait this long before loading, so the case controls which island starts a shared load.
	StartDelayMs int `json:"startDelayMs"`
}

// ConformanceScreen is the test-only `__conformance` screen (spec §8.1).
// Never register it in production.
func ConformanceScreen() Screen {
	return Screen{
		ID: "__conformance",
		Meta: func(_ context.Context, r Request) (ScreenMeta, error) {
			var meta ScreenMeta
			if r.Params["meta"] != "" {
				err := json.Unmarshal([]byte(r.Params["meta"]), &meta)
				return meta, err
			}
			return meta, nil
		},
		Layout: func(_ context.Context, r Request) ([]Placement, error) {
			if r.Params["notFound"] == "true" {
				return nil, fmt.Errorf("conformance: %w", ErrNotFound)
			}
			var mocks []mockPlacement
			if err := json.Unmarshal([]byte(r.Params["placements"]), &mocks); err != nil {
				return nil, err
			}
			// How many times each load key's work actually ran during this request.
			var mu sync.Mutex
			calls := map[string]int{}

			placements := make([]Placement, 0, len(mocks))
			for _, m := range mocks {
				p := Placement{Key: m.Key, Required: m.Required, Timeout: time.Duration(m.TimeoutMs) * time.Millisecond}
				for _, v := range m.Versions {
					p.Versions = append(p.Versions, NewIsland(m.Type, v, func(ctx context.Context, _ Request) (map[string]int, error) {
						switch m.Outcome {
						case "error":
							return nil, errors.New("mock failure")
						case "timeout":
							<-ctx.Done()
							return nil, ctx.Err()
						}
						if m.Load == "" {
							return map[string]int{"v": v}, nil
						}
						select {
						case <-time.After(time.Duration(m.StartDelayMs) * time.Millisecond):
						case <-ctx.Done():
							return nil, ctx.Err()
						}
						_, err := Load(ctx, m.Load, func(shared context.Context) (struct{}, error) {
							mu.Lock()
							calls[m.Load]++
							mu.Unlock()
							select {
							case <-time.After(time.Duration(m.LoadDelayMs) * time.Millisecond):
								return struct{}{}, nil
							case <-shared.Done():
								return struct{}{}, errors.New("shared load cancelled")
							}
						})
						if err != nil {
							return nil, err
						}
						mu.Lock()
						defer mu.Unlock()
						return map[string]int{"v": v, "calls": calls[m.Load]}, nil
					}))
				}
				placements = append(placements, p)
			}
			return placements, nil
		},
	}
}
