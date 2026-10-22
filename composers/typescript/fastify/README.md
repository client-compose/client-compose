# @client-compose/fastify

Fastify adapter for the [Client Compose](https://github.com/client-compose/client-compose)
composer: a plugin serving `POST …/screens/:screen` and `POST …/actions/:action`.

Tier: **core** · Protocol: **v0** · Fastify 5 · Node 20+

```sh
npm install @client-compose/composer @client-compose/fastify
```

```ts
import Fastify, { type FastifyRequest } from "fastify";
import { createComposer } from "@client-compose/composer";
import { composerPlugin } from "@client-compose/fastify";

const composer = createComposer<Ctx, FastifyRequest>({
  screens,
  actions,
  context: (request) => ({ viewer: request.user }), // whatever your hooks decorated it with
});

const app = Fastify();
await app.register(composerPlugin(composer), { prefix: "/compose" });
```

- `context` receives the Fastify request.
- Inside the plugin, bodies reach the composer as they were sent, so malformed JSON gets the
  protocol's own 400 `bad_request`. Your other routes keep Fastify's usual parsing.
