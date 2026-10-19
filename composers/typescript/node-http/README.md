# @client-compose/node-http

`node:http` adapter for the [Client Compose](https://github.com/client-compose/client-compose)
composer. Serves `POST /screens/{screen}`.

Tier: **core** · Protocol: **v0** · Node 20+

```sh
npm install @client-compose/composer @client-compose/node-http
```

```ts
import { createServer } from "node:http";
import { createRequestListener } from "@client-compose/node-http";
import { compose } from "./composer"; // createComposer([...]) from @client-compose/composer

createServer(
  createRequestListener(compose, async (req) => ({
    user: await authenticate(req.headers.authorization),
    services,
  })),
).listen(8080);
```

The second argument builds the per-request context your islands receive as `ctx`.

For other frameworks, see the adapter recipe in
[`@client-compose/composer`](https://www.npmjs.com/package/@client-compose/composer#serving-it).
