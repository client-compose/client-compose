// No hooks or context here, so Server Components can use it too.
import { createElement, Fragment, type ReactNode } from "react";

/**
 * Puts React nodes (links, emphasis) into a string, so a sentence stays whole for translators. Each
 * `{name}` in the text becomes `nodes[name]`; other text is kept as is. Fill a string's params with
 * their own placeholders to keep them for richText:
 *
 *     richText(t.newHere({ link: "{link}" }), { link: <a href="/sign-up">{t.signUp}</a> })
 */
export function richText(text: string, nodes: Record<string, ReactNode>): ReactNode[] {
  // Each node is keyed by its placeholder (numbered if the sentence uses it more than once).
  const seen = new Map<string, number>();
  return text.split(/(\{[A-Za-z0-9_]+\})/).map((part) => {
    const name = /^\{([A-Za-z0-9_]+)\}$/.exec(part)?.[1];
    if (name === undefined || !(name in nodes)) {
      return part;
    }
    const count = (seen.get(name) ?? 0) + 1;
    seen.set(name, count);
    return createElement(Fragment, { key: `${name}#${count}` }, nodes[name]);
  });
}
