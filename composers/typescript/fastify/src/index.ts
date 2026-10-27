// Fastify adapter. The composer does the work; this registers its routes.

import { Readable } from "node:stream";

import type { Composer } from "@client-compose/composer";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";

/**
 * Serve a composer from Fastify, as a plugin. Its `context` receives the Fastify request, so what
 * your hooks decorated it with reaches every island and action:
 *
 *     const composer = createComposer<Ctx, FastifyRequest>({
 *       screens,
 *       actions,
 *       context: (request) => ({ viewer: request.user }),
 *     });
 *     await app.register(composerPlugin(composer), { prefix: "/compose" });
 *
 * Inside the plugin, request bodies reach the composer as they were sent, so malformed JSON gets the
 * protocol's own 400 `bad_request`.
 */
export function composerPlugin<Ctx>(composer: Composer<Ctx, FastifyRequest>): FastifyPluginAsync {
  return async (app) => {
    app.removeAllContentTypeParsers();
    app.addContentTypeParser("*", { parseAs: "string" }, (_request, body, done) =>
      done(null, body),
    );

    const handler = async (request: FastifyRequest) => {
      const body = typeof request.body === "string" ? request.body : "";
      const result = await composer.handle(request.url, body, request);
      // Only the composer's own routes are registered, so it always answers them.
      return (
        result ?? {
          status: 404,
          contentType: "application/json" as const,
          body: "null",
        }
      );
    };
    const routes = [
      "/screens/:screen",
      "/screens/:screen/islands/:key",
      "/actions/:action",
      "/strings",
    ];
    for (const route of routes) {
      app.post(route, async (request, reply) => {
        const result = await handler(request);
        reply.code(result.status).type(result.contentType);
        if (typeof result.body === "string") {
          return reply.send(result.body);
        }
        // A screen's stream: each line is sent as it comes (spec §4.6).
        return reply.send(Readable.from(result.body));
      });
    }
  };
}
