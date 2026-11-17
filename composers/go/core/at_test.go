package clientcompose

import (
	"context"
	"testing"
	"time"

	ca "github.com/client-compose/client-compose/composers/go/core/internal/conformanceaction"
)

func TestAScreensAtIsWhenItStartedBeingAnswered(t *testing.T) {
	c := New(Config{Screens: []Screen{{ID: "s", Islands: []Placement{{Key: "slow", Versions: Versions(after(50)), Required: true}}}}})
	before := time.Now().UnixMilli()

	res := c.Compose(context.Background(), ScreenRequest{Protocol: new(int), Screen: "s", Client: &ClientContext{Platform: "web"}, Islands: map[string][]int{"x": {1}}})

	screen, ok := res.Body.(*ScreenStream)
	if !ok {
		t.Fatalf("%d %#v", res.Status, res.Body)
	}
	head := screen.Collect()
	// Before its island was read, which took 50ms.
	if head.At < before || head.At > before+40 {
		t.Fatalf("at %d, started %d", head.At, before)
	}
}

func TestAnActionsEffectsSayWhenItFinished(t *testing.T) {
	c := composerWith(func(context.Context, Call, ca.ConformanceV1Input) (ca.ConformanceV1Result, Effects, error) {
		time.Sleep(20 * time.Millisecond)
		return ca.ConformanceV1Result{}, Effects{Invalidate: []ScreenRef{{Screen: "s"}}}, nil
	})
	before := time.Now().UnixMilli()

	_, body := perform(t, c, `{"outcome":"ok","echo":"x"}`)

	effects, _ := body["effects"].(map[string]any)
	at, _ := effects["at"].(float64)
	if int64(at) < before+20 || int64(at) > time.Now().UnixMilli() {
		t.Fatalf("at %v, started %d", effects["at"], before)
	}
}

func TestAnActionWithoutEffectsHasNoAt(t *testing.T) {
	c := composerWith(func(context.Context, Call, ca.ConformanceV1Input) (ca.ConformanceV1Result, Effects, error) {
		return ca.ConformanceV1Result{}, Effects{}, nil
	})

	_, body := perform(t, c, `{"outcome":"ok","echo":"x"}`)

	if _, ok := body["effects"]; ok {
		t.Fatalf("effects %v", body["effects"])
	}
}
