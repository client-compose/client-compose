// The todo example's composer, in TypeScript on Node: the screen and actions every todo client uses.
//
//   pnpm start   # serves on :8080; PORT changes it
//
// The words come from ../strings, the catalog every composer serves.
import { createServer, type IncomingMessage } from "node:http";

import { loadCatalog } from "@client-compose/composer";
import { createRequestListener } from "@client-compose/node-http";

import { createTodoComposer } from "./composer.ts";
import { Todos } from "./todos.ts";

const catalog = loadCatalog(new URL("../../strings", import.meta.url).pathname);
const composer = createTodoComposer<IncomingMessage>(new Todos(), catalog);
const port = Number(process.env.PORT ?? 8080);

createServer(createRequestListener(composer)).listen(port, () => {
  console.log(`todo composer (TypeScript) on :${port}`);
});
