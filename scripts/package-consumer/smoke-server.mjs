// A conformance server built only from the published packages.
import { createServer } from "node:http";
import { conformanceActions, conformanceScreen, createComposer } from "@client-compose/composer";
import { createRequestListener } from "@client-compose/node-http";

const port = Number(process.argv[2]);
const composer = createComposer({ screens: [conformanceScreen()], actions: conformanceActions() });
createServer(createRequestListener(composer)).listen(port, "127.0.0.1");
