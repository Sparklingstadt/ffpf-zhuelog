// Reads parsed JSON the way Go's encoding/json fills a struct, for the LINE
// bodies Go read with json.Unmarshal (services/api/line).
//
// A struct is read from a list of JSON objects: Go decodes every key that
// names a field into the same struct, so two keys for one nested struct
// (say "source" and "Source") fill one struct together.

export type JsonObject = Readonly<Record<string, unknown>>;

// Go's foldName (encoding/json/fold.go): ASCII upper case, and for other
// runes the smallest rune of its unicode.SimpleFold orbit. The field names
// read here are ASCII, and the only other runes that fold to ASCII are U+017F
// (long s) to S and U+212A (Kelvin sign) to K (checked against Go 1.27; the
// dotted and dotless i do not fold). Every other rune is kept, so it never
// matches an ASCII name.
const FOLDED_TO_ASCII = new Map<number, string>([
  [0x017f, "S"],
  [0x212a, "K"],
]);

function foldName(name: string): string {
  let out = "";
  for (const c of name) {
    const code = c.codePointAt(0) ?? 0;
    out +=
      code >= 0x61 && code <= 0x7a
        ? c.toUpperCase()
        : (FOLDED_TO_ASCII.get(code) ?? c);
  }
  return out;
}

// Whether value is what Go decodes into a struct: an object (not an array).
export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Every value, null included, that Go would decode into the struct field
// `name`, in order: the keys that match it case-insensitively (Go's fold).
export function fieldValues(
  objects: readonly JsonObject[],
  name: string,
): unknown[] {
  const wanted = foldName(name);
  const values: unknown[] = [];
  for (const object of objects)
    for (const [key, value] of Object.entries(object))
      if (foldName(key) === wanted) values.push(value);
  return values;
}

// A string field: the last value (a JSON null leaves it as it was), "" when
// there is none, and null (a decode error) when any value is not a string.
export function stringField(
  objects: readonly JsonObject[],
  name: string,
): string | null {
  let out = "";
  for (const value of fieldValues(objects, name)) {
    if (value === null) continue;
    if (typeof value !== "string") return null;
    out = value;
  }
  return out;
}

// A nested struct field: the objects that fill it (none when absent or null),
// or null (a decode error) when any value is not an object.
export function objectField(
  objects: readonly JsonObject[],
  name: string,
): JsonObject[] | null {
  const out: JsonObject[] = [];
  for (const value of fieldValues(objects, name)) {
    if (value === null) continue;
    if (!isJsonObject(value)) return null;
    out.push(value);
  }
  return out;
}
