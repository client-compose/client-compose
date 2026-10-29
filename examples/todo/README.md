# Example: todos

The classic todo app, on Client Compose. It has one set of manifests, a composer in each language,
and an app for each client, and any app works with any composer: they share only the protocol and
the manifests.

```
islands/, actions/            the contract: what the composer sends, and what apps can ask it to do
entities/                     what islands show, so actions can say what changed: a todo, the counts
app-strings.json              words outside any island ("Loading…")
screen-strings.json           words the composer uses itself (the screen's title)
strings/                      the words, in English and Polish
client-compose.codegen.json   generates the types below from all of that

composer-go/                  the composer in Go
composer-ts/                  the composer in TypeScript, on Node
tests/                        what every composer must do, checked over HTTP

web/                          React in the browser (Vite)
next/                         Next.js, rendered with Server Components
react-native/                 React Native (Expo)
```

## The contract

One screen, `todos`, with three islands:

| Island | Props | What the app does with it |
| --- | --- | --- |
| `new-todo` v1 | the longest title allowed | a field and an Add button (`add-todo`) |
| `todo-list` v1 | the todos, oldest first | a checkbox (`toggle-todo`) and a Delete button (`delete-todo`) for each |
| `todo-summary` v1 | how many are left, and done | "3 items left", and Clear completed (`clear-completed`) |

The composer leaves the summary out while the list is empty.

Each action says what it changed, as narrowly as it can (spec §5.3), and the apps apply it: none
decides for itself what to refresh.

| Action | What it says changed | What the app does |
| --- | --- | --- |
| Tick a todo | `changes`: that todo, and the counts | changes them in place; nothing is fetched |
| Delete, or clear completed | `changes`: the todos deleted, and the counts | takes them out of the list |
| Add a todo | `update`: the list, since the composer decides where it goes; `changes`: the counts | swaps the list in |
| The first todo, or deleting the last | `invalidate`: the summary appears or goes, so the screen's layout changed | reloads the screen |

The list's todos and the summary are marked with the entities they show (`entities/`), so a change
to a todo reaches whichever islands show it. Each composer's tests check every action with its test
kit (`CheckEffects`, `checkEffects`): applied to the screen as an app would, its effects must match
the screen composed again. The Next.js app renders the screen on the server, so it refreshes it
(`onChanges`, `onInvalidate`) rather than changing it in the browser.

`add-todo` declares two errors, `empty_title` and `title_too_long` (with the limit). The apps check
the title before sending it too, in the same words, but the composer has the final say: an app can
be out of date, and the composer can't.

Every word comes from the composer, in the language the app asks for, so the apps hold none of
their own, except what they say when the composer can't be reached. Ask in Polish (`pl`) and the
summary counts the way Polish does: "Zostało 1 zadanie", "Zostały 2 zadania", "Zostało 5 zadań".
The composer picks each form by CLDR's plural rules; the catalog just lists them.

## Run it

Start one composer. Both serve on `:8080` (set `PORT` to change it), with the same behaviour:

```sh
cd composer-go && go run .         # Go
cd composer-ts && pnpm start       # TypeScript, on Node 24
```

Then start any app. Each finds the composer on `localhost:8080`, or wherever `COMPOSER_URL` says
(`EXPO_PUBLIC_COMPOSER_URL` for React Native):

```sh
cd web && npm install && npm run dev                    # http://localhost:5173
cd next && pnpm install && pnpm dev                     # http://localhost:3000
cd react-native && npm install && npx expo run:ios      # or run:android
```

Your browser's language picks the words. To see the Polish ones, put Polish first in its settings,
or set your device's language for React Native.

The todos are kept in memory, so they're gone when the composer stops, and every app sees the same
list.

## Check a composer

[`tests/`](tests) checks over HTTP what every todo composer must do, with the plain TypeScript
client, so it runs against a composer in any language:

```sh
COMPOSER_URL=http://localhost:8080 pnpm --filter todo-composer-tests test
```

Each composer also has tests of its own, in-process, with its language's test kit:
`go test ./...` in `composer-go`, and `pnpm test` in `composer-ts`.

## Change the contract

Edit the manifests or the catalog, then regenerate every side's types and check the catalog:

```sh
node ../../codegen/cli.ts client-compose.codegen.json
node ../../codegen/cli.ts strings client-compose.codegen.json
```

In your own project, that's `npx @client-compose/codegen`. The apps here use the Client Compose
packages straight from this repository's sources (see each one's bundler config); yours install
them from npm.

## Add one

A composer in another language is done when it passes [`tests/`](tests). An app for another client
(SwiftUI, Jetpack Compose, Vue…) is done when it can add, finish, delete and clear todos against
either composer, in English and Polish. Both are welcome contributions.
