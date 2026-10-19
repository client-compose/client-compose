package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

type island struct {
	Key     string         `json:"key"`
	Version int            `json:"version"`
	Status  string         `json:"status"`
	Props   map[string]any `json:"props"`
}

func fetchProfile(t *testing.T, h http.Handler, viewerID, capabilities string) []island {
	t.Helper()
	body := `{"protocol":0,"screen":"profile","params":{"userId":"u_1"},` +
		`"client":{"platform":"android","appVersion":"1.0.0"},"islands":` + capabilities + `}`
	req := httptest.NewRequest("POST", "/screens/profile", strings.NewReader(body))
	req.Header.Set("X-User-Id", viewerID)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != 200 {
		t.Fatalf("status %d: %s", rec.Code, rec.Body)
	}
	var res struct{ Islands []island }
	if err := json.Unmarshal(rec.Body.Bytes(), &res); err != nil {
		t.Fatal(err)
	}
	return res.Islands
}

func keys(islands []island) string {
	var ks []string
	for _, i := range islands {
		ks = append(ks, i.Key)
	}
	return strings.Join(ks, ",")
}

func TestNewAppGetsLatestHeader(t *testing.T) {
	got := fetchProfile(t, newHandler(fakeServices()), "u_2",
		`{"profile-header":[1,2],"follow-button":[1],"post-grid":[1]}`)
	if keys(got) != "header,follow,posts" || got[0].Version != 2 || got[0].Props["badge"] != "PRO" {
		t.Fatalf("unexpected %+v", got)
	}
}

// The point of the protocol: an app version that shipped before v2 of the header and
// before the follow button existed still gets a screen it can fully render.
func TestOldAppStillWorks(t *testing.T) {
	got := fetchProfile(t, newHandler(fakeServices()), "u_2", `{"profile-header":[1],"post-grid":[1]}`)
	if keys(got) != "header,posts" || got[0].Version != 1 {
		t.Fatalf("unexpected %+v", got)
	}
}

func TestNoFollowButtonOnOwnProfile(t *testing.T) {
	got := fetchProfile(t, newHandler(fakeServices()), "u_1",
		`{"profile-header":[1,2],"follow-button":[1],"post-grid":[1]}`)
	if keys(got) != "header,posts" {
		t.Fatalf("unexpected %+v", got)
	}
}

func TestHeaderAndFollowButtonShareOneUserLookup(t *testing.T) {
	s := fakeServices()
	var calls atomic.Int32
	getUser := s.GetUser
	s.GetUser = func(ctx context.Context, id string) (User, error) {
		calls.Add(1)
		return getUser(ctx, id)
	}
	got := fetchProfile(t, newHandler(s), "u_2", `{"profile-header":[2],"follow-button":[1],"post-grid":[1]}`)
	if keys(got) != "header,follow,posts" || got[1].Props["displayName"] != "Ada Lovelace" {
		t.Fatalf("unexpected %+v", got)
	}
	if calls.Load() != 1 {
		t.Fatalf("GetUser called %d times, want 1", calls.Load())
	}
}

func TestPostsOutageDoesNotBreakScreen(t *testing.T) {
	s := fakeServices()
	s.RecentPosts = func(context.Context, string) ([]Post, error) { return nil, errors.New("posts service down") }
	got := fetchProfile(t, newHandler(s), "u_2", `{"profile-header":[2],"post-grid":[1]}`)
	if keys(got) != "header,posts" || got[0].Status != "ok" || got[1].Status != "error" {
		t.Fatalf("unexpected %+v", got)
	}
}
