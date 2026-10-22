# @client-compose/node-http

`node:http` adapter for the [Client Compose](https://github.com/client-compose/client-compose)
composer. Serves `POST …/screens/{screen}` and `POST …/actions/{action}`, under any prefix.

Tier: **core** · Protocol: **v0** · Node 20+

```sh
npm install @client-compose/composer @client-compose/node-http
```

```ts
import { createServer, type IncomingMessage } from "node:http";
import { createComposer } from "@client-compose/composer";
import { createRequestListener } from "@client-compose/node-http";

const composer = createComposer<Ctx, IncomingMessage>({
  screens,
  actions,
  context: async (req) => ({ viewer: await sessions.viewer(req.headers.cookie) }),
});

createServer(createRequestListener(composer)).listen(8080);
```

`context` receives the `IncomingMessage`. Other paths get 404, and other methods 405.

On a runtime with `fetch`'s `Request` and `Response` (Bun, Deno, Workers, Hono, Next.js), you don't
need an adapter: use `composer.fetch`.
