// React Server Components, end to end with React's own RSC renderer: the built package renders a
// screen on the server (react-server conditions, "use client" modules as client references), and the
// payload is server-rendered to HTML the way a framework does on first load.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

function run(command: string, args: string[], input?: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: [input ? "pipe" : "ignore", "pipe", "pipe"] });
    if (input) {
      input.pipe(child.stdin!);
    }
    let out = "";
    let err = "";
    child.stdout!.on("data", (d) => (out += d));
    child.stderr!.on("data", (d) => (err += d));
    child.on("close", (code) =>
      code === 0 ? resolve(out) : reject(new Error(`${args.join(" ")} exited ${code}:\n${err}`)),
    );
  });
}

async function renderRsc(mode?: string) {
  const server = spawn(
    process.execPath,
    [
      "--conditions",
      "react-server",
      "--import",
      here("rsc/register-loader.mjs"),
      here("rsc/render-server.mjs"),
      ...(mode ? [mode] : []),
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let serverErr = "";
  server.stderr.on("data", (d) => (serverErr += d));
  const serverExit = new Promise<number | null>((resolve) => server.on("close", resolve));
  const output = await run(process.execPath, [here("rsc/render-client.mjs")], server.stdout);
  assert.equal(await serverExit, 0, `RSC render failed:\n${serverErr}`);
  return JSON.parse(output) as { html: string; errors: string[] };
}

test("renders a screen in React Server Components", async () => {
  // Test the built output, i.e. what's published.
  execFileSync("pnpm", ["exec", "tsc", "-b", here("../tsconfig.build.json")], { stdio: "inherit" });
  const { html, errors } = await renderRsc();

  // Server Component islands (including async ones) render to HTML on the server.
  assert.match(html, /<h1>Ada<\/h1>/);
  // Client Component islands are server-rendered too, ready to hydrate.
  assert.match(html, /<button>count 1<\/button>/);
  // A crashing island renders as nothing; the rest of the screen is unaffected, in order.
  assert.doesNotMatch(html, /loading/);
  assert.ok(html.indexOf("<h1>Ada</h1>") < html.indexOf("<button>"), "islands keep their order");
  assert.deepEqual(errors, ["broken island"]);
});

test("renders a response passed in instead of fetching", async () => {
  execFileSync("pnpm", ["exec", "tsc", "-b", here("../tsconfig.build.json")], { stdio: "inherit" });
  const { html } = await renderRsc("preloaded");
  assert.match(html, /<h1>Ada<\/h1>/);
  assert.match(html, /<button>count 1<\/button>/);
});

test("streams an island pending in the screen's head: its placeholder first, then the island", async () => {
  execFileSync("pnpm", ["exec", "tsc", "-b", here("../tsconfig.build.json")], { stdio: "inherit" });
  const payload = await run(process.execPath, [
    "--conditions",
    "react-server",
    "--import",
    here("rsc/register-loader.mjs"),
    here("rsc/render-server.mjs"),
    "streaming",
  ]);
  // The placeholder goes out with the rest of the screen; the counter follows once it's arrived.
  assert.ok(payload.includes("counting…"), "the placeholder is in the payload");
  assert.ok(
    payload.indexOf("counting…") < payload.indexOf('"start":1'),
    "the placeholder comes before the island",
  );
  const { html } = await renderRsc("streaming");
  assert.match(html, /<h1>Ada<\/h1>/);
  assert.match(html, /<button>count 1<\/button>/);
  assert.ok(html.indexOf("<h1>Ada</h1>") < html.indexOf("<button>"), "islands keep their order");
});

test("streams each island in as soon as it arrives, even below one still on its way", async () => {
  execFileSync("pnpm", ["exec", "tsc", "-b", here("../tsconfig.build.json")], { stdio: "inherit" });
  const payload = await run(process.execPath, [
    "--conditions",
    "react-server",
    "--import",
    here("rsc/register-loader.mjs"),
    here("rsc/render-server.mjs"),
    "out-of-order",
  ]);
  // The counter, below the header, arrives first, and isn't held back for it.
  assert.ok(payload.includes('"start":1') && payload.includes("Ada"));
  assert.ok(payload.indexOf('"start":1') < payload.indexOf("Ada"), "the counter isn't held back");
  const { html } = await renderRsc("out-of-order");
  assert.ok(html.indexOf("<h1>Ada</h1>") < html.indexOf("<button>"), "islands keep their order");
});
