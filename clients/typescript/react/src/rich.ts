// No hooks or context here, so Server Components can use it too.
import { createElement, Fragment, type ReactNode } from "react";

// Marks where a node goes in the formatted sentence: private-use characters, which no translation
// or plain value holds, so nothing else in the sentence is mistaken for one.
const open = "";
const close = "";
const marked = new RegExp(`(${open}[^${close}]*${close})`);

/** A formatted string, taking any params. */
interface Formatter {
  format(values: Record<string, string | number>): string;
}

/** What a formatted string's params are given: plain values as they are, anything else as a node. */
type RichValues<Values> = { [Name in keyof Values]: Values[Name] | ReactNode };

/**
 * Formats a string with React nodes (links, emphasis) among its params, so a sentence stays whole
 * for translators. Pass the string itself, not its result: plain values (text, numbers, a plural's
 * count) are formatted as usual, and each element goes where its param is, as often as it's used.
 *
 *     richText(t.newHere, { link: <a href="/sign-up">{t.signUp}</a> })
 *     richText(t.saved, { count: 3, list: <a href="/saved">{t.yourList}</a> })
 */
export function richText<Values extends Record<string, string | number>>(
  message: (values: Values) => string,
  values: RichValues<Values>,
): ReactNode[] {
  const nodes = new Map<string, ReactNode>();
  const formatted: Record<string, string | number> = {};
  for (const [name, value] of Object.entries(values)) {
    if (typeof value === "string" || typeof value === "number") {
      formatted[name] = value;
    } else {
      nodes.set(name, value);
      formatted[name] = `${open}${name}${close}`;
    }
  }

  // Each node is keyed by its param (numbered if the sentence uses it more than once).
  const seen = new Map<string, number>();
  // The message is given its own params, each plain value kept and each node marked in its place.
  // (A method's params are checked both ways, so it takes them without a cast.)
  const formatter: Formatter = { format: message };
  const text = formatter.format(formatted);
  return text.split(marked).map((part) => {
    const name = part.startsWith(open) ? part.slice(1, -1) : undefined;
    if (name === undefined || !nodes.has(name)) {
      return part;
    }
    const count = (seen.get(name) ?? 0) + 1;
    seen.set(name, count);
    return createElement(Fragment, { key: `${name}#${count}` }, nodes.get(name));
  });
}
