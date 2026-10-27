"use client";

import { createElement } from "react";

/** A Client Component island with strings: its `t` is built in the browser. */
export function Greeting({ name, t }) {
  return createElement("p", null, `${t.hello({ name })} ${t.posts({ count: 2 })}`);
}
