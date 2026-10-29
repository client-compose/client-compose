# Contributing

Client Compose is a protocol first. The code in this repo is a set of **implementations**
of that protocol, one per stack, mostly contributed by people who use that stack.

## Kinds of contribution

| Change                       | Where                              | Bar                                                       |
| ---------------------------- | ---------------------------------- | --------------------------------------------------------- |
| Protocol change              | `spec/`, `conformance/`            | RFC-style issue first. See [Changing the protocol](#changing-the-protocol). |
| New composer core            | `composers/<language>/core`        | Passes composer conformance. [Checklist](#adding-an-implementation). |
| New composer framework adapter | `composers/<language>/<framework>` | Passes composer conformance through that framework.      |
| New client core              | `clients/<platform>/core`          | Passes client conformance fixtures.                       |
| UI binding                   | `clients/<platform>/<ui-lib>`      | Example usage + a smoke test.                             |
| New codegen target           | `codegen/src/targets/<language>.ts` | Golden output for `codegen/test/fixtures` that compiles and decodes the sample in that language's CI. |
| Fix to an implementation     | anywhere                           | Its owner reviews (see `.github/CODEOWNERS`).            |

Swift and Kotlin clients were here once, and were removed until someone can maintain them. They're
welcome back: open an issue to take one on. A Swift package lives at the repository root
(`Package.swift`), because SwiftPM only resolves packages from there.

## Layout

```
spec/                      the protocol (normative) + JSON Schemas
conformance/
  composer/cases.json      HTTP cases every composer must pass
  client/cases.json        fixtures every client must pass
  runner/                  runs composer cases against any URL (Node 24+)
  run-against.sh           start a conformance server, run the suite, stop it
composers/<language>/
  core/                    negotiation, timeouts, failure isolation, request validation
  <framework>/             thin adapter: HTTP in, core, HTTP out
clients/<platform>/
  core/                    registry, request building, response planning, transport
  <ui-lib>/                optional UI binding (React, ...)
codegen/                   manifests -> props types per language (Node CLI)
examples/                  end-to-end examples across stacks
```

**Core vs adapter.** Each language has one core that implements the protocol rules. Framework
adapters stay tiny (usually under 50 lines) and contain no protocol logic. If you find yourself
re-implementing negotiation or error codes in an adapter, it belongs in the core.

## Adding an implementation

1. **Open an issue** saying what you're adding and that you'll maintain it. This avoids two
   people building the same thing.
2. **Provide the capabilities for your layer** in [spec/CAPABILITIES.md](spec/CAPABILITIES.md),
   and say in your README which ones you cover.
3. **Follow the layout above.** Use the existing implementations in the same role as a reference:
   - composers: `composers/go/core`, `composers/typescript/core`
   - clients: `clients/typescript/core`, with its React binding in `clients/typescript/react`
4. **Provide request-scoped loading** (spec §9): a `load(key, fn)` shared by the layout and
   islands within one request, running under the request's lifetime rather than an island's, and
   ideally a batch loader. Follow the existing cores' APIs (`rc.load` / `cc.Load`).
5. **Pass conformance.**
   - *Composer*: ship a test-only conformance server exposing the `__conformance` screen
     (spec §8.1) and run `conformance/run-against.sh <port> <command>`.
   - *Client*: load `conformance/client/cases.json` in your unit tests (spec §8.2). Typed clients
     must also pass the `typedOnly` cases.
6. **Add CI** in `.github/workflows/<language>.yml`. It must trigger on changes to `spec/**`
   and `conformance/**` as well as your own folder.
7. **Add a README** in your folder covering: install, minimal usage, which protocol versions it
   supports, and how to run its tests.
8. **Add yourself to `.github/CODEOWNERS`** for your folder, and add a row to the
   implementations table in the root README.

Keep dependencies minimal. A core should depend on the language's standard library plus,
at most, its usual JSON library.

## Style

TypeScript and JavaScript are formatted by Prettier and linted by ESLint (`pnpm format`, `pnpm lint`;
CI runs both). Besides the community's recommended rules, the lint asks for code that's easy to
review: braces on every `if`, no nested ternaries, no type or non-null assertions outside tests
(check values with a type guard instead), and one property per line for objects of three or more.
Where TypeScript genuinely can't express something, a commented
`// eslint-disable-next-line` says why.

Go is formatted with gofumpt and goimports and linted with golangci-lint (`.golangci.yml`):
`pnpm go:fix` formats and fixes, `pnpm go:lint` checks (CI runs it). Generated files, fixtures and
manifests are left as they are.

## Changing an npm package

If your change touches a published TypeScript package (see [RELEASING.md](RELEASING.md)), run
`pnpm changeset` and commit the generated file, so the change is versioned and lands in the
changelog. Run `pnpm check-packages` if you changed a package's `package.json`, exports or build.

## Tiers

| Tier          | Meaning                                                                       |
| ------------- | ----------------------------------------------------------------------------- |
| **Core**      | Maintained by the project maintainers. Updated in the same PR as spec changes. |
| **Community** | In this repo, maintained by named owners. Must pass conformance to merge.     |
| **External**  | Lives in its own repo. Listed in the README if its CI runs our conformance suite. |

### Unmaintained policy

When a spec or conformance change lands, community implementations that start failing get an
issue assigned to their owners. If it's still failing after **6 weeks**, the implementation is
marked *unmaintained* in the README, and CI failures for it stop blocking other PRs. Anyone can
adopt it by fixing it and adding themselves to CODEOWNERS.

## Changing the protocol

Every protocol change multiplies across every implementation, so the bar is high:

1. Open an issue describing the problem, not just the solution. Prefer real usage over
   hypotheticals.
2. Prefer additive, optional changes. Both sides already ignore unknown fields (spec §4.3),
   so new optional fields are cheap. Anything else needs a new protocol version.
3. A protocol PR includes: the spec change, new or updated conformance cases, and the change to
   at least the TypeScript and Go reference implementations, so the cases are proven to pass.
4. Community implementations then have the [unmaintained window](#unmaintained-policy) to catch up.

## Versioning and releases

- The **protocol** has an integer version (`protocol: 0`), changed only for breaking changes.
- Each **package** is versioned and released independently, tagged by path, e.g.
  `composers/go/core/v0.3.1` (which is also the form Go modules require).
- Each implementation's README states which protocol versions it supports.
