// Shared client conformance fixtures for actions and effects (spec §5, §8.2).

import assert from "node:assert/strict";
import { test } from "node:test";

import { clientActionCases, type FixtureResponse } from "@client-compose/conformance";
import {
  type ActionDescriptor,
  type ActionEffects,
  type DeclaredError,
  screenRefMatches,
  type ScreenRequest,
} from "@client-compose/protocol";

import { ActionFetchError, callAction, fetchScreen, ScreenFetchError } from "../src/index.ts";

const suite = clientActionCases();
const action: ActionDescriptor<unknown, unknown, DeclaredError> = {
  ...suite.descriptor,
  input: {},
};
const client = { platform: "conformance", appVersion: "0.0.0" };
const baseUrl = "https://composer.test";

const respond = (response: FixtureResponse) => async () =>
  new Response(response.rawBody ?? JSON.stringify(response.body), { status: response.status });

for (const c of suite.requests) {
  test(`request: ${c.name}`, async () => {
    let seen: { url: string; body: unknown } | undefined;
    const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
      seen = { url: String(url), body: JSON.parse(String(init?.body)) };
      return new Response(
        JSON.stringify({
          protocol: 0,
          status: "ok",
          result: {},
        }),
      );
    };
    await callAction(baseUrl, action, c.input, {
      client,
      idempotencyKey: c.idempotencyKey,
      fetch: fetchImpl as typeof fetch,
    });
    assert.equal(seen?.url, `${baseUrl}/${c.expectPath}`);
    assert.deepEqual(seen?.body, c.expectBody);
  });
}

/** The effects a client acts on; others (from newer composers) are ignored. */
const knownEffects = ({ invalidate, navigate }: ActionEffects) => ({
  ...(invalidate !== undefined && { invalidate }),
  ...(navigate !== undefined && { navigate }),
});

for (const c of suite.outcomes) {
  test(`outcome: ${c.name}`, async () => {
    const options = { client, fetch: respond(c.response) as typeof fetch };
    const outcome = await callAction(baseUrl, action, {}, options).then(
      (res) =>
        res.status === "ok"
          ? {
              outcome: "ok",
              result: res.result,
              effects: knownEffects(res.effects ?? {}),
            }
          : {
              outcome: "error",
              code: res.error.code,
              details: res.error.details ?? null,
            },
      (err: unknown) => {
        assert.ok(err instanceof ActionFetchError, String(err));
        return {
          outcome: "failed",
          status: err.status,
          code: err.code ?? null,
        };
      },
    );
    assert.deepEqual(outcome, c.expect);
  });
}

for (const c of suite.screenRefs) {
  test(`screen reference: ${c.name}`, () => {
    assert.equal(screenRefMatches(c.ref, c.screen, c.params), c.matches);
  });
}

for (const c of suite.screenErrors) {
  test(`screen error: ${c.name}`, async () => {
    const request: ScreenRequest = {
      protocol: 0,
      screen: "s",
      client,
      islands: {},
    };
    const err = await fetchScreen(baseUrl, request, {}, respond(c) as typeof fetch).catch(
      (e: unknown) => e,
    );
    assert.ok(err instanceof ScreenFetchError);
    assert.equal(err.code ?? null, c.expectCode);
  });
}
