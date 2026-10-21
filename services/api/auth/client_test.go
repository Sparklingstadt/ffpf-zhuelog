package auth

import "testing"

func TestClientAddress(t *testing.T) {
	cases := []struct{ name, raw, want string }{
		{"ipv4", "203.0.113.9", "203.0.113.9"},
		{"ipv4 with spaces", "  203.0.113.9 ", "203.0.113.9"},
		{"ipv4-mapped ipv6", "::ffff:203.0.113.9", "203.0.113.9"},
		{"ipv4-mapped ipv6 upper case", "::FFFF:203.0.113.9", "203.0.113.9"},
		{"ipv6 compressed", "2001:db8::1", "2001:db8:0:0::/64"},
		{"ipv6 expanded", "2001:0db8:0000:0001:aaaa:0000:0000:0000", "2001:db8:0:1::/64"},
		{"ipv6 trailing compression", "2001:0db8:0000:0001:aaaa::", "2001:db8:0:1::/64"},
		{"ipv6 same /64 differs only in host", "2001:db8:0:1:ffff:ffff:ffff:ffff", "2001:db8:0:1::/64"},
		{"ipv6 upper case", "2001:DB8:ABCD:12::1", "2001:db8:abcd:12::/64"},
		{"ipv6 loopback", "::1", "0:0:0:0::/64"},
		{"ipv6 all zeros", "::", "0:0:0:0::/64"},
		{"ipv6 with embedded ipv4", "64:ff9b::192.0.2.33", "64:ff9b:0:0::/64"},
		{"ipv6 with zone", "fe80::1%eth0", "fe80:0:0:0::/64"},
		{"ipv4 with zone", "192.0.2.7%en0", "192.0.2.7"},
		{"empty", "", "unknown"},
		{"garbage", "not-an-ip", "unknown"},
		{"host and port", "192.0.2.7:5555", "unknown"},
		{"bracketed ipv6", "[2001:db8::1]", "unknown"},
		{"ipv4 with leading zero", "192.0.2.07", "unknown"},
		{"cidr", "2001:db8::/64", "unknown"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := ClientAddress(tc.raw); got != tc.want {
				t.Fatalf("ClientAddress(%q) = %q, want %q", tc.raw, got, tc.want)
			}
		})
	}
}
