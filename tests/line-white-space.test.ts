import assert from "node:assert/strict";
import { test } from "node:test";

import { trimWhiteSpace } from "../src/domain/line/white-space";

// Go's unicode.IsSpace, listed by running Go over every rune.
const WHITE_SPACES = [
  0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20, 0x85, 0xa0, 0x1680, 0x2000, 0x2001,
  0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a,
  0x2028, 0x2029, 0x202f, 0x205f, 0x3000,
];

test("trimWhiteSpace strips Unicode White_Space from both ends", () => {
  for (const cp of WHITE_SPACES) {
    const s = String.fromCodePoint(cp);
    assert.equal(
      trimWhiteSpace(`${s}${s}a${s}b${s}${s}`),
      `a${s}b`,
      cp.toString(16),
    );
  }
  assert.equal(trimWhiteSpace("﻿a﻿"), "﻿a﻿");
  assert.equal(trimWhiteSpace("​a᠎"), "​a᠎");
  assert.equal(trimWhiteSpace(" 　 "), "");
  assert.equal(trimWhiteSpace(""), "");
  assert.equal(trimWhiteSpace("😀"), "😀");
});
