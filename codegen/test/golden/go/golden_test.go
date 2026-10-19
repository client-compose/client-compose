package golden

import (
	"context"
	"encoding/json"
	"os"
	"strings"
	"testing"

	cc "github.com/client-compose/client-compose/composers/go/core"
)

func TestKitchenSinkRoundTrips(t *testing.T) {
	sample, err := os.ReadFile("../../fixtures/kitchen-sink.sample.json")
	if err != nil {
		t.Fatal(err)
	}
	var props KitchenSinkV1
	if err := json.Unmarshal(sample, &props); err != nil {
		t.Fatal(err)
	}
	if props.Size != KitchenSinkV1SizeExtraLarge || *props.Author.AvatarURL != "https://example.com/ada.png" ||
		*props.Author.Role != KitchenSinkV1AuthorRoleAdmin || props.Items[1].Label == nil || *props.BigNumber != 5000000000 ||
		props.Class != "x" || props.Metadata["k"] != "v" {
		t.Fatalf("unexpected %+v", props)
	}

	out, err := json.Marshal(KitchenSinkV1{Title: "t", Tags: []string{}, Size: KitchenSinkV1SizeSmall})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(out), "ratio") || strings.Contains(string(out), "avatar-url") {
		t.Fatalf("optional fields should be omitted: %s", out)
	}
}

func TestDefineUsesGeneratedTypeAndVersion(t *testing.T) {
	island := cc.Define(func(context.Context, cc.Request) (KitchenSinkV1, error) { return KitchenSinkV1{}, nil })
	if island.Type != "kitchen-sink" || island.Version != 1 {
		t.Fatalf("got %s v%d", island.Type, island.Version)
	}
	empty := cc.Define(func(context.Context, cc.Request) (DividerV1, error) { return DividerV1{}, nil })
	if empty.Type != "divider" {
		t.Fatalf("got %s", empty.Type)
	}
}
