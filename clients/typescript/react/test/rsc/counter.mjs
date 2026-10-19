"use client";

import { createElement, useState } from "react";

/** A Client Component island with state. */
export function Counter({ start }) {
  const [n, setN] = useState(start);
  return createElement("button", { onClick: () => setN(n + 1) }, `count ${n}`);
}
