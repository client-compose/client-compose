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
- `When`: decides per request whether it appears, e.g. no follow button on your own profile. It
  can load data (sharing loads with the islands), and its errors are handled like a layout's: a
  `cc.ErrNotFound` answers 404.

`cc.Static(key, props)` places an island whose props are known up front: a form, a heading.

When a screen's islands can only be decided per request (from a CMS, or an experiment), give it a
`Layout` function instead of `Islands`. Return an error wrapping `cc.ErrNotFound` from it when what
the params refer to doesn't exist; the screen responds 404 `not_found`.

`Meta` optionally describes the screen as a whole (title, description, image). It runs alongside the
islands and shares their loads; if it fails, the response just has no meta.

A panicking island or layout is treated like a failing one; it doesn't take the server down.

## Streaming

Every screen is answered as a stream (spec §4.6), so apps can show it as it arrives. The composer
sends its head once everything that could fail the whole screen is settled: its requirements and
layout (including each `When`), its `Required` islands and its `Meta`. Islands not ready by then are
`pending` in the head, and follow, each on its own line, as they're resolved. Then the stream ends.

So which islands are worth marking `Required`, and what conditions cost, now decide how soon a screen
shows: a required island holds back the head, and so does a `When` that waits on slow data. Shared
loads (`cc.Load`) live until the stream ends.

`ServeHTTP` writes the stream, flushing each line as it's ready. In process, a successful
`composer.Compose(ctx, req)` result's `Body` is a `*cc.ScreenStream` (its `Head`, and a channel of the
`Islands` still to come); `stream.Collect()` puts the screen together. `cc.ReadScreen(body)` reads a
stream from HTTP, for Go clients and tests.

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

A `cc.Requirement` checks the context and the request before a screen or action runs. Return
`cc.ErrUnauthenticated`, `cc.ErrForbidden` or `cc.ErrNotFound` and the app gets 401, 403 or 404,
without your islands or handler running:

```go
var signedIn cc.Requirement = func(ctx context.Context, _ cc.Request) error {
	if _, ok := viewerFrom(ctx); !ok {
		return cc.ErrUnauthenticated
	}
	return nil
}

// A screen for editing a recipe: 404 if there's no such recipe, 403 unless the viewer may edit it.
editsRecipe := func(ctx context.Context, r cc.Request) error {
	_, err := recipes.Editable(ctx, r.Params["recipeId"])
	return err
}
```

Requirements run in order, so put `signedIn` first. An action's requirements see its client context
but no params; check its input in the action itself.

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
- `call.IdempotencyKey` is the app's key for this intent. To have the composer honour it for every
  action, give it an idempotency store (below); otherwise store it with the change yourself if
  retries must not repeat it.

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

## Islands with pages

A feed or a list of results sends its first page with the screen, and its next pages as the person
scrolls (spec §4.5). Define it with `DefinePaged`: it resolves the page `r.Cursor` asks for (the
first when it's empty) to that page's props, and the cursor of the page after it, or `""` at the
end. The cursor is yours: whatever you need to go on, such as an offset, and the time the first
page was made so that newer items don't push the list along.

```go
results := cc.DefinePaged(func(ctx context.Context, r cc.Request) (ResultListV1, string, error) {
	from, err := readCursor(r.Cursor) // "" for the first page
	if err != nil {
		return ResultListV1{}, "", fmt.Errorf("results: %w", cc.ErrInvalidCursor) // 400 invalid_cursor
	}
	items, more, err := search(ctx, r.Params["q"], from)
	if err != nil {
		return ResultListV1{}, "", err
	}
	next := ""
	if more {
		next = makeCursor(from.after(items))
	}
	return ResultListV1{Items: items}, next, nil
})
```

The island's entry carries `next` while there are more pages. Clients fetch them from
`POST /screens/{screen}/islands/{key}`, which lays the screen out as it would (requirements,
layout, `When`) and resolves that one island. The same request without a cursor resolves any
island again, so a client can refresh one without the whole screen. Paged islands aren't cached.

In tests, `app.NextPage(screen, "results")` fetches the page after a screen's island, `app.Next`
the one after that, and `cctest.IslandProps[ResultListV1](t, page)` reads it.

## Strings

Every word an app shows comes from the composer (spec §4.7), so copy changes, and new languages
ship, without an app release. Islands declare their strings in their manifests, and the app its
own in an app strings manifest; the words are a catalog, one JSON file per language:

```json
// strings/pl.json
{
  "app": { "loading": "Ładowanie" },
  "islands": {
    "recipe-list@1": {
      "heading": "Najnowsze przepisy",
      "count": { "#1": "{count} przepis", "#few": "{count} przepisy", "#*": "{count} przepisów" }
    }
  }
}
```

```go
//go:embed strings
var stringsFS embed.FS

sub, _ := fs.Sub(stringsFS, "strings")
catalog, err := cc.LoadCatalog(sub)
if err != nil {
	log.Fatal(err)
}
composer := cc.New(cc.Config{
	Screens: screens,
	Strings: &cc.StringsConfig{Catalog: catalog, DefaultLocale: "en"},
})
```

Each island's entry then carries its strings in the client's `Locale`, or the nearest language the
catalog has (`pl-PL`, then `pl`, then the default), with any string a language lacks taken from
the default. The stream's head says which language that is, with its plural rules, for counted
strings. `POST /strings` answers the app strings, without running the context hooks, since an app
needs its words before anyone signs in. `client-compose-codegen strings` checks the catalog against
the manifests.

A screen's own words, such as its meta's title, are its screen strings: declared in a screen strings
manifest, in the catalog under `screens`, and read in the request's language with the generated
type: `CreatorScreenStringsFor(r).Title(name)` (or `r.ScreenStrings("creator")`).

In tests, `app.Strings("pl")` fetches the app strings, and an island's entry has its `Strings`.

## Caching islands (optional)

To keep an island's props between requests, give the composer a `cc.Cache` and opt islands in with
`CacheFor`. The cache is your own: implement `Get` and `Set` with whatever you run. Without
`Config.Cache`, nothing is cached and every island resolves on every request.

```go
// Your adapter, e.g. over go-redis:
type redisCache struct{ rdb *redis.Client }

func (c redisCache) Get(ctx context.Context, key string) ([]byte, bool, error) {
	v, err := c.rdb.Get(ctx, key).Bytes()
	if errors.Is(err, redis.Nil) {
		return nil, false, nil
	}
	return v, err == nil, err
}

func (c redisCache) Set(ctx context.Context, key string, value []byte, ttl time.Duration) error {
	return c.rdb.Set(ctx, key, value, ttl).Err()
}

// Islands say how long, and what their props depend on:
trending := cc.Define(resolveTrending).CacheFor(5*time.Minute, func(context.Context, cc.Request) string { return "all" })
feed := cc.Define(resolveFeed).CacheFor(30*time.Second, func(ctx context.Context, r cc.Request) string {
	return viewerID(ctx) + ":" + r.Params["page"] // personalised: the viewer is in the key
})

composer := cc.New(cc.Config{Screens: screens, Cache: redisCache{rdb}})
```

- The key function returns what the props depend on; the composer adds the island's type and
  version. Return `""` to skip the cache for this request.
- Failures are never cached.
- If the cache errors, the island resolves anyway and the error reaches plugins as a `CacheFailed`
  failure, so a cache outage never breaks a screen.
- In tests, `cctest.NewMemoryCache()` is an in-memory `cc.Cache`.

## Retried actions (optional)

Apps send an idempotency key with each action, and reuse it when they retry the same intent. Give
the composer an `IdempotencyStore` and it honours those keys for every action: the first call runs,
and a retry gets the first outcome back instead of running again. The store is your own; without
`Config.Idempotency`, keys just pass through to your actions as `call.IdempotencyKey`.

```go
composer := cc.New(cc.Config{
	Actions: actions,
	Idempotency: &cc.Idempotency{
		Store: redisIdempotency{rdb},                                     // your adapter: Begin, Finish, Release
		Scope: func(ctx context.Context) string { return viewerID(ctx) }, // whose keys these are
	},
})
```

- With Redis, `Begin` is a `SET NX` of a "running" marker (returning the outcome if one is stored),
  `Finish` a `SET` of the outcome, and `Release` a `DEL`.
- `Scope` is required, so one caller can never replay another's key. Return `""` for actions anyone
  may share.
- Only completed outcomes are kept: results and declared errors. A failure releases the key, so a
  retry runs again.
- A duplicate that arrives while the first call is running waits for it (`Wait`, default 10s).
- Outcomes are kept for `TTL` (default 24h).
- If the store errors, the action runs anyway and the error reaches plugins as an
  `IdempotencyFailed` failure.
- In tests, `cctest.NewMemoryIdempotencyStore()` is an in-memory store.

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
- `Screen` has `Status`, `Keys()`, `Island(key)` and the full `Response`, with every island in
  place; `Head` is its stream's head, to check what was pending. Errors come back as their protocol
  code (`"not_found"`, `"unauthenticated"`).
- `Perform` returns the typed result, effects, and the declared or protocol error code.
- Pass your own `http.Handler` instead of the composer if it wraps the composer in middleware.

See `examples/profile/composer-go` for a full example with tests.

## Tests

```sh
go test ./...
# shared conformance suite (needs Node 24+), from the repo root:
go build -o /tmp/cs ./composers/go/core/cmd/conformance-server && conformance/run-against.sh 4100 /tmp/cs -addr :4100 -strings conformance/composer/strings
```
