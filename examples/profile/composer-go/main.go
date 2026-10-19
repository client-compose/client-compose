// Profile screen composer for the iOS + Android + Go example.
//
//	go run .
//	curl -s localhost:8080/screens/profile -H 'X-User-Id: u_2' -d '{"protocol":0,"screen":"profile","params":{"userId":"u_1"},"client":{"platform":"ios","appVersion":"4.2.0"},"islands":{"profile-header":[1,2],"follow-button":[1],"post-grid":[1]}}'
package main

import (
	"context"
	"log"
	"net/http"
	"time"

	cc "github.com/client-compose/client-compose/composers/go/core"
)

// --- Stand-ins for your existing backend services -----------------------------------

type User struct {
	ID, Name, AvatarURL string
	Pro                 bool
}

type Post struct{ ID, ThumbnailURL string }

type Services struct {
	GetUser     func(ctx context.Context, id string) (User, error)
	IsFollowing func(ctx context.Context, viewerID, userID string) (bool, error)
	RecentPosts func(ctx context.Context, userID string) ([]Post, error)
}

func fakeServices() Services {
	return Services{
		GetUser: func(_ context.Context, id string) (User, error) {
			return User{ID: id, Name: "Ada Lovelace", AvatarURL: "https://example.com/avatars/" + id + ".png", Pro: true}, nil
		},
		IsFollowing: func(context.Context, string, string) (bool, error) { return false, nil },
		RecentPosts: func(_ context.Context, userID string) ([]Post, error) {
			return []Post{{ID: "p1", ThumbnailURL: "https://example.com/" + userID + "/p1.jpg"}}, nil
		},
	}
}

// --- Viewer identity (normally your auth middleware) ---------------------------------

type viewerKey struct{}

func withViewer(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx := context.WithValue(r.Context(), viewerKey{}, r.Header.Get("X-User-Id"))
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func viewer(ctx context.Context) string {
	id, _ := ctx.Value(viewerKey{}).(string)
	return id
}

// --- Island props --------------------------------------------------------------------
// ProfileHeaderV1, ProfileHeaderV2, FollowButtonV1 and PostGridV1 are generated from
// ../islands into islands_gen.go (also the Swift and Kotlin types). Regenerate with `go generate`.

//go:generate node ../../../codegen/cli.ts ../client-compose.codegen.json

// --- Islands and screens ---------------------------------------------------------------

func profileScreen(s Services) cc.Screen {
	// cc.Define takes the island type and version from the generated props type.
	headerV1 := cc.Define(func(ctx context.Context, r cc.Request) (ProfileHeaderV1, error) {
		u, err := s.GetUser(ctx, r.Params["userId"])
		return ProfileHeaderV1{DisplayName: u.Name, AvatarURL: u.AvatarURL}, err
	})

	headerV2 := cc.Define(func(ctx context.Context, r cc.Request) (ProfileHeaderV2, error) {
		u, err := s.GetUser(ctx, r.Params["userId"])
		props := ProfileHeaderV2{UserID: u.ID, DisplayName: u.Name, AvatarURL: u.AvatarURL}
		if u.Pro {
			badge := "PRO"
			props.Badge = &badge
		}
		return props, err
	})

	followButton := cc.Define(func(ctx context.Context, r cc.Request) (FollowButtonV1, error) {
		following, err := s.IsFollowing(ctx, viewer(ctx), r.Params["userId"])
		return FollowButtonV1{UserID: r.Params["userId"], IsFollowing: following}, err
	})

	postGrid := cc.Define(func(ctx context.Context, r cc.Request) (PostGridV1, error) {
		posts, err := s.RecentPosts(ctx, r.Params["userId"])
		grid := PostGridV1{Posts: []PostGridV1Post{}}
		for _, p := range posts {
			grid.Posts = append(grid.Posts, PostGridV1Post{ID: p.ID, ThumbnailURL: p.ThumbnailURL})
		}
		return grid, err
	})

	return cc.Screen{
		ID:          "profile",
		CacheMaxAge: 30 * time.Second,
		Layout: func(ctx context.Context, r cc.Request) ([]cc.Placement, error) {
			placements := []cc.Placement{
				{Key: "header", Versions: []cc.Island{headerV1, headerV2}, Required: true},
			}
			// Server-side decision: no follow button on your own profile.
			if viewer(ctx) != "" && viewer(ctx) != r.Params["userId"] {
				placements = append(placements, cc.Placement{Key: "follow", Versions: []cc.Island{followButton}})
			}
			placements = append(placements, cc.Placement{Key: "posts", Versions: []cc.Island{postGrid}, Timeout: 500 * time.Millisecond})
			return placements, nil
		},
	}
}

func newHandler(s Services) http.Handler {
	composer := cc.New(
		[]cc.Screen{profileScreen(s)},
		cc.WithIslandErrorHandler(func(_ context.Context, key, typ string, err error) {
			log.Printf("island %s (%s) failed: %v", key, typ, err)
		}),
	)
	return withViewer(composer.Handler())
}

func main() {
	log.Println("profile composer on :8080")
	log.Fatal(http.ListenAndServe(":8080", newHandler(fakeServices())))
}
