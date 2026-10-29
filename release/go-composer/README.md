# The Go composer's releases

The Go composer (`composers/go/core`) is a Go module, released by tagging it
(`composers/go/core/v0.12.0`). This folder lets [Changesets](https://github.com/changesets/changesets)
version it like the npm packages: `package.json` holds its version, and `CHANGELOG.md` its
changelog. It's a private workspace package, never published to npm.

A change to the Go composer comes with a changeset naming `go-composer` (`pnpm changeset`). CI
fails without one. The Release packages PR bumps the version here, and merging it tags the module
and creates its GitHub release. See [RELEASING.md](../../RELEASING.md).
