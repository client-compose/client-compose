package clientcompose

import (
	"context"
	"encoding/json"
	"errors"
	"time"
)

type mockPlacement struct {
	Key       string `json:"key"`
	Type      string `json:"type"`
	Versions  []int  `json:"versions"`
	Outcome   string `json:"outcome"`
	Required  bool   `json:"required"`
	TimeoutMs int    `json:"timeoutMs"`
}

// ConformanceScreen is the test-only `__conformance` screen (spec §8.1).
// Never register it in production.
func ConformanceScreen() Screen {
	return Screen{
		ID: "__conformance",
		Layout: func(_ context.Context, r Request) ([]Placement, error) {
			var mocks []mockPlacement
			if err := json.Unmarshal([]byte(r.Params["placements"]), &mocks); err != nil {
				return nil, err
			}
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
						default:
							return map[string]int{"v": v}, nil
						}
					}))
				}
				placements = append(placements, p)
			}
			return placements, nil
		},
	}
}
