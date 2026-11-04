/** Word-level diff for the Before / After view of an edited draft (098). Client-safe, no dependencies. */

export type DiffOp = { op: 'same' | 'del' | 'ins'; text: string };

function tokens(s: string): string[] {
  return (s || '').split(/(\s+)/).filter((t) => t.length > 0);
}

/** Longest-common-subsequence diff on whitespace-split tokens. Small inputs only (messages). */
export function diffWords(before: string, after: string): DiffOp[] {
  const a = tokens(before);
  const b = tokens(after);
  const n = a.length;
  const m = b.length;
  if (n * m > 250_000) return [{ op: 'del', text: before }, { op: 'ins', text: after }];
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: DiffOp[] = [];
  const push = (op: DiffOp['op'], text: string) => {
    const last = out[out.length - 1];
    if (last && last.op === op) last.text += text; else out.push({ op, text });
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { push('same', a[i]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { push('del', a[i]); i++; }
    else { push('ins', b[j]); j++; }
  }
  while (i < n) push('del', a[i++]);
  while (j < m) push('ins', b[j++]);
  return out;
}
