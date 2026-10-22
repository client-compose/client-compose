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

func TestDefineActionWithGeneratedTypes(t *testing.T) {
	rename := cc.DefineAction(func(_ context.Context, _ cc.Call, in RenameThingV1Input) (RenameThingV1Result, cc.Effects, error) {
		if in.Name == "taken" {
			return RenameThingV1Result{}, cc.Effects{}, RenameThingV1NameTaken{Suggestions: []string{"taken-2"}}
		}
		if in.Visibility != nil && *in.Visibility == RenameThingV1InputVisibilityPrivate {
			return RenameThingV1Result{}, cc.Effects{}, RenameThingV1Locked{}
		}
		ref := cc.ScreenRef{Screen: "thing", Params: map[string]string{"thingId": in.ThingID}}
		return RenameThingV1Result{Thing: RenameThingV1ResultThing{ID: in.ThingID, Name: in.Name}},
			cc.Effects{Invalidate: []cc.ScreenRef{ref}}, nil
	})
	if rename.Name != "rename-thing" || rename.Version != 1 {
		t.Fatalf("got %s v%d", rename.Name, rename.Version)
	}
	c := cc.New(cc.Config{Actions: []cc.Action{rename, cc.DefineAction(func(context.Context, cc.Call, PingV1Input) (PingV1Result, cc.Effects, error) {
		return PingV1Result{}, cc.Effects{}, nil
	})}})
	perform := func(body string) cc.Result {
		var req cc.ActionRequest
		if err := json.Unmarshal([]byte(body), &req); err != nil {
			t.Fatal(err)
		}
		return c.Perform(context.Background(), req)
	}

	for input, want := range map[string]string{
		`{"thingId":"t1","name":"New"}`:                      `"status":"ok","result":{"thing":{"id":"t1","name":"New"}},"effects":{"invalidate":[{"screen":"thing","params":{"thingId":"t1"}}]}`,
		`{"thingId":"t1","name":"taken"}`:                    `"status":"error","error":{"code":"name_taken","details":{"suggestions":["taken-2"]}}`,
		`{"thingId":"t1","name":"x","visibility":"private"}`: `"status":"error","error":{"code":"locked"}}`,
		`{"thingId":"t1","name":"x","visibility":"secret"}`:  `"code":"invalid_input","message":"input.visibility: expected one of public, private"`,
	} {
		body := `{"protocol":0,"action":"rename-thing","version":1,"client":{"platform":"web","appVersion":"1"},"input":` + input + `}`
		res := perform(body)
		out, _ := json.Marshal(res.Body)
		if !strings.Contains(string(out), want) {
			t.Errorf("%s:\n got %s\nwant %s", input, out, want)
		}
	}
	res := perform(`{"protocol":0,"action":"ping","version":1,"client":{"platform":"web","appVersion":"1"},"input":{}}`)
	if out, _ := json.Marshal(res.Body); !strings.Contains(string(out), `"result":{}`) {
		t.Errorf("ping: %s", out)
	}
}
