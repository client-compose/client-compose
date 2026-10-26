// Express adapter. The composer does the work; this hands it the body and writes the response.

import { type Composer, matchRoute, PROTOCOL_VERSION } from "@client-compose/composer";
import type { ErrorRequestHandler, NextFunction, Request, RequestHandler, Response } from "express";

/**
 * Serve a composer from Express. Its `context` receives the Express request, so what your
 * middleware put there (a session, `req.user`) reaches every island and action:
 *
 *     const composer = createComposer<Ctx, express.Request>({
 *       screens,
 *       actions,
 *       context: (req) => ({ viewer: req.user }),
 *     });
 *     app.use("/compose", composerHandler(composer));
 *
 * Requests whose path doesn't end in /screens/{screen} or /actions/{action} go to the next handler.
 * It works with or without `express.json()` in front of it: if that parser rejects a composer
 * request's body, the app gets the protocol's 400 `bad_request` rather than Express's error page.
 */
export function composerHandler<Ctx>(
  composer: Composer<Ctx, Request>,
): [RequestHandler, ErrorRequestHandler] {
  const handle = async (req: Request, res: Response, next: NextFunction) => {
    if (!matchRoute(req.originalUrl)) {
      next();
      return;
    }
    if (req.method !== "POST") {
      res.status(405).set("allow", "POST").end();
      return;
    }
    try {
      const result = await composer.handle(req.originalUrl, await rawBody(req), req);
      if (!result) {
        next();
        return;
      }
      res.status(result.status).json(result.body);
    } catch (err) {
      next(err);
    }
  };
  const badBody: ErrorRequestHandler = (err, req, res, next) => {
    if (matchRoute(req.originalUrl) && isParseError(err)) {
      res.status(400).json({
        protocol: PROTOCOL_VERSION,
        error: { code: "bad_request", message: "Body is not valid JSON" },
      });
      return;
    }
    next(err);
  };
  return [handle, badBody];
}

/** body-parser's error for a body it couldn't parse. */
const isParseError = (err: unknown) =>
  typeof err === "object" && err !== null && "type" in err && err.type === "entity.parse.failed";

async function rawBody(req: Request): Promise<string> {
  // A body parser in front of us has already read the stream.
  if (typeof req.body === "string") {
    return req.body;
  }
  if (req.body !== undefined && req.readableEnded) {
    return JSON.stringify(req.body);
  }
  let body = "";
  for await (const chunk of req) {
    body += chunk;
  }
  return body;
}
