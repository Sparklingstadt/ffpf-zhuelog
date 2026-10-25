import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clientAddress,
  normaliseClientAddress,
} from "../src/infrastructure/auth/client-address";

test("client addresses normalise like the Go API's auth.ClientAddress", () => {
  for (const [raw, want] of [
    ["203.0.113.7", "203.0.113.7"],
    [" 203.0.113.7 ", "203.0.113.7"],
    ["::ffff:203.0.113.7", "203.0.113.7"],
    ["::FFFF:203.0.113.7", "203.0.113.7"],
    ["::ffff:cb00:7107", "203.0.113.7"],
    ["0:0:0:0:0:ffff:cb00:7107", "203.0.113.7"],
    // One host usually controls a whole IPv6 /64.
    ["2001:db8:0:1:aaaa::1", "2001:db8:0:1::/64"],
    ["2001:0DB8:0000:0001:ffff:ffff:ffff:ffff", "2001:db8:0:1::/64"],
    ["2001:db8::1", "2001:db8:0:0::/64"],
    ["::1", "0:0:0:0::/64"],
    ["fe80::1%eth0", "fe80:0:0:0::/64"],
    ["1:2:3:4:5:6:1.2.3.4", "1:2:3:4::/64"],
    ["", "unknown"],
    ["not-an-ip", "unknown"],
    ["203.0.113.7:443", "unknown"],
  ] as const)
    assert.equal(normaliseClientAddress(raw), want, raw);
});

test("x-real-ip wins, then the first x-forwarded-for value", () => {
  assert.equal(
    clientAddress(
      new Headers({ "x-real-ip": "203.0.113.7", "x-forwarded-for": "1.1.1.1" }),
    ),
    "203.0.113.7",
  );
  assert.equal(
    clientAddress(new Headers({ "x-forwarded-for": "198.51.100.9, 10.0.0.1" })),
    "198.51.100.9",
  );
  assert.equal(clientAddress(new Headers()), "unknown");
});
