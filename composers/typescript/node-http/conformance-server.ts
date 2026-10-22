// Test-only server exposing the `__conformance` screen and `conformance` action (spec §8.1).
//   node composers/typescript/node-http/conformance-server.ts [port]

import { createServer, type IncomingMessage } from "node:http";

import { conformanceActions, conformanceScreen, createComposer } from "@client-compose/composer";

import { createRequestListener } from "./src/index.ts";

export function conformanceServer() {
  const composer = createComposer<undefined, IncomingMessage>({
    screens: [conformanceScreen()],
    actions: conformanceActions(),
  });
  return createServer(createRequestListener(composer));
}

if (import.meta.main) {
  const port = Number(process.argv[2] ?? 4100);
  conformanceServer().listen(port, () =>
    console.log(`conformance server on http://localhost:${port}`),
  );
}
