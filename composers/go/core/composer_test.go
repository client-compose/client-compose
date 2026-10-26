package clientcompose

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// The full protocol behaviour is covered by the shared conformance suite
// (see conformance.sh). These tests cover Go-specific behaviour.

func TestNegotiatePicksHighestCommonVersion(t *testing.T) {
	versions := []Island{{Type: "x", Version: 1}, {Type: "x", Version: 3}, {Type: "x", Version: 2}}
	got, ok := Negotiate(versions, []int{1, 2})
	if !ok || got.Version != 2 {
		t.Fatalf("got %v %v, want version 2", got.Version, ok)
	}
	if _, ok := Negotiate(versions, []int{9}); ok {
		t.Fatal("expected no common version")
	}
}

func TestPanickingIslandIsIsolated(t *testing.T) {
	c := New(Config{Screens: []Screen{{
		ID: "s",
		Islands: []Placement{{Key: "boom", Versions: Versions(
			NewIsland("x", 1, func(context.Context, Request) (struct{}, error) { panic("oh no") }),
		)}},
	}}})
	srv := httptest.NewServer(c)
	defer srv.Close()

	res, err := http.Post(srv.URL+"/screens/s", "application/json", strings.NewReader(
		`{"protocol":0,"screen":"s","client":{"platform":"ios","appVersion":"1","osVersion":"18"},"islands":{"x":[1]}}`))
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var body ScreenResponse
	if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if res.StatusCode != http.StatusOK || body.Islands[0].Status != "error" || body.Islands[0].Error.Code != "resolve_failed" {
		t.Fatalf("unexpected response %d %+v", res.StatusCode, body)
	}
}

func TestClientContextKeepsExtraFields(t *testing.T) {
	var cc ClientContext
	if err := json.Unmarshal([]byte(`{"platform":"android","appVersion":"2.1","osVersion":"15"}`), &cc); err != nil {
		t.Fatal(err)
	}
	if cc.Platform != "android" || cc.Extra["osVersion"] != "15" || cc.Extra["platform"] != nil {
		t.Fatalf("unexpected %+v", cc)
	}
}
