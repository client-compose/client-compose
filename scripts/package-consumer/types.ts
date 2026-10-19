// Type-checks the published declaration files under both nodenext and bundler resolution.
import type { ReactNode } from "react";
import { buildRequest, IslandRegistry, plan, ScreenFetchError, type PlannedIsland } from "@client-compose/client";
import { composeHttp, createComposer, defineIsland, defineScreen, type ComposeResult } from "@client-compose/composer";
import { composerCases, type ClientCase } from "@client-compose/conformance";
import { generate, type CodegenConfig } from "@client-compose/codegen";
import { createRequestListener } from "@client-compose/node-http";
import type { IslandDescriptor, ScreenRequest } from "@client-compose/protocol";
import {
  ComposedScreen,
  loadScreen,
  ReactIslandRegistry,
  useScreen,
  type ClientComposeConfig,
  type ScreenResponse,
  type ScreenState,
} from "@client-compose/react";
import { ComposedScreen as ServerComposedScreen } from "@client-compose/react/server";

interface GreetingV1 {
  name: string;
}
const GreetingV1: IslandDescriptor<GreetingV1> = { type: "greeting", version: 1 };

type Ctx = { greet: (id: string) => Promise<string> };
const island = defineIsland<GreetingV1, Ctx>(GreetingV1, async ({ params, ctx }) => ({ name: await ctx.greet(params.id) }));
const compose = createComposer<Ctx>([defineScreen<Ctx>({ id: "home", layout: () => [{ key: "g", island: [island] }] })]);
export const listener = createRequestListener(compose, () => ({ greet: async (id: string) => id }));
export const result: Promise<ComposeResult> = composeHttp(compose, "home", "{}", { greet: async (id: string) => id });

const registry = new IslandRegistry<string>().register(GreetingV1, (props) => props.name.toUpperCase());
export const request: ScreenRequest = buildRequest(registry, "home", { platform: "web", appVersion: "1" });
export const planned = (r: ScreenResponse): PlannedIsland<string>[] => plan(registry, r);
export const isFetchError = (e: unknown): number | undefined => (e instanceof ScreenFetchError ? e.status : undefined);

const reactRegistry = new ReactIslandRegistry().registerComponent(GreetingV1, (props: GreetingV1): ReactNode => props.name);
export const config: ClientComposeConfig = { registry: reactRegistry, baseUrl: "", client: { platform: "web", appVersion: "1" } };
export const screen: () => ScreenState = () => useScreen("home");
export const element = ComposedScreen({ screen: "home" });

export const cases: number = composerCases().length;
export const firstClientCase = (c: ClientCase): string => c.name;
export const codegenConfig: CodegenConfig = { manifests: "islands", targets: { typescript: [{ out: "a.ts" }] } };
export const files = () => generate("client-compose.codegen.json").map((f) => f.path);

// Server rendering and Server Components.
export const seeded = (initialResponse: ScreenResponse) => ComposedScreen({ screen: "home", initialResponse });
export const loaded: Promise<ScreenResponse> = loadScreen(config, "home", { id: "1" });
export const rsc = ServerComposedScreen({ config, screen: "home", fallback: "loading", renderError: () => "oops" });
