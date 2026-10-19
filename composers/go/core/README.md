# Go composer

Tier: **core** · Protocol: **v0** · Dependencies: standard library only

```sh
go get github.com/client-compose/client-compose/composers/go/core
```

```go
import cc "github.com/client-compose/client-compose/composers/go/core"

// ProfileHeaderV1 is generated from the island manifest by codegen/, so cc.Define knows its
// island type and version. (cc.NewIsland("profile-header", 1, ...) works with hand-written types.)
header := cc.Define(func(ctx context.Context, r cc.Request) (ProfileHeaderV1, error) {
	u, err := users.Get(ctx, r.Params["userId"])
	return ProfileHeaderV1{DisplayName: u.Name, AvatarURL: u.Avatar}, err
})

profile := cc.Screen{
	ID: "profile",
	Layout: func(ctx context.Context, r cc.Request) ([]cc.Placement, error) {
		return []cc.Placement{{Key: "header", Versions: []cc.Island{header}, Required: true}}, nil
	},
}

composer := cc.New([]cc.Screen{profile}, cc.WithDefaultTimeout(time.Second))
http.ListenAndServe(":8080", composer.Handler())
```

- Return an error wrapping `cc.ErrNotFound` from a layout when what the params refer to doesn't
  exist (a batch loader's missing key already does); the screen responds 404 `not_found`.
- `Screen.Meta` optionally describes the screen as a whole (title, description, image). It runs
  alongside the islands and shares their `cc.Load`s; if it fails, the response just has no meta.
- Auth and other per-request values travel on `context.Context`: wrap `Handler()` in your middleware.
- To share data between islands and batch lookups, see [Loading data efficiently](#loading-data-efficiently).
- For other routers (chi, gin, echo), call `composer.ComposeHTTP(ctx, screenID, body)` and
  `cc.WriteResult(w, result)` from your own route.
- A panicking island is treated like a failing one; it doesn't take the screen down.

See `examples/profile/composer-go` for a full example with tests.

## Loading data efficiently

Islands resolve in parallel, and several often need the same data. Three layers, from most to
least specific:

**1. Share data between islands in a request: `cc.Load`.** The first call with a key runs the
function; every other call with that key in the same request (other islands, and the layout) gets
the same result. Wrap each lookup in a helper so every island uses the same key:

```go
user := func(ctx context.Context, id string) (User, error) {
	return cc.Load(ctx, "user:"+id, func(ctx context.Context) (User, error) { return users.Get(ctx, id) })
}
```

The function gets the **request's** context, not the calling island's, so an island timing out never
cancels work another island is waiting on; each caller still returns at its own timeout. See
`examples/profile/composer-go`, where the header and follow button share one `GetUser` call.

**2. Combine lookups across islands into one call: `cc.NewBatchLoader`.** When islands need
different items from the same service, a batch loader collects their keys (de-duplicated) and makes
one call:

```go
// Create once, at startup; batches and results are per request.
var userByID = cc.NewBatchLoader(func(ctx context.Context, ids []string) (map[string]User, error) {
	return users.GetMany(ctx, ids)
})

// in any resolver or layout:
author, err := userByID.Load(ctx, post.AuthorID)
```

Keys missing from the returned map fail with `cc.ErrNotFound`. Options: `cc.WithBatchWindow`
(default 2ms) and `cc.WithMaxBatchSize`.

**3. Cache across requests in your service clients, not here.** `Load` and batch loaders are scoped
to one request on purpose, so one user's data never leaks into another's screen. Cache shareable
data (catalogue entries, feature config) in the service client, keyed by everything the result
depends on, including the viewer when it's personalised.

Rules of thumb: put every input in the key (`"user:"+id`); use one result type per key (a mismatch
is reported as an error); loading in the layout is fine, and islands reuse it. Outside a composer
request (e.g. unit-testing a helper), `Load` and `BatchLoader.Load` just call through.

## Tests

```sh
go test ./...
# shared conformance suite (needs Node 24+), from the repo root:
go build -o /tmp/cs ./composers/go/core/cmd/conformance-server && conformance/run-against.sh 4100 /tmp/cs -addr :4100
```
