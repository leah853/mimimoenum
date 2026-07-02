// Node color + worst-child rollup. Pure functions, no deps. Canonical
// behavior — ported verbatim from the reference module (do NOT re-implement).
//
// Precedence for a LEAF node's color:
//   score present  -> red (<=5), yellow (6-8), green (9+)   [score always wins]
//   no score + has attachment -> 'black'
//   neither -> 'grey'
// A PARENT's displayed color = worst-child rollup: the color of the LOWEST
// score anywhere in its subtree (including its own). Parent still shows its own
// score number separately; only its color rolls up. If no scores exist in the
// subtree, parent is 'black' if any attachment exists below it, else 'grey'.

export type Status = "grey" | "black" | "red" | "yellow" | "green";

export interface TreeNode {
  score: number | null;
  attachmentCount?: number;
  children?: TreeNode[];
}

export function scoreColor(score: number | null): Status | null {
  if (score == null) return null;
  if (score <= 5) return "red";
  if (score <= 8) return "yellow";
  return "green";
}

function hasAttachment(n: TreeNode): boolean {
  return !!(n.attachmentCount && n.attachmentCount > 0);
}

export function ownStatus(n: TreeNode): Status {
  const sc = scoreColor(n.score);
  if (sc) return sc;
  if (hasAttachment(n)) return "black";
  return "grey";
}

function collectScores(n: TreeNode, out: number[]): number[] {
  if (n.score != null) out.push(n.score);
  (n.children ?? []).forEach((c) => collectScores(c, out));
  return out;
}

function anyAttachmentInSubtree(n: TreeNode): boolean {
  if (hasAttachment(n)) return true;
  return (n.children ?? []).some(anyAttachmentInSubtree);
}

export function displayStatus(n: TreeNode): Status {
  if (n.children && n.children.length) {
    const scores = collectScores(n, []);
    if (scores.length) return scoreColor(Math.min(...scores))!;
    return anyAttachmentInSubtree(n) ? "black" : "grey";
  }
  return ownStatus(n);
}

export const STATUS_HEX: Record<Status, string> = {
  grey: "#B4B2A9",
  black: "#2C2C2A",
  red: "#E24B4A",
  yellow: "#EF9F27",
  green: "#639922",
};

export function isRolledUp(n: TreeNode): boolean {
  if (!n.children?.length) return false;
  return ownStatus(n) !== displayStatus(n);
}

export function worstScore(n: TreeNode): number | null {
  const s = collectScores(n, []);
  return s.length ? Math.min(...s) : null;
}
