import assert from "node:assert/strict";
import { test } from "node:test";

import { goTrimSpace } from "../src/domain/line/go-text";

// Go's unicode.IsSpace, listed by running Go over every rune.
const GO_SPACES = [
  0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20, 0x85, 0xa0, 0x1680, 0x2000, 0x2001,
  0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a,
  0x2028, 0x2029, 0x202f, 0x205f, 0x3000,
];

test("goTrimSpace is Go's strings.TrimSpace", () => {
  for (const cp of GO_SPACES) {
    const s = String.fromCodePoint(cp);
    assert.equal(
      goTrimSpace(`${s}${s}a${s}b${s}${s}`),
      `a${s}b`,
      cp.toString(16),
    );
  }
  assert.equal(goTrimSpace("﻿a﻿"), "﻿a﻿");
  assert.equal(goTrimSpace("​a᠎"), "​a᠎");
  assert.equal(goTrimSpace(" 　 "), "");
  assert.equal(goTrimSpace(""), "");
  assert.equal(goTrimSpace("😀"), "😀");
});
