export function getSafeCallbackPath(value: unknown) {
  if (typeof value !== "string" || value.length > 2000) return "/";
  try {
    const decoded = decodeURIComponent(value);
    if (
      !decoded.startsWith("/") ||
      decoded.startsWith("//") ||
      /[\\\u0000-\u001f\u007f]/.test(decoded)
    )
      return "/";
    const url = new URL(value, "https://callback.invalid");
    // Parsing drops dot segments, so "/.//host" comes out as "//host", which
    // a browser reads as another site: check the path that is returned too.
    if (url.origin !== "https://callback.invalid") return "/";
    if (url.pathname.startsWith("//")) return "/";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}
