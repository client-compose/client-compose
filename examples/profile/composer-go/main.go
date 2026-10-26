// Profile screen composer for the iOS + Android + Go example.
//
//	go run .
//	curl -s localhost:8080/screens/profile -H 'X-User-Id: u_2' -d '{"protocol":0,"screen":"profile","params":{"userId":"u_1"},"client":{"platform":"ios","appVersion":"4.2.0"},"islands":{"profile-header":[1,2],"follow-button":[1],"post-grid":[1]}}'
package main

import (
	"context"
	"errors"
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
	// Follow follows (or unfollows) a user and returns their followers. errBlocked if they've
	// blocked the viewer.
	Follow func(ctx context.Context, viewerID, userID string, follow bool) (int, error)
}

var errBlocked = errors.New("blocked")

func fakeServices() Services {
	return Services{
		GetUser: func(_ context.Context, id string) (User, error) {
			return User{ID: id, Name: "Ada Lovelace", AvatarURL: "https://example.com/avatars/" + id + ".png", Pro: true}, nil
		},
		IsFollowing: func(context.Context, string, string) (bool, error) { return false, nil },
		RecentPosts: func(_ context.Context, userID string) ([]Post, error) {
			return []Post{{ID: "p1", ThumbnailURL: "https://example.com/" + userID + "/p1.jpg"}}, nil
		},
		Follow: func(_ context.Context, _, userID string, follow bool) (int, error) {
			if userID == "u_blocker" {
				return 0, errBlocked
			}
			if follow {
				return 1043, nil
			}
			return 1042, nil
		},
	}
}

// --- Viewer identity (normally a session or a token) ---------------------------------

type viewerKey struct{}

// viewerContext is the composer's context function: it runs once per request, before anything
// else, and everything on the screen sees the viewer it adds.
func viewerContext(ctx context.Context, r *http.Request) (context.Context, error) {
	return context.WithValue(ctx, viewerKey{}, r.Header.Get("X-User-Id")), nil
}

// signedIn requires a viewer.
func signedIn(ctx context.Context, _ cc.Request) error {
	if viewer(ctx) == "" {
		return cc.ErrUnauthenticated
	}
	return nil
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
	// The header and the follow button both need the profile's user. cc.Load shares one GetUser call
	// between them per request, and a timeout in one island never cancels it for the other.
	user := func(ctx context.Context, id string) (User, error) {
		return cc.Load(ctx, "user:"+id, func(ctx context.Context) (User, error) { return s.GetUser(ctx, id) })
	}

	// cc.Define takes the island type and version from the generated props type.
	headerV1 := cc.Define(func(ctx context.Context, r cc.Request) (ProfileHeaderV1, error) {
		u, err := user(ctx, r.Params["userId"])
		return ProfileHeaderV1{DisplayName: u.Name, AvatarURL: u.AvatarURL}, err
	})

	headerV2 := cc.Define(func(ctx context.Context, r cc.Request) (ProfileHeaderV2, error) {
		u, err := user(ctx, r.Params["userId"])
		props := ProfileHeaderV2{UserID: u.ID, DisplayName: u.Name, AvatarURL: u.AvatarURL}
		if u.Pro {
			badge := "PRO"
			props.Badge = &badge
		}
		return props, err
	})

	followButton := cc.Define(func(ctx context.Context, r cc.Request) (FollowButtonV1, error) {
		id := r.Params["userId"]
		following, err := s.IsFollowing(ctx, viewer(ctx), id)
		if err != nil {
			return FollowButtonV1{}, err
		}
		u, err := user(ctx, id)
		return FollowButtonV1{UserID: id, IsFollowing: following, DisplayName: &u.Name}, err
	})

	postGrid := cc.Define(func(ctx context.Context, r cc.Request) (PostGridV1, error) {
		posts, err := s.RecentPosts(ctx, r.Params["userId"])
		grid := PostGridV1{Posts: []PostGridV1Post{}}
		for _, p := range posts {
			grid.Posts = append(grid.Posts, PostGridV1Post(p))
		}
		return grid, err
	})

	// Server-side decision: no follow button on your own profile, or when signed out.
	someoneElses := func(ctx context.Context, r cc.Request) (bool, error) {
		return viewer(ctx) != "" && viewer(ctx) != r.Params["userId"], nil
	}

	return cc.Screen{
		ID: "profile",
		Islands: []cc.Placement{
			{Key: "header", Versions: cc.Versions(headerV1, headerV2), Required: true},
			{Key: "follow", Versions: cc.Versions(followButton), When: someoneElses},
			{Key: "posts", Versions: cc.Versions(postGrid), Timeout: 500 * time.Millisecond},
		},
		CacheMaxAge: 30 * time.Second,
	}
}

// followUser follows or unfollows a user, and tells apps their profile changed.
func followUser(s Services) cc.Action {
	return cc.DefineAction(func(ctx context.Context, _ cc.Call, in FollowUserV1Input) (FollowUserV1Result, cc.Effects, error) {
		followers, err := s.Follow(ctx, viewer(ctx), in.UserID, in.Follow)
		if errors.Is(err, errBlocked) {
			return FollowUserV1Result{}, cc.Effects{}, FollowUserV1Blocked{}
		}
		if err != nil {
			return FollowUserV1Result{}, cc.Effects{}, err
		}
		profile := cc.ScreenRef{Screen: "profile", Params: map[string]string{"userId": in.UserID}}
		return FollowUserV1Result{Followers: followers}, cc.Effects{Invalidate: []cc.ScreenRef{profile}}, nil
	}).Requires(signedIn)
}

func newComposer(s Services) *cc.Composer {
	return cc.New(cc.Config{
		Screens: []cc.Screen{profileScreen(s)},
		Actions: []cc.Action{followUser(s)},
		Context: viewerContext,
		Use: []cc.Plugin{cc.ReportErrors(func(_ context.Context, f cc.Failure) {
			log.Printf("%s failed (screen %s, island %s): %v", f.Kind, f.Screen, f.Key, f.Err)
		})},
	})
}

func main() {
	log.Println("profile composer on :8080")
	log.Fatal(http.ListenAndServe(":8080", newComposer(fakeServices())))
}
