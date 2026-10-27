// The published @client-compose/conformance package carries the shared cases in dist/cases/, and
// the conformance action's manifests in dist/cases/actions/ for implementers to generate types from,
// and the strings catalog conformance servers load in dist/cases/strings/.
import { copyFileSync, mkdirSync, readdirSync } from "node:fs";

const root = new URL("../", import.meta.url);
const out = new URL("conformance/runner/dist/cases/", root);
mkdirSync(new URL("actions/", out), { recursive: true });
mkdirSync(new URL("strings/", out), { recursive: true });
copyFileSync(new URL("conformance/composer/cases.json", root), new URL("composer.json", out));
copyFileSync(new URL("conformance/composer/island-cases.json", root), new URL("islands.json", out));
copyFileSync(new URL("conformance/composer/action-cases.json", root), new URL("actions.json", out));
copyFileSync(
  new URL("conformance/composer/strings-cases.json", root),
  new URL("appStrings.json", out),
);
copyFileSync(new URL("conformance/client/cases.json", root), new URL("client.json", out));
copyFileSync(
  new URL("conformance/client/action-cases.json", root),
  new URL("clientActions.json", out),
);
copyFileSync(new URL("conformance/client/plural-cases.json", root), new URL("plurals.json", out));
copyFileSync(new URL("conformance/client/string-cases.json", root), new URL("strings.json", out));
copyFileSync(new URL("spec/plurals.json", root), new URL("pluralRules.json", out));
for (const dir of ["actions", "strings"]) {
  for (const file of readdirSync(new URL(`conformance/composer/${dir}/`, root))) {
    copyFileSync(
      new URL(`conformance/composer/${dir}/${file}`, root),
      new URL(`${dir}/${file}`, out),
    );
  }
}
