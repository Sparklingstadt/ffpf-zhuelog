export function isSameOriginRequest(request: Request) {
  const url = new URL(request.url);
  const host = request.headers.get("host") ?? url.host;
  const origin = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");
  return (
    origin === `${url.protocol}//${host}` && (!site || site === "same-origin")
  );
}
