// node:http adapter: POST /screens/{screen} -> composeHttp().

import type { IncomingMessage, RequestListener } from "node:http";
import { composeHttp, type createComposer } from "@client-compose/composer";

export function createRequestListener<Ctx>(
  compose: ReturnType<typeof createComposer<Ctx>>,
  context: (req: IncomingMessage) => Ctx | Promise<Ctx>,
): RequestListener {
  return async (req, res) => {
    const match = req.url?.match(/^\/screens\/([^/?]+)/);
    if (req.method !== "POST" || !match) {
      res.writeHead(404).end();
      return;
    }
    let body = "";
    for await (const chunk of req) body += chunk;
    const result = await composeHttp(compose, decodeURIComponent(match[1]), body, await context(req));
    res.writeHead(result.status, { "content-type": "application/json" }).end(JSON.stringify(result.body));
  };
}
