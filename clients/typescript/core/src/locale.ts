// The language a client asks for (spec §4.7): one BCP 47 tag, sent as `client.locale`. The
// composer answers in the nearest language it has.

/** Language tags from a list or an Accept-Language header, most wanted first ("q=0" means not). */
function preferred(preferences: string | readonly (string | null | undefined)[]): string[] {
  const tags = typeof preferences === "string" ? preferences.split(",") : preferences;
  return tags
    .map((tag, order) => {
      const [range = "", ...params] = (tag ?? "").split(";");
      const q = params.map((p) => /^\s*q=([\d.]+)\s*$/i.exec(p)?.[1]).find(Boolean);
      return {
        tag: range.trim(),
        weight: q === undefined ? 1 : Number(q),
        order,
      };
    })
    .filter(
      (preference) => preference.tag !== "" && preference.tag !== "*" && preference.weight > 0,
    )
    .sort((a, b) => b.weight - a.weight || a.order - b.order)
    .map((preference) => preference.tag);
}

/**
 * The language the person most wants, for `client.locale`: from a device's BCP 47 tags, most
 * wanted first (`["en-GB", "pl"]`), or an Accept-Language header (`"pl-PL,pl;q=0.9"`). `fallback`
 * (English by default) when they don't say.
 */
export function preferredLocale(
  preferences: string | readonly (string | null | undefined)[] | null | undefined,
  fallback = "en",
): string {
  return preferred(preferences ?? [])[0] ?? fallback;
}
