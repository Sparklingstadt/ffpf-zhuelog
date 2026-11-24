// Trimming by Unicode's White_Space property, which is not the set
// String.prototype.trim strips. LINE texts already saved were trimmed this way.

// The White_Space characters: the Latin-1 spaces (\t \n \v \f \r, space,
// U+0085, U+00A0) and the others. U+0085 is one and U+FEFF is not, the
// opposite of String.prototype.trim.
const WHITE_SPACE =
  "[\\t\\n\\v\\f\\r \\u0085\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000]";
const WHITE_SPACE_ENDS = new RegExp(`^${WHITE_SPACE}+|${WHITE_SPACE}+$`, "gu");

// Strips White_Space characters from both ends.
export function trimWhiteSpace(s: string): string {
  return s.replace(WHITE_SPACE_ENDS, "");
}
