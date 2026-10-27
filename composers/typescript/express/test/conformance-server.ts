// The conformance screen and action, served from Express under a prefix, with or without
// express.json() in front.
import type { AddressInfo } from "node:net";

import {
  conformanceActions,
  conformanceScreen,
  createComposer,
  loadCatalog,
} from "@client-compose/composer";
import { conformanceCatalogDir } from "@client-compose/conformance";
import express from "express";

import { composerHandler } from "../src/index.ts";

export async function conformanceServer(options: { json: boolean }) {
  const composer = createComposer<undefined, express.Request>({
    screens: [conformanceScreen()],
    actions: conformanceActions(),
    strings: { catalog: loadCatalog(conformanceCatalogDir()) },
  });
  const app = express();
  if (options.json) {
    app.use(express.json());
  }
  app.use("/compose", composerHandler(composer));
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  return {
    baseUrl: `http://localhost:${(server.address() as AddressInfo).port}/compose`,
    close: () => void server.close(),
  };
}
