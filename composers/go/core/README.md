# Go composer

Tier: **core** · Protocol: **v0** · Dependencies: standard library only

```sh
go get github.com/client-compose/client-compose/composers/go/core
```

A composer decides what each screen is made of and resolves its islands' props, in parallel,
from your services. You declare screens as data, and the composer handles version negotiation,
timeouts and failure isolation.

```go
import cc "github.com/client-compose/client-compose/composers/go/core"

// ProfileHeaderV2 and FollowButtonV1 are generated from the island manifests by codegen/, so
// cc.Define knows each island's type and version.
header := cc.Define(func(ctx context.Context, r cc.Request) (ProfileHeaderV2, error) {
	u, err := users.Get(ctx, r.Params["userId"])
	return ProfileHeaderV2{DisplayName: u.Name, AvatarURL: u.Avatar}, err
})

profile := cc.Screen{
	ID:       "profile",
	Requires: []cc.Requirement{signedIn},
	Islands: []cc.Placement{
		{Key: "header", Versions: cc.Versions(header), Required: true},
		{Key: "follow", Versions: cc.Versions(followButton), When: someoneElses},
		{Key: "posts", Versions: cc.Versions(postGridV1, postGridV2), Timeout: 300 * time.Millisecond},
		cc.Static("report", ReportLinkV1{Label: "Report this profile"}),
	},
	CacheMaxAge: 30 * time.Second,
}

composer := cc.New(cc.Config{
	Screens: []cc.Screen{profile},
	Actions: []cc.Action{followUser},
	Context: sessions.Viewer, // the viewer, from a cookie or token, for every island and action
	Use:     []cc.Plugin{cc.ReportErrors(logFailure)},
})

http.ListenAndServe(":8080", composer) // a Composer is an http.Handler
```

## Screens

A screen lists its islands in order. Each placement can say:

- `Versions`: every version of the island you can resolve. The highest one the app supports is
  sent; if there's none, the island is left out (`cc.Versions(v1, v2)`).
- `Required`: the screen fails without it.
- `Timeout`: overrides `Config.DefaultTimeout` (2s).
- `When`: decides per request whether it appears, e.g. no follow button on your own profile.

`cc.Static(key, props)` places an island whose props are known up front: a form, a heading.

When a screen's islands can only be decided per request (from a CMS, or an experiment), give it a
`Layout` function instead of `Islands`. Return an error wrapping `cc.ErrNotFound` from it when what
the params refer to doesn't exist; the screen responds 404 `not_found`.

`Meta` optionally describes the screen as a whole (title, description, image). It runs alongside the
islands and shares their loads; if it fails, the response just has no meta.

A panicking island or layout is treated like a failing one; it doesn't take the server down.

## Context and requirements

`Config.Context` runs once per HTTP request, before anything else. Use it to put the viewer, their
locale or a tenant on the context every layout, island and action receives:

```go
func viewerContext(ctx context.Context, r *http.Request) (context.Context, error) {
	viewer, err := sessions.Read(r)
	if err != nil {
		return ctx, err
	}
	return withViewer(ctx, viewer), nil
}
```

A `cc.Requirement` checks that context before a screen or action runs. Return `cc.ErrUnauthenticated`
or `cc.ErrForbidden` and the app gets 401 or 403, without your layout or handler running:

```go
var signedIn cc.Requirement = func(ctx context.Context) error {
	if _, ok := viewerFrom(ctx); !ok {
		return cc.ErrUnauthenticated
	}
	return nil
}
```

Islands and actions can also return those errors (wrapped or not) when they find out late.

## Actions

Actions (spec §5) change things. Define each version with its generated types, and list them in
`Config.Actions`. The composer serves them at `POST /actions/{action}`:

```go
followUser := cc.DefineAction(func(ctx context.Context, call cc.Call, in FollowUserV1Input) (FollowUserV1Result, cc.Effects, error) {
	me := viewer(ctx)
	if blocked(ctx, in.UserID, me) {
		return FollowUserV1Result{}, cc.Effects{}, FollowUserV1Blocked{} // a declared error: 200, status "error"
	}
	n, err := follows.Add(ctx, me, in.UserID, call.IdempotencyKey)
	if err != nil {
		return FollowUserV1Result{}, cc.Effects{}, err // 500 action_failed, reported to plugins
	}
	profile := cc.ScreenRef{Screen: "profile", Params: map[string]string{"userId": in.UserID}}
	return FollowUserV1Result{Followers: n}, cc.Effects{Invalidate: []cc.ScreenRef{profile}}, nil
}).Requires(signedIn)
```

- Requirements are checked first, then the input is validated against the manifest (400
  `invalid_input`), then your handler runs.
- Declared errors are the generated error types, possibly wrapped. Only this action version's own
  errors count; anything else is a failure.
- `cc.Effects` tells apps which screens to reload (`Invalidate`) and, optionally, which to show next
  (`Navigate`).
- `call.IdempotencyKey` is the app's key for this intent. Store it with the change if retries must
  not repeat it.

## Plugins

A `cc.Plugin` hooks into the composer. Set the hooks you need:

| Hook | Wraps | For |
| --- | --- | --- |
| `Context` | each HTTP request, first | the viewer, locale, tenant |
| `Screen` | composing a whole screen | tracing, metrics, caching whole anonymous screens |
| `Island` | resolving one island version | caching props, tracing, per-island metrics |
| `Action` | performing an action | idempotency stores, rate limits, audit logs |
| `Error` | every failure | logs, error tracking |

Plugins run in the order they're listed in `Config.Use`, the first outermost. `cc.ReportErrors(fn)`
is a plugin with just an `Error` hook:

```go
cc.ReportErrors(func(ctx context.Context, f cc.Failure) {
	slog.ErrorContext(ctx, "composer failure", "kind", f.Kind, "screen", f.Screen, "island", f.Key, "action", f.Action, "error", f.Err)
})
```

## Mounting

A `*cc.Composer` is an `http.Handler` serving `POST /screens/{screen}` and `POST /actions/{action}`.
Under a prefix, use `http.StripPrefix("/compose", composer)`. Other routers take handlers too: chi's
`r.Mount("/compose", composer)`, `gin.WrapH(composer)`, `echo.WrapHandler(composer)`.

## Loading data efficiently

Islands resolve in parallel, and several often need the same data. Three layers, from most to
least specific:

**1. Share data between islands in a request: `cc.Load`.** The first call with a key runs the
function; every other call with that key in the same request (other islands, the layout, meta) gets
the same result. Wrap each lookup in a helper so every island uses the same key:

```go
user := func(ctx context.Context, id string) (User, error) {
	return cc.Load(ctx, "user:"+id, func(ctx context.Context) (User, error) { return users.Get(ctx, id) })
}
```

The function gets the **request's** context, not the calling island's, so an island timing out never
cancels work another island is waiting on; each caller still returns at its own timeout.

**2. Combine lookups across islands into one call: `cc.NewBatchLoader`.** When islands need
different items from the same service, a batch loader collects their keys (de-duplicated) and makes
one call:

```go
// Create once, at startup; batches and results are per request.
var userByID = cc.NewBatchLoader(func(ctx context.Context, ids []string) (map[string]User, error) {
	return users.GetMany(ctx, ids)
})

author, err := userByID.Load(ctx, post.AuthorID)
authors, err := userByID.LoadMany(ctx, authorIDs) // fails if any is missing
```

Keys missing from the returned map fail with `cc.ErrNotFound`. Options: `cc.WithBatchWindow`
(default 2ms) and `cc.WithMaxBatchSize`.

**3. Cache across requests in your service clients, not here.** `Load` and batch loaders are scoped
to one request on purpose, so one user's data never leaks into another's screen.

Rules of thumb: put every input in the key (`"user:"+id`); use one result type per key (a mismatch
is reported as an error); loading in the layout or in a `When` is fine, and islands reuse it.
Outside a composer request (e.g. unit-testing a helper), `Load` and `BatchLoader.Load` just call
through.

## Testing

`cctest` calls your composer in-process, the way apps do, so your context function, requirements
and plugins all run, and gives you typed results:

```go
import "github.com/client-compose/client-compose/composers/go/core/cctest"

func TestProfile(t *testing.T) {
	app := cctest.New(t, newComposer(fakeServices()))

	profile := app.Screen("profile", cctest.Params{"userId": "u1"}, cctest.Header("Authorization", "Bearer t"))
	header := cctest.Props[ProfileHeaderV2](t, profile, "header")

	followed := cctest.Perform(app, FollowUserV1Input{UserID: "u1"})
	if followed.Status != "ok" || followed.Result.Followers != 8 { … }
}
```

- By default the app declares every island your declared screens place. To test an older app,
  `cctest.Declare(ProfileHeaderV1{}, PostGridV1{})` declares just those.
- `Screen` has `Status`, `Keys()`, `Island(key)` and the full `Response`; errors come back as their
  protocol code (`"not_found"`, `"unauthenticated"`).
- `Perform` returns the typed result, effects, and the declared or protocol error code.
- Pass your own `http.Handler` instead of the composer if it wraps the composer in middleware.

See `examples/profile/composer-go` for a full example with tests.

## Tests

```sh
go test ./...
# shared conformance suite (needs Node 24+), from the repo root:
go build -o /tmp/cs ./composers/go/core/cmd/conformance-server && conformance/run-against.sh 4100 /tmp/cs -addr :4100
```
