package auth

import (
	"net/netip"
	"strconv"
	"strings"
)

// ClientAddress normalises a caller's IP address into the form used in
// sign-in throttle keys: IPv4 (including IPv4-mapped IPv6) as dotted decimal,
// and IPv6 by its /64 prefix, because one host usually controls a whole /64.
// Anything unparsable is "unknown".
//
// The format must match the web's normaliseClientAddress exactly, since both
// write the same SignInThrottle keys: four lowercase hex groups without
// leading zeros, then "::/64" (for example "2001:db8:0:1::/64"). That is why
// it is built by hand rather than with netip.Prefix.String, which compresses
// zero groups.
func ClientAddress(raw string) string {
	raw = strings.TrimSpace(raw)
	if i := strings.IndexByte(raw, '%'); i >= 0 {
		raw = raw[:i] // drop the zone, like the web
	}
	addr, err := netip.ParseAddr(raw)
	if err != nil {
		return "unknown"
	}
	addr = addr.Unmap()
	if addr.Is4() {
		return addr.String()
	}
	b := addr.As16()
	var sb strings.Builder
	for i := 0; i < 8; i += 2 {
		if i > 0 {
			sb.WriteByte(':')
		}
		sb.WriteString(strconv.FormatUint(uint64(b[i])<<8|uint64(b[i+1]), 16))
	}
	sb.WriteString("::/64")
	return sb.String()
}
