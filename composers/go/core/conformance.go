package clientcompose

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"time"

	ca "github.com/client-compose/client-compose/composers/go/core/internal/conformanceaction"
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
			switch r.Params["auth"] {
			case "unauthenticated":
				return nil, fmt.Errorf("conformance: %w", ErrUnauthenticated)
			case "forbidden":
				return nil, fmt.Errorf("conformance: %w", ErrForbidden)
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

// ConformanceActions returns the test-only `conformance` action, versions 1 and 2 (spec §8.1).
// Never register them in production.
func ConformanceActions() []Action {
	return []Action{
		DefineAction(func(_ context.Context, call Call, in ca.ConformanceV1Input) (ca.ConformanceV1Result, Effects, error) {
			effects, err := conformanceOutcome(string(in.Outcome), in.Effects)
			switch {
			case errors.Is(err, errRejected):
				return ca.ConformanceV1Result{}, Effects{}, ca.ConformanceV1Rejected{Echo: in.Echo}
			case errors.Is(err, errUnavailable):
				return ca.ConformanceV1Result{}, Effects{}, ca.ConformanceV1Unavailable{}
			case err != nil:
				return ca.ConformanceV1Result{}, Effects{}, err
			}
			return ca.ConformanceV1Result{Echo: in.Echo, Version: 1, IdempotencyKey: optionalString(call.IdempotencyKey)}, effects, nil
		}),
		DefineAction(func(_ context.Context, call Call, in ca.ConformanceV2Input) (ca.ConformanceV2Result, Effects, error) {
			effects, err := conformanceOutcome(string(in.Outcome), in.Effects)
			switch {
			case errors.Is(err, errRejected):
				return ca.ConformanceV2Result{}, Effects{}, ca.ConformanceV2Rejected{Echo: in.Echo}
			case errors.Is(err, errUnavailable):
				return ca.ConformanceV2Result{}, Effects{}, ca.ConformanceV2Unavailable{}
			case err != nil:
				return ca.ConformanceV2Result{}, Effects{}, err
			}
			return ca.ConformanceV2Result{Echo: in.Echo, Version: 2, IdempotencyKey: optionalString(call.IdempotencyKey)}, effects, nil
		}),
	}
}

var (
	errRejected    = errors.New("rejected")
	errUnavailable = errors.New("unavailable")
)

// undeclaredError looks like a generated declared error, but no conformance action declares it.
type undeclaredError struct{}

func (undeclaredError) ActionErrorCode() string      { return "undeclared" }
func (undeclaredError) ActionErrorDetails() any      { return nil }
func (undeclaredError) ActionErrorOf() (string, int) { return "conformance", 1 }
func (undeclaredError) Error() string                { return "conformance: undeclared" }

// conformanceOutcome does what input.outcome asks. mockEffects has the same JSON shape as Effects.
func conformanceOutcome(outcome string, mockEffects any) (Effects, error) {
	switch outcome {
	case "rejected":
		return Effects{}, errRejected
	case "unavailable":
		return Effects{}, errUnavailable
	case "undeclared":
		return Effects{}, undeclaredError{}
	case "fail":
		return Effects{}, errors.New("mock failure")
	case "not_found":
		return Effects{}, ErrNotFound
	case "unauthenticated":
		return Effects{}, ErrUnauthenticated
	case "forbidden":
		return Effects{}, ErrForbidden
	}
	var effects Effects
	raw, err := json.Marshal(mockEffects)
	if err != nil {
		return Effects{}, err
	}
	if string(raw) != "null" {
		err = json.Unmarshal(raw, &effects)
	}
	return effects, err
}

func optionalString(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
