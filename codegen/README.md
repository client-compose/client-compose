# @client-compose/codegen

Generates island props types for every stack from the island manifests, so the composer and
every app agree on each island's props by construction rather than by hand.

```sh
npx @client-compose/codegen client-compose.codegen.json           # write
npx @client-compose/codegen client-compose.codegen.json --check   # CI: exit 1 if out of date
```

Requires Node 20+. Go output is formatted with `gofmt` if it's on your PATH. (In this repo, run
`node codegen/cli.ts …` to use the source directly.)

## Config

`client-compose.codegen.json` (paths are relative to this file; configure only the targets you use):

```json
{
  "manifests": "islands",
  "targets": {
    "go": { "out": "composer-go/islands_gen.go", "package": "main" },
    "swift": { "out": "ios/Islands.generated.swift", "access": "internal" },
    "kotlin": { "out": "android/Islands.generated.kt", "package": "com.example.profile" },
    "typescript": { "out": "web/islands.generated.ts", "protocolImport": "@client-compose/protocol" }
  }
}
```

In a Go project, a `//go:generate npx @client-compose/codegen <config>` line lets `go generate` run it
(see [`examples/profile/composer-go/main.go`](https://github.com/client-compose/client-compose/blob/main/examples/profile/composer-go/main.go)).

## What you get

For `profile-header` v2, each target generates a `ProfileHeaderV2` type that knows its own
island type and version, so the registration can't name the wrong island:

| Stack      | Generated                                                     | Used as                                                    |
| ---------- | ------------------------------------------------------------- | ---------------------------------------------------------- |
| Go         | `struct` + `IslandType()` / `IslandVersion()` methods         | `cc.Define(func(ctx, r) (ProfileHeaderV2, error) { … })`   |
| Swift      | `struct … : IslandProps` with nested types                    | `registry.register(ProfileHeaderV2.self) { props, _ in … }` |
| Kotlin     | `@Serializable data class` + `IslandDescriptor` companion     | `registry.register(ProfileHeaderV2) { props, _ -> … }`     |
| TypeScript | `interface` + descriptor `const` with the same name           | `registry.register(ProfileHeaderV2, (props) => …)`, `defineIsland(ProfileHeaderV2, resolve)` |

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

Clients skip an island whose props don't decode (spec §4.4), so within one island version only
add **optional** properties. Each of these needs a **new version** instead:

- adding a required property, or making an optional one required
- removing, renaming or retyping a property
- **adding an enum value**: older apps can't decode it, so they'd skip the island

## Tests

[`codegen/test/fixtures/islands`](https://github.com/client-compose/client-compose/tree/main/codegen/test/fixtures/islands) covers every supported
feature. Its generated output is compiled and decoded by tests in Go, Swift, Kotlin and TypeScript.
