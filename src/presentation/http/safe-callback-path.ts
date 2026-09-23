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
    return url.origin === "https://callback.invalid"
      ? `${url.pathname}${url.search}${url.hash}`
      : "/";
  } catch {
    return "/";
  }
}
