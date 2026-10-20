// Type-checks the published declaration files under both nodenext and bundler resolution.
import type { ReactNode } from "react";
import { buildRequest, callAction, IslandRegistry, plan, ScreenFetchError, type PlannedIsland } from "@client-compose/client";
import {
  composeHttp,
  createActions,
  createComposer,
  defineAction,
  ForbiddenError,
  performHttp,
  UnauthenticatedError,
  type PerformResult,
  defineBatchLoader,
  defineIsland,
  defineScreen,
  LoadNotFoundError,
  type ComposeResult,
  type LayoutContext,
} from "@client-compose/composer";
import { composerCases, type ClientCase } from "@client-compose/conformance";
import { generate, type CodegenConfig } from "@client-compose/codegen";
import { createRequestListener } from "@client-compose/node-http";
import type { ActionDescriptor, IslandDescriptor, ScreenRequest } from "@client-compose/protocol";
import {
  ActionFetchError,
  ComposedScreen,
  type ActionRequest as ReactActionRequest,
  loadScreen,
  ReactIslandRegistry,
  useAction,
  useScreen,
  type ActionResult,
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

// Request-scoped loading.
const nameById = defineBatchLoader(async (ids: string[]) => new Map(ids.map((id) => [id, `user ${id}`])), { maxBatchSize: 50 });
const greeting = (rc: LayoutContext<Ctx>, id: string) => rc.load(`greet:${id}`, () => rc.ctx.greet(id));
export const loadingIsland = defineIsland<GreetingV1, Ctx>(GreetingV1, async (rc) => ({
  name: `${await greeting(rc, rc.params.id)} / ${await nameById.load(rc, rc.params.id)}`,
}));
export const notFound = (e: unknown): boolean => e instanceof LoadNotFoundError;

// Actions.
type RenameError = { code: "taken"; details: { suggestion: string } };
const RenameV1: ActionDescriptor<{ name: string }, { id: string }, RenameError> = {
  action: "rename",
  version: 1,
  errors: ["taken"],
  input: { type: "object" },
};
export const renameAction = defineAction<{ name: string }, { id: string }, RenameError, Ctx>(RenameV1, async ({ name }, { ctx }) =>
  name === "taken" ? { error: { code: "taken", details: { suggestion: await ctx.greet(name) } } } : { result: { id: name } },
);
export const perform = createActions<Ctx>([renameAction]);
export const performed: Promise<PerformResult> = performHttp(perform, "rename", "{}", { greet: async (id: string) => id });
export const listenerWithActions = createRequestListener(compose, () => ({ greet: async (id: string) => id }), { actions: perform });
export const called = async (): Promise<string | undefined> => {
  const res = await callAction("", RenameV1, { name: "x" }, { client: { platform: "web", appVersion: "1" } });
  return res.status === "ok" ? res.result.id : res.error.details.suggestion;
};
export const useRename = (): ((name: string) => Promise<ActionResult<{ id: string }, RenameError>>) => {
  const rename = useAction(RenameV1);
  return (name) => rename.run({ name });
};
export const unauthenticated = (e: unknown): boolean => e instanceof ActionFetchError && e.code === "unauthenticated";
export const viaServer: ClientComposeConfig["performAction"] = async (request: ReactActionRequest) => {
  throw new Error(request.action);
};
export const notAllowed = () => new ForbiddenError() instanceof Error && new UnauthenticatedError() instanceof Error;
