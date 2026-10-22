// The published @client-compose/conformance package carries the shared cases in dist/cases/, and
// the conformance action's manifests in dist/cases/actions/ for implementers to generate types from.
import { copyFileSync, mkdirSync, readdirSync } from "node:fs";

const root = new URL("../", import.meta.url);
const out = new URL("conformance/runner/dist/cases/", root);
mkdirSync(new URL("actions/", out), { recursive: true });
copyFileSync(new URL("conformance/composer/cases.json", root), new URL("composer.json", out));
copyFileSync(new URL("conformance/composer/action-cases.json", root), new URL("actions.json", out));
copyFileSync(new URL("conformance/client/cases.json", root), new URL("client.json", out));
for (const file of readdirSync(new URL("conformance/composer/actions/", root))) {
  copyFileSync(
    new URL(`conformance/composer/actions/${file}`, root),
    new URL(`actions/${file}`, out),
  );
}
