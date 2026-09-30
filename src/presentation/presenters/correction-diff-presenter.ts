export type DiffSegment = {
  kind: "equal" | "delete" | "insert";
  text: string;
};

export type CorrectionDiff = {
  /** Segments of the original text: `equal` and `delete` only. */
  original: DiffSegment[];
  /** Segments of the corrected text: `equal` and `insert` only. */
  corrected: DiffSegment[];
  /** Number of places where the text changed (adjacent edits count once). */
  changeCount: number;
};

type Operation = { kind: DiffSegment["kind"]; char: string };

// The LCS table is (n+1)*(m+1) cells; beyond this the changed middle is shown
// as one replacement instead of spending memory/CPU on rendering a card.
const MAX_TABLE_CELLS = 250_000;

function commonPrefixLength(a: string[], b: string[]) {
  let length = 0;
  while (length < a.length && length < b.length && a[length] === b[length])
    length += 1;
  return length;
}

function commonSuffixLength(a: string[], b: string[], prefix: number) {
  let length = 0;
  while (
    length < a.length - prefix &&
    length < b.length - prefix &&
    a[a.length - 1 - length] === b[b.length - 1 - length]
  )
    length += 1;
  return length;
}

function diffMiddle(a: string[], b: string[]): Operation[] {
  const n = a.length;
  const m = b.length;
  if ((n + 1) * (m + 1) > MAX_TABLE_CELLS) {
    return [
      ...a.map((char) => ({ kind: "delete" as const, char })),
      ...b.map((char) => ({ kind: "insert" as const, char })),
    ];
  }
  // lcs[i * (m + 1) + j] = LCS length of a[i..] and b[j..]. The size limit
  // keeps min(n, m) < 500, so the values fit in 16 bits.
  const width = m + 1;
  const lcs = new Uint16Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      lcs[i * width + j] =
        a[i] === b[j]
          ? lcs[(i + 1) * width + j + 1] + 1
          : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1]);
    }
  }
  const operations: Operation[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      operations.push({ kind: "equal", char: a[i] });
      i += 1;
      j += 1;
    } else if (
      j >= m ||
      (i < n && lcs[(i + 1) * width + j] >= lcs[i * width + j + 1])
    ) {
      operations.push({ kind: "delete", char: a[i] });
      i += 1;
    } else {
      operations.push({ kind: "insert", char: b[j] });
      j += 1;
    }
  }
  return operations;
}

function toSegments(operations: Operation[]) {
  const segments: DiffSegment[] = [];
  for (const { kind, char } of operations) {
    const last = segments.at(-1);
    if (last?.kind === kind) last.text += char;
    else segments.push({ kind, text: char });
  }
  return segments;
}

/** Character-level diff between a learner's sentence and its correction. */
export function diffCorrection(
  originalText: string,
  correctedText: string,
): CorrectionDiff {
  // Array.from splits by code point so surrogate pairs stay intact.
  const a = Array.from(originalText);
  const b = Array.from(correctedText);
  const prefix = commonPrefixLength(a, b);
  const suffix = commonSuffixLength(a, b, prefix);
  const operations: Operation[] = [
    ...a.slice(0, prefix).map((char) => ({ kind: "equal" as const, char })),
    ...diffMiddle(
      a.slice(prefix, a.length - suffix),
      b.slice(prefix, b.length - suffix),
    ),
    ...a
      .slice(a.length - suffix)
      .map((char) => ({ kind: "equal" as const, char })),
  ];

  return {
    original: toSegments(operations.filter((op) => op.kind !== "insert")),
    corrected: toSegments(operations.filter((op) => op.kind !== "delete")),
    // Each run of consecutive edits is one change.
    changeCount: operations.filter(
      (op, index) =>
        op.kind !== "equal" &&
        (index === 0 || operations[index - 1].kind === "equal"),
    ).length,
  };
}
