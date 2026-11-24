// Text helpers that behave exactly as Go's, so the web reads LINE texts the
// way services/api did while both share the same rows.

// Go's unicode.IsSpace: the Latin-1 spaces (\t \n \v \f \r, space, U+0085,
// U+00A0) and the other White_Space characters. Not U+FEFF, unlike
// String.prototype.trim.
const WHITE_SPACE =
  "[\\t\\n\\v\\f\\r \\u0085\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000]";
const WHITE_SPACE_ENDS = new RegExp(`^${WHITE_SPACE}+|${WHITE_SPACE}+$`, "gu");

// Go: strings.TrimSpace. Strips Go's spaces from both ends.
export function trimWhiteSpace(s: string): string {
  return s.replace(WHITE_SPACE_ENDS, "");
}
