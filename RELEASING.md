# Releasing

The TypeScript packages are published to npm under the `@client-compose` scope:

| Package | Path |
| --- | --- |
| `@client-compose/protocol` | `shared/typescript/protocol` |
| `@client-compose/client` | `clients/typescript/core` |
| `@client-compose/react` | `clients/typescript/react` |
| `@client-compose/composer` | `composers/typescript/core` |
| `@client-compose/node-http` | `composers/typescript/node-http` |
| `@client-compose/codegen` | `codegen` |
| `@client-compose/conformance` | `conformance/runner` |

They're versioned independently with [Changesets](https://github.com/changesets/changesets).

## How packages are built

In this repo each package's `exports` points at its TypeScript source, so tests, examples and other
packages run without a build. `pnpm build` compiles every package to `dist/` (ESM JavaScript,
`.d.ts` files and source maps). When publishing, pnpm swaps in the `dist/` entry points from each
package's `publishConfig`.

`scripts/check-packages.sh` (also `pnpm check-packages`) builds and packs every package, lints the
tarballs with [publint](https://publint.dev) and [Are the Types Wrong?](https://arethetypeswrong.github.io),
installs them into a fresh project, type-checks it under `nodenext` and `bundler` resolution, and
runs the conformance suites and both CLIs from the installed packages. CI runs it on every change
and before every release.

## Making a change that should be released

Add a changeset in the same PR:

```sh
pnpm changeset
```

Pick the packages you changed and the bump (patch / minor / major), and describe the change for the
changelog. Commit the generated file in `.changeset/`.

## How a release happens

The `release` workflow runs on every push to `main`:

1. If there are pending changesets, it opens (or updates) a **Release packages** PR that bumps
   versions, updates internal dependency ranges and writes `CHANGELOG.md` files.
2. Merging that PR runs `scripts/check-packages.sh`, then publishes the bumped packages to npm,
   tags them and creates GitHub releases.
3. When `@client-compose/codegen` is published, standalone `client-compose-codegen` executables for
   Linux, macOS and Windows (built with `scripts/build-codegen-binaries.sh`) and a `SHA256SUMS`
   file are attached to its GitHub release.

Publishing uses npm [trusted publishing](https://docs.npmjs.com/trusted-publishers): npm accepts
publishes only from this repository's `release.yml`, authenticated with a short-lived OIDC token, so
there's no npm token to leak. Every version gets a [provenance](https://docs.npmjs.com/generating-provenance-statements)
statement linking it to the commit and workflow run that built it. Only the `publish` job can
request the OIDC token.

## The Go composer

The Go composer (`composers/go/core`) is a Go module, released by a tag of the form Go requires:
`composers/go/core/v0.12.0`. Changesets versions it too, through a private workspace package that
only holds its version and changelog: [`release/go-composer`](release/go-composer).

- A change to its code comes with a changeset naming `go-composer`. CI fails a pull request
  without one (`scripts/check-go-changeset.sh`); tests and docs alone don't need one.
- The Release packages PR bumps `release/go-composer/package.json` and writes its `CHANGELOG.md`.
- On every push to `main`, the `release` workflow's `go-module` job runs
  `scripts/tag-go-module.sh`: if that version isn't tagged yet, it tags it and creates a GitHub
  release with its changelog. It's never published to npm.

## One-time setup (already done)

1. The npm organisation `client-compose` owns the `@client-compose` scope.
2. GitHub Actions may create pull requests (Settings → Actions → General, on the organisation and
   the repository).
3. The first versions were published from a maintainer's machine with `scripts/first-release.sh`,
   which also registered `release.yml` as each package's trusted publisher. (Trusted publishing can
   only be configured for packages that already exist.)

## Adding a new package

A brand-new package has the same chicken-and-egg problem: publish its first version from a
maintainer's machine (`npm login`, then `pnpm build && pnpm changeset publish`), then trust the
workflow:

```sh
npx npm@11.19.0 trust github @client-compose/<name> --file release.yml \
  --repository client-compose/client-compose --allow-publish
```

## Publishing manually

Only if CI is unavailable, from a clean checkout of `main` and logged in with `npm login`:

```sh
pnpm install --frozen-lockfile
pnpm check-packages
pnpm changeset version   # needs GITHUB_TOKEN for the GitHub changelog links
pnpm release
```
