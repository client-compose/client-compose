// The conformance screen and action, served from Fastify under a prefix.
import {
  conformanceActions,
  conformanceScreen,
  createComposer,
  loadCatalog,
} from "@client-compose/composer";
import { conformanceCatalogDir } from "@client-compose/conformance";
import Fastify, { type FastifyRequest } from "fastify";

import { composerPlugin } from "../src/index.ts";

export async function conformanceServer() {
  const composer = createComposer<undefined, FastifyRequest>({
    screens: [conformanceScreen()],
    actions: conformanceActions(),
    strings: { catalog: loadCatalog(conformanceCatalogDir()) },
  });
  const app = Fastify();
  await app.register(composerPlugin(composer), { prefix: "/compose" });
  const address = await app.listen({ port: 0, host: "127.0.0.1" });
  return { baseUrl: `${address}/compose`, close: () => void app.close() };
}
