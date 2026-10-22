// Fastify adapter. The composer does the work; this registers its two routes.

import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import type { Composer } from "@client-compose/composer";

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
    app.addContentTypeParser("*", { parseAs: "string" }, (_request, body, done) => done(null, body));

    const handler = async (request: FastifyRequest) => {
      const body = typeof request.body === "string" ? request.body : "";
      return (await composer.handle(request.url, body, request))!;
    };
    for (const route of ["/screens/:screen", "/actions/:action"]) {
      app.post(route, async (request, reply) => {
        const result = await handler(request);
        return reply.code(result.status).type("application/json").send(JSON.stringify(result.body));
      });
    }
  };
}
