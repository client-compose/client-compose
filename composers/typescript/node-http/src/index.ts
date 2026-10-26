// node:http adapter. The composer does the work; this reads the body and writes the response.

import type { IncomingMessage, RequestListener } from "node:http";

import { type Composer, matchRoute } from "@client-compose/composer";

/**
 * Serve a composer with node:http. Its `context` receives the IncomingMessage:
 *
 *     const composer = createComposer<Ctx, IncomingMessage>({
 *       screens,
 *       context: (req) => ({ viewer: viewerFrom(req.headers.authorization) }),
 *     });
 *     createServer(createRequestListener(composer)).listen(4000);
 *
 * Paths ending in /screens/{screen} and /actions/{action} are the composer's, under any prefix.
 */
export function createRequestListener<Ctx>(
  composer: Composer<Ctx, IncomingMessage>,
): RequestListener {
  return async (req, res) => {
    const path = req.url ?? "/";
    if (!matchRoute(path)) {
      res.writeHead(404).end();
      return;
    }
    if (req.method !== "POST") {
      res.writeHead(405, { allow: "POST" }).end();
      return;
    }
    let body = "";
    for await (const chunk of req) {
      body += chunk;
    }
    const result = await composer.handle(path, body, req);
    if (!result) {
      res.writeHead(404).end();
      return;
    }
    res
      .writeHead(result.status, { "content-type": "application/json" })
      .end(JSON.stringify(result.body));
  };
}
