# Releasing the npm packages

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
2. Merging that PR publishes the bumped packages to npm with
   [provenance](https://docs.npmjs.com/generating-provenance-statements), and tags the release.

## One-time setup

1. **Create the npm organisation** `client-compose` at <https://www.npmjs.com/org/create>
   (free for public packages). Scoped packages can only be published by members of that org.
2. **Add an npm token as a repository secret.** Create a granular access token with read and
   write access to the `@client-compose` scope, then add it to the GitHub repo as `NPM_TOKEN`
   (Settings → Secrets and variables → Actions).
3. **Let GitHub Actions open pull requests**: Settings → Actions → General → "Allow GitHub
   Actions to create and approve pull requests" (on the organisation, then on the repo).

After the first release you can replace the token with npm
[trusted publishing](https://docs.npmjs.com/trusted-publishers): configure each package on npmjs.com
to trust this repository's `release.yml` workflow, then remove the `NPM_TOKEN` secret.

## Publishing manually

Only if CI is unavailable, from a clean checkout of `main` and logged in with `npm login`:

```sh
pnpm install --frozen-lockfile
pnpm check-packages
pnpm changeset version   # needs GITHUB_TOKEN for the GitHub changelog links
pnpm release
```
