// Adapts module sources for React's RSC node-loader, which expects source as a string (Node 24
// passes buffers) and can't follow relative sourceMappingURL comments.
export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  if (result.format !== "module" || result.source == null) return result;
  const source =
    typeof result.source === "string" ? result.source : Buffer.from(result.source).toString("utf8");
  return { ...result, source: source.replace(/^\/\/# sourceMappingURL=.*$/m, "") };
}
