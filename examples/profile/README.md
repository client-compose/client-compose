# Example: native iOS + Android apps with a Go backend

A profile screen built from four islands, shared by both apps:

| Island           | Version(s) | What the composer provides                  | What stays in the app                |
| ---------------- | ---------- | ------------------------------------------- | ------------------------------------ |
| `profile-header` | 1, 2       | name, avatar URL, (v2) id + badge           | layout, styling, image loading       |
| `follow-button`  | 1          | target user id, initial follow state        | the follow/unfollow API call         |
| `post-grid`      | 1          | post ids + thumbnail URLs                   | grid layout, tap handling            |

```
islands/                      the contract: one JSON manifest per island version
client-compose.codegen.json   generates the props types below from islands/
composer-go/                  the Go backend-for-frontend (runnable, with tests)
  islands_gen.go              generated
ios/                          SwiftUI views + registry (ClientCompose + ClientComposeSwiftUI)
  Islands.generated.swift     generated
android/                      Jetpack Compose UI + registry + OkHttp transport (dev.clientcompose:core)
  Islands.generated.kt        generated
```

## What this setup lets you do without an app release

- **Reorder, add or remove islands** on the profile, per platform, app version, user or experiment.
  For example, `composer-go` hides the follow button on your own profile; that's a server rule.
- **Change where data comes from.** Swap the posts service, add caching, or merge two services
  in the resolver. The apps never notice.
- **Ship a new island version gradually.** v2 of the header added a badge. Apps that shipped with
  v2 get it; older apps keep getting v1 from the same endpoint (see `TestOldAppStillWorks`).
- **Survive outages.** If the posts service is down, the header still renders and the grid is
  reported as an error, which the apps hide by default (see `TestPostsOutageDoesNotBreakScreen`).

What still needs an app release: a brand new island, or a visual change to an existing one.

## The flow

1. The app registers renderers for the islands it ships with, e.g. iOS 4.2 has
   `profile-header` v1+v2, `follow-button` v1 and `post-grid` v1.
2. Opening a profile POSTs `/screens/profile` with `params.userId` and those capabilities.
3. `composer-go` picks the islands, chooses the highest common version of each, and calls the
   user, follow and post services in parallel with per-island timeouts.
4. The app gets back an ordered list and renders each island with its own native view.

## Running it

```sh
cd composer-go
go test ./...   # the scenarios above
go run .        # then use the curl at the top of main.go
```

The `ios/` and `android/` files show how an app uses the clients. They aren't part of a buildable
app project here, so drop them into an Xcode / Android Studio project to run them.

## Changing an island

1. Edit or add a manifest in `islands/`. Within a version, only add optional props; anything
   else is a new version file (see [codegen's compatibility rules](../../codegen/README.md#compatibility-rules-for-manifests)).
2. Regenerate the Go, Swift and Kotlin types: `go generate` in `composer-go/`, or
   `node codegen/cli.ts examples/profile/client-compose.codegen.json` from the repo root.
3. The compilers now point at every resolver and renderer that needs updating. CI runs
   `--check` so generated files can't drift from the manifests.
