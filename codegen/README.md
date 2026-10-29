# @client-compose/codegen

Generates island props types for every stack from the island manifests, so the composer and
every app agree on each island's props by construction rather than by hand.

```sh
npx @client-compose/codegen client-compose.codegen.json            # write
npx @client-compose/codegen client-compose.codegen.json --check    # CI: exit 1 if out of date
npx @client-compose/codegen compat client-compose.codegen.json --base origin/main
                                                                   # CI: exit 1 on breaking changes
npx @client-compose/codegen strings client-compose.codegen.json    # CI: check the strings catalog
```

Go output is formatted with `gofmt` if it's on your PATH. (In this repo, run `node codegen/cli.ts …`
to use the source directly.)

## Install

**With Node 20+:** `npx @client-compose/codegen …`, or add `@client-compose/codegen` as a dev dependency.

**Without Node** (Go, Swift and Kotlin projects): download the standalone `client-compose-codegen`
executable for your platform from the
[codegen releases](https://github.com/client-compose/client-compose/releases?q=%40client-compose%2Fcodegen&expanded=true): `linux-x64`,
`linux-arm64`, `darwin-x64`, `darwin-arm64` or `windows-x64`, with a `SHA256SUMS` file to verify
it. For example, with the GitHub CLI:

```sh
gh release download "@client-compose/codegen@0.2.0" -R client-compose/client-compose \
  -p "client-compose-codegen-darwin-arm64" -p SHA256SUMS
shasum -a 256 --check --ignore-missing SHA256SUMS
chmod +x client-compose-codegen-darwin-arm64 && mv client-compose-codegen-darwin-arm64 /usr/local/bin/client-compose-codegen
```

The binaries take the same arguments as the npm package. They aren't notarised, so on macOS a copy
downloaded through a browser needs `xattr -d com.apple.quarantine <file>` before it will run
(downloads with `gh` or `curl` don't).

## Config

`client-compose.codegen.json` (paths are relative to this file; configure only the targets you use):

```json
{
  "manifests": "islands",
  "actions": "actions",
  "targets": {
    "go": { "out": "composer-go/islands_gen.go", "package": "main" },
    "swift": { "out": "ios/Islands.generated.swift", "access": "internal" },
    "kotlin": { "out": "android/Islands.generated.kt", "package": "com.example.profile" },
    "typescript": { "out": "web/islands.generated.ts", "protocolImport": "@client-compose/protocol" }
  }
}
```

`actions` is optional: a directory of action manifests (spec §5), generated for every target. A
config may also have only `actions`.

For entities (spec §2.1), add `"entities": "entities"`, a directory of entity manifests. See
[Entities](#entities).

For strings (spec §4.7), add `"appStrings": "app-strings.json"` (the app strings manifest),
`"screenStrings": "screen-strings.json"` (each screen's own strings, for Go and TypeScript composers),
`"catalog": "strings"` (the directory of `<locale>.json` files the composer serves) and, if it isn't
`en`, `"defaultLocale"`. See [Strings](#strings).

In a Go project, a `//go:generate client-compose-codegen <config>` (or `npx @client-compose/codegen <config>`) line lets `go generate` run it
(see [`examples/todo/composer-go/main.go`](https://github.com/client-compose/client-compose/blob/main/examples/todo/composer-go/main.go)).

## What you get

For `profile-header` v2, each target generates a `ProfileHeaderV2` type that knows its own
island type and version, so the registration can't name the wrong island:

| Stack      | Generated                                                     | Used as                                                    |
| ---------- | ------------------------------------------------------------- | ---------------------------------------------------------- |
| Go         | `struct` + `IslandType()` / `IslandVersion()` methods         | `cc.Define(func(ctx, r) (ProfileHeaderV2, error) { … })`   |
| Swift      | `struct … : IslandProps, Codable` with nested types and a memberwise `init` | `registry.register(ProfileHeaderV2.self) { props, _ in … }` |
| Kotlin     | `@Serializable data class` + `IslandDescriptor` companion     | `registry.register(ProfileHeaderV2) { props, _ -> … }`     |
| TypeScript | `interface` + descriptor `const` with the same name           | `registry.register(ProfileHeaderV2, (props) => …)`, `island(ProfileHeaderV2, resolve)` |

For action `follow-user` v1 (spec §5.1):

| Stack      | Generated | Used as |
| ---------- | --------- | ------- |
| Go         | `FollowUserV1Input` (tied to its action, version, input schema and result type), `FollowUserV1Result`, and one error type per declared error, e.g. `FollowUserV1Blocked` | `cc.DefineAction(func(ctx, call, in FollowUserV1Input) (FollowUserV1Result, cc.Effects, error) { … })`, returning `FollowUserV1Blocked{}` as the error |
| TypeScript | `FollowUserV1Input`, `FollowUserV1Result`, the `FollowUserV1Error` union, and the `FollowUserV1` descriptor | `action(FollowUserV1, perform)` in the composer, `callAction(…, FollowUserV1, input)` or `useAction(FollowUserV1)` in apps |
| Kotlin     | `object FollowUserV1 : ActionDescriptor<…>` holding `Input`, `Result`, and a sealed `Error` with a subclass per declared error (`Error.Blocked`, or `Error.LimitReached(details)`) | `client.perform(FollowUserV1, FollowUserV1.Input(userId = id))` or `rememberAction(FollowUserV1)` |
| Swift      | `enum FollowUserV1: ActionDescriptor` holding `Input`, `Result`, and a `DeclaredError` enum with a case per declared error (`.blocked`, or `.limitReached(LimitReached)` with its details) | `client.perform(FollowUserV1.self, .init(userId: id))` or `@ComposeAction(FollowUserV1.self)` |

## Entities

An entity names something several islands show, so an action can say what changed about it once
(spec §2.1, §5.3). Each is a manifest in the `entities` directory, and island props mark the objects
that show one with `entity`:

```json
// entities/todo.json
{ "entity": "todo", "id": "id", "properties": { "id": { "type": "string" }, "title": { "type": "string" }, "done": { "type": "boolean" } } }

// in an island's props
"todos": { "type": "array", "items": { "type": "object", "entity": "todo", "required": ["id", "title"], "properties": { … } } }
```

Codegen checks each marked object: it has the entity's id, required, and each of the entity's
properties it shows has the entity's schema for it. It may have properties of its own. `compat`
treats marking or unmarking an object as a breaking change.

| Stack      | Generated | Used as |
| ---------- | --------- | ------- |
| Go         | `TodoEntity`, every property but the id, each optional; `IslandEntities()` on islands that hold entities | `cc.Set("3", TodoEntity{Done: &done})`, `cc.Delete[TodoEntity]("3")` |
| TypeScript | `TodoEntity` and its descriptor; `entities` on island descriptors | `changed(TodoEntity, "3", { done: true })`, `deleted(TodoEntity, "3")`; clients apply changes with the descriptors' `entities` |

Swift and Kotlin don't generate entity types (only composers set them), but their islands carry
their entity paths for clients: `static let islandEntities` in Swift, `override val entities` on the
descriptor in Kotlin.

## Strings

Every word an app shows comes from the composer (spec §4.7). An island manifest declares its
strings by key, with the params each fills in, and `counted` for one whose words depend on a
`count`:

```json
"strings": {
  "heading": { "description": "Over the list." },
  "greeting": { "params": ["name"] },
  "recipeCount": { "params": ["count"], "counted": true }
}
```

The app strings manifest declares the words that belong to no island (a placeholder's "Loading",
a validation message), in the same format: `{ "strings": { … } }`. Each target generates a type
whose members are the strings: text for those without params, functions for those with:

| Stack      | Generated | Used as |
| ---------- | --------- | ------- |
| TypeScript | `RecipeListV1Strings`, and the descriptor's `strings`; `AppStrings` | `props.t.recipeCount({ count })` in a registered component; `useAppStrings(AppStrings).retry` |
| Swift      | `RecipeListV1.Strings`; `struct AppStrings` | `registry.register(RecipeListV1.self) { props, t, _ in … t.recipeCount(count: n) }`; `response.app(AppStrings.self)` |
| Kotlin     | `RecipeListV1.Strings`, built by the descriptor; `class AppStrings` | `registry.register(RecipeListV1) { props, t, _ -> … t.recipeCount(n) }`; `response.app(::AppStrings)` |

The words are a catalog, one file per language, e.g. `strings/pl.json`:

```json
{
  "app": { "retry": "Spróbuj ponownie" },
  "islands": {
    "recipe-list@1": {
      "heading": "Najnowsze",
      "greeting": "Cześć {name}",
      "recipeCount": { "#0": "Brak przepisów", "#one": "{count} przepis", "#few": "{count} przepisy", "#*": "{count} przepisów" }
    }
  }
}
```

A screen's own strings are words its composer uses itself, such as its meta's title. The screen
strings manifest declares them by screen id, `{ "screens": { "creator": { "title": { "params":
["creator"] } } } }`, and the catalog has them under `screens`. Go gets
`CreatorScreenStringsFor(r).Title(name)`; TypeScript, `lc.strings(CreatorScreenStrings).title({
creator })`.

A counted string's variants are keyed `#<number>`, `#<category>` (CLDR's `zero`, `one`, `two`,
`few`, `many`, `other`) or `#*`, chosen in that order. `strings` checks the catalog against the
manifests: the default language must have every string; another that lacks one gets a warning, and
falls back to the default's. Unknown keys and islands, variants without `#*`, variants on a string
that isn't counted, and `{slots}` that aren't params are errors.

## Supported schema subset

Manifests use a deliberately small subset of JSON Schema. Anything outside it is rejected with an
error, so a manifest can never mean different things in different languages.

| Schema                                   | Go                | Swift            | Kotlin           | TypeScript          |
| ---------------------------------------- | ----------------- | ---------------- | ---------------- | ------------------- |
| `string`                                 | `string`          | `String`         | `String`         | `string`            |
| `string`, `format: uri`                  | `string`          | `URL`            | `String`         | `string`            |
| `string`, `enum: [...]`                  | named `string` type + consts | `enum: String` | `enum class` | string union      |
| `integer`                                | `int`             | `Int`            | `Int`            | `number`            |
| `integer`, `format: int64`               | `int64`           | `Int64`          | `Long`           | `number`            |
| `number`                                 | `float64`         | `Double`         | `Double`         | `number`            |
| `boolean`                                | `bool`            | `Bool`           | `Boolean`        | `boolean`           |
| `array` with `items`                     | `[]T`             | `[T]`            | `List<T>`        | `T[]`               |
| `object` with `properties`               | named struct      | nested struct    | nested data class | named interface    |
| `object` with `additionalProperties`     | `map[string]T`    | `[String: T]`    | `Map<String, T>` | `Record<string, T>` |
| not in `required`                        | pointer, or nil slice/map; `omitempty` | `T?` | `T? = null` | `prop?:`   |

Also allowed: `description` (becomes doc comments), `title` (names a nested type), `$comment`,
`examples`. Not supported: `$ref`, `oneOf`/`anyOf`/`allOf`, type unions, `null`, `pattern`,
`minimum` and other validation keywords, formats other than `uri`, `int32` and `int64`.

**Naming.** Nested types are named after their property (`author` → `Author`), or after
`title` if set. Array items without a title get an `Item` suffix and map values a `Value` suffix.
Swift and Kotlin nest them inside the island type (`PostGridV1.Post`); Go and TypeScript
flatten them (`PostGridV1Post`). Property names are camelCased (Go: PascalCased with standard
initialisms, e.g. `avatarUrl` → `AvatarURL`), with the original JSON key preserved.

## Compatibility rules for manifests

Apps and the composer deploy independently, and old app versions stay installed for a long time.
So a change within one island version must keep **both** directions working: old apps decoding the
new composer's payloads, and new apps decoding the old composer's (apps can ship first). Clients skip
islands whose props don't decode (spec §4.4), so a breaking change silently hides the island.

| Change within one island version | Allowed? |
| --- | --- |
| Add an optional property | ✅ |
| Remove an optional property | ✅ old apps already handle it being absent |
| Change `description` or `title`, reorder enum values | ✅ (a `title` change renames generated types, which your compiler will point out) |
| Add a required property | ❌ new apps reject payloads from a composer that doesn't send it yet |
| Remove a required property | ❌ old apps require it |
| Make a property optional, or required | ❌ |
| Change a type, `format`, or integer size | ❌ |
| Add or remove an enum value | ❌ apps can't decode values they don't know |
| Remove an island version | ⚠️ allowed, but apps that only support that version stop receiving the island |

Make breaking changes in a **new island version** (a new `profile-header.v3.json`) and keep the old
version for apps already released.

Strings within one island version, and the app strings, may be added, and their descriptions and
words changed. Removing one, changing its params, or making it counted or not, is breaking: released
apps still show it, with the params they were built with.

Actions follow the same rules (spec §5.1). Released apps keep sending old inputs and decoding
results and error details, so `input`, `result` and each error's `details` follow the table above.
Declared error codes may be added or removed, because clients treat unknown codes as generic
failures. Giving an existing error `details`, or taking them away, is breaking. Removing an action
version only warns: apps still calling it get `unsupported_action_version`.

### Checking it in CI

`compat` compares your manifests with an earlier state and fails on any ❌ change:

```sh
client-compose-codegen compat client-compose.codegen.json --base origin/main   # a git ref
client-compose-codegen compat client-compose.codegen.json --base-dir ./old-islands
```

```text
✖ profile-header v2 · props.badge: became required: new apps would reject payloads from a composer that omits it

1 breaking change(s) in client-compose.codegen.json compared with origin/main.
Put them in a new island version instead (profile-header v3), and keep the old version for apps already released.
```

In GitHub Actions, check out with `fetch-depth: 0` and pass `--base "origin/$GITHUB_BASE_REF"` on pull
requests.

## Tests

[`codegen/test/fixtures/islands`](https://github.com/client-compose/client-compose/tree/main/codegen/test/fixtures/islands) covers every supported
feature. Its generated output is compiled and decoded by tests in Go, Swift, Kotlin and TypeScript.
