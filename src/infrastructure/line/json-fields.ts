// Reads typed fields out of parsed JSON, for the bodies LINE sends. A key
// matches a field whatever its case, a JSON null leaves a field as it was,
// and a value of the wrong type is an error for the whole body.
//
// A field is read from a list of JSON objects, because several keys of one
// object can match one nested field (say "source" and "Source"): together
// they fill that one field.

export type JsonObject = Readonly<Record<string, unknown>>;

// How a key and a field name are folded before they are compared: Unicode
// simple case folding, as far as it can reach ASCII. ASCII letters become
// upper case. The field names read here are ASCII, and the only other
// characters that fold to ASCII are U+017F (long s) to S and U+212A (Kelvin
// sign) to K (the dotted and dotless i do not fold). Every other character
// is kept, so it never matches an ASCII name.
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

// Whether value is a JSON object (not an array, not null).
export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Every value, null included, of the keys that match the field `name`
// case-insensitively, in order.
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

// A nested object field: the objects that fill it (none when absent or null),
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
