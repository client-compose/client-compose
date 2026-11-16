"use client";

import { createElement } from "react";

import { useIslandStrings } from "../../dist/index.js";
import { CardV1 } from "./card.mjs";

/** A Client Component inside a Server Component island: it builds the island's `t` itself. */
export function Likes({ count }) {
  const t = useIslandStrings(CardV1);
  return createElement("button", null, t.likes({ count }));
}
