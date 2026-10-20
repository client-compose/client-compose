// node:http adapter: POST /screens/{screen} -> composeHttp(), POST /actions/{action} -> performHttp().

import type { IncomingMessage, RequestListener } from "node:http";
import { composeHttp, performHttp, type createActions, type createComposer } from "@client-compose/composer";

export interface RequestListenerOptions<Ctx> {
  /** Serve POST /actions/{action} with these actions (from `createActions`). */
  actions?: ReturnType<typeof createActions<Ctx>>;
}

export function createRequestListener<Ctx>(
  compose: ReturnType<typeof createComposer<Ctx>>,
  context: (req: IncomingMessage) => Ctx | Promise<Ctx>,
  options: RequestListenerOptions<Ctx> = {},
): RequestListener {
  return async (req, res) => {
    const match = req.url?.match(/^\/(screens|actions)\/([^/?]+)/);
    if (req.method !== "POST" || !match || (match[1] === "actions" && !options.actions)) {
      res.writeHead(404).end();
      return;
    }
    let body = "";
    for await (const chunk of req) body += chunk;
    const name = decodeURIComponent(match[2]);
    const result =
      match[1] === "screens"
        ? await composeHttp(compose, name, body, await context(req))
        : await performHttp(options.actions!, name, body, await context(req));
    res.writeHead(result.status, { "content-type": "application/json" }).end(JSON.stringify(result.body));
  };
}
