// The published @client-compose/conformance package carries the shared cases in dist/cases/.
import { copyFileSync, mkdirSync } from "node:fs";

const root = new URL("../", import.meta.url);
const out = new URL("conformance/runner/dist/cases/", root);
mkdirSync(out, { recursive: true });
for (const suite of ["composer", "client"]) {
  copyFileSync(new URL(`conformance/${suite}/cases.json`, root), new URL(`${suite}.json`, out));
}
