// Islands in stories render as the app renders them: inside Client Compose, with the app strings,
// talking to a fake composer from @client-compose/react/testing, so no composer needs to run. A
// story says how the fake composer answers the actions its island performs:
//
//   decorators: [withComposer({ actions: { "add-todo": () => actionError(AddTodoV1, …) } })]
import { AppStringsProvider, ClientComposeProvider } from "@client-compose/react";
import {
  catalogStrings,
  createTestConfig,
  type FakeGatewayHandlers,
} from "@client-compose/react/testing";
import type { Decorator } from "@storybook/nextjs-vite";

import catalog from "../../strings/en.json";
import { registry } from "../src/registry";

/** The words people see, as the composer sends them: islands' `t`, and the app strings. */
export const english = catalogStrings(catalog);

export function withComposer(handlers: FakeGatewayHandlers = {}): Decorator {
  const { config } = createTestConfig({ registry, handlers });

  return function WithComposer(Story) {
    return (
      <ClientComposeProvider config={config}>
        <AppStringsProvider initial={english.appStrings}>
          <Story />
        </AppStringsProvider>
      </ClientComposeProvider>
    );
  };
}
