export function securePostgresConnectionString(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Invalid PostgreSQL connection configuration");
  }
  if (!["postgres:", "postgresql:"].includes(url.protocol))
    throw new Error("Invalid PostgreSQL connection configuration");
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    !local ||
    ["prefer", "require", "verify-ca"].includes(
      url.searchParams.get("sslmode") ?? "",
    )
  ) {
    url.searchParams.set("sslmode", "verify-full");
    url.searchParams.delete("uselibpqcompat");
    url.searchParams.delete("ssl");
  }
  return url.toString();
}
