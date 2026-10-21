import { isIPv4, isIPv6 } from "node:net";

// The caller's address for sign-in throttling. Vercel overwrites both headers
// with the real client address, so a client cannot choose them. Outside Vercel
// (local runs) they are whatever the client sent, which only matters there.
export function clientAddress(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0];
  return normaliseClientAddress(headers.get("x-real-ip") ?? forwarded ?? "");
}

// IPv4 as is. IPv6 by its /64 prefix, because one host usually controls a
// whole /64. The format must match the Go API's auth.ClientAddress exactly:
// four lowercase hex groups without leading zeros, then "::/64".
export function normaliseClientAddress(raw: string): string {
  const address = raw.trim().split("%")[0]!;
  if (isIPv4(address)) return address;
  if (!isIPv6(address)) return "unknown";

  const groups = (part: string | undefined) =>
    part
      ? part.split(":").flatMap((group) => {
          if (!group.includes(".")) return [parseInt(group, 16)];
          const [a, b, c, d] = group.split(".").map(Number) as number[];
          return [a! * 256 + b!, c! * 256 + d!];
        })
      : [];
  const [head, tail] = address.split("::");
  const left = groups(head);
  const right = groups(tail);
  const zeros =
    tail === undefined ? [] : Array(8 - left.length - right.length).fill(0);
  const all = [...left, ...zeros, ...right];
  // IPv4-mapped (::ffff:a.b.c.d, in either notation) is the IPv4 client.
  if (all.slice(0, 5).every((group) => group === 0) && all[5] === 0xffff)
    return [all[6]! >> 8, all[6]! & 255, all[7]! >> 8, all[7]! & 255].join(".");
  return `${all
    .slice(0, 4)
    .map((group) => group.toString(16))
    .join(":")}::/64`;
}
