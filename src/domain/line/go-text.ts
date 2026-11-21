// Text helpers that behave exactly as Go's, so the web reads LINE texts the
// way services/api did while both share the same rows.

// Go's unicode.IsSpace: the Latin-1 spaces (\t \n \v \f \r, space, U+0085,
// U+00A0) and the other White_Space characters. Not U+FEFF, unlike
// String.prototype.trim.
const GO_SPACE =
  "[\\t\\n\\v\\f\\r \\u0085\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000]";
const GO_SPACE_ENDS = new RegExp(`^${GO_SPACE}+|${GO_SPACE}+$`, "gu");

// Go: strings.TrimSpace. Strips Go's spaces from both ends.
export function goTrimSpace(s: string): string {
  return s.replace(GO_SPACE_ENDS, "");
}
