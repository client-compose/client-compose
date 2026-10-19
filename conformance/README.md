# Conformance

Language-neutral test suites every implementation must pass (spec §8).

| Suite                | Who runs it   | How                                                                 |
| -------------------- | ------------- | ------------------------------------------------------------------- |
| `composer/cases.json` | Composers     | Over HTTP against a test-only conformance server: `run-against.sh <port> <command…>` |
| `client/cases.json`   | Clients       | Loaded by each client's own unit tests                              |

The composer runner needs Node, and nothing from the implementation's language. Outside this repo,
use the published runner (Node 20+):

```sh
npx @client-compose/conformance composer http://localhost:4100
```

In this repo (Node 24+, runs from source):

```sh
conformance/run-against.sh 4100 go run ./composers/go/core/cmd/conformance-server -addr :4100
# or against something already running:
node conformance/runner/cli.ts composer http://localhost:4100
```

Adding a case: add it to the JSON, then make sure every core implementation passes it in the
same PR (see CONTRIBUTING.md, "Changing the protocol").
