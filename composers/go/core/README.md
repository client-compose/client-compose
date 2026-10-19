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

- Auth and other per-request values travel on `context.Context`: wrap `Handler()` in your middleware.
- For other routers (chi, gin, echo), call `composer.ComposeHTTP(ctx, screenID, body)` and
  `cc.WriteResult(w, result)` from your own route.
- A panicking island is treated like a failing one; it doesn't take the screen down.

See `examples/profile/composer-go` for a full example with tests.

## Tests

```sh
go test ./...
# shared conformance suite (needs Node 24+), from the repo root:
go build -o /tmp/cs ./composers/go/core/cmd/conformance-server && conformance/run-against.sh 4100 /tmp/cs -addr :4100
```
