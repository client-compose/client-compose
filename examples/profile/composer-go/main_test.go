package main

import (
	"context"
	"errors"
	"slices"
	"sync/atomic"
	"testing"

	"github.com/client-compose/client-compose/composers/go/core/cctest"
)

var profile = cctest.Params{"userId": "u_1"}

// signedInAs is the header the example's context function reads the viewer from.
func signedInAs(id string) cctest.RequestOption { return cctest.Header("X-User-Id", id) }

// newApp is an app built today: it declares every island the composer places.
func newApp(t *testing.T, s Services) *cctest.App {
	return cctest.New(t, newComposer(s))
}

func TestNewAppGetsLatestHeader(t *testing.T) {
	got := newApp(t, fakeServices()).Screen("profile", profile, signedInAs("u_2"))
	header := cctest.Props[ProfileHeaderV2](t, got, "header")
	if !slices.Equal(got.Keys(), []string{"header", "follow", "posts"}) || header.Badge == nil || *header.Badge != "PRO" {
		t.Fatalf("unexpected %+v", got.Response.Islands)
	}
}

// The point of the protocol: an app version that shipped before v2 of the header and
// before the follow button existed still gets a screen it can fully render.
func TestOldAppStillWorks(t *testing.T) {
	old := cctest.New(t, newComposer(fakeServices()), cctest.Declare(ProfileHeaderV1{}, PostGridV1{}))
	got := old.Screen("profile", profile, signedInAs("u_2"))
	if !slices.Equal(got.Keys(), []string{"header", "posts"}) || cctest.Props[ProfileHeaderV1](t, got, "header").DisplayName == "" {
		t.Fatalf("unexpected %+v", got.Response.Islands)
	}
}

func TestNoFollowButtonOnOwnProfile(t *testing.T) {
	got := newApp(t, fakeServices()).Screen("profile", profile, signedInAs("u_1"))
	if !slices.Equal(got.Keys(), []string{"header", "posts"}) {
		t.Fatalf("unexpected %v", got.Keys())
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
	got := newApp(t, s).Screen("profile", profile, signedInAs("u_2"))
	if name := cctest.Props[FollowButtonV1](t, got, "follow").DisplayName; name == nil || *name != "Ada Lovelace" {
		t.Fatalf("unexpected %+v", got.Response.Islands)
	}
	if calls.Load() != 1 {
		t.Fatalf("GetUser called %d times, want 1", calls.Load())
	}
}

func TestPostsOutageDoesNotBreakScreen(t *testing.T) {
	s := fakeServices()
	s.RecentPosts = func(context.Context, string) ([]Post, error) { return nil, errors.New("posts service down") }
	got := newApp(t, s).Screen("profile", profile, signedInAs("u_2"))
	posts, _ := got.Island("posts")
	if got.Status != 200 || posts.Status != "error" {
		t.Fatalf("unexpected %+v", got.Response.Islands)
	}
}
