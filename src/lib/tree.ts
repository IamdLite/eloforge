// Opening repertoire trees. Each opening is written as a list of lines in a compact PGN-like
// format: `e4 {comment #e2e4 #g1f3} e5 Nf3`. `#xxyy` tokens inside a comment become arrows.
// Lines sharing a prefix are merged into a tree so drills can branch on the opponent's choices.
import { Chess, type Square } from 'chess.js';

export interface OpeningLineDef {
  name: string;
  pgn: string;
  /** Marks lines where the opponent goes wrong (traps, offbeat moves) */
  trap?: boolean;
}

export interface OpeningDef {
  id: string;
  name: string;
  eco: string;
  side: 'w' | 'b';
  tier: number;
  summary: string;
  ideas: string[];
  inspiredBy?: string;
  /** optional repertoire: not required for the tier exam */
  extra?: boolean;
  lines: OpeningLineDef[];
}

export interface TreeNode {
  san: string;
  uci: string;
  fen: string; // position after the move
  comment: string;
  arrows: [Square, Square][];
  children: TreeNode[];
  lines: number[]; // indexes of lines passing through this node
  ply: number;
}

export interface LinePath {
  index: number;
  name: string;
  trap: boolean;
  nodes: TreeNode[];
}

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

function tokenize(pgn: string): { san: string; comment: string }[] {
  const out: { san: string; comment: string }[] = [];
  const re = /\{([^}]*)\}|([^\s{}]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(pgn))) {
    if (m[1] !== undefined) {
      if (out.length) out[out.length - 1].comment += (out[out.length - 1].comment ? ' ' : '') + m[1].trim();
    } else {
      const tok = m[2].replace(/^\d+\.+/, '');
      if (tok) out.push({ san: tok, comment: '' });
    }
  }
  return out;
}

function splitArrows(text: string): { text: string; arrows: [Square, Square][] } {
  const arrows: [Square, Square][] = [];
  const clean = text.replace(/#([a-h][1-8])([a-h][1-8])/g, (_, a, b) => {
    arrows.push([a, b]);
    return '';
  });
  return { text: clean.replace(/\s+/g, ' ').trim(), arrows };
}

const cache = new Map<string, { root: TreeNode; paths: LinePath[] }>();

export function buildTree(op: OpeningDef): { root: TreeNode; paths: LinePath[] } {
  const hit = cache.get(op.id);
  if (hit) return hit;
  const root: TreeNode = { san: '', uci: '', fen: START_FEN, comment: op.summary, arrows: [], children: [], lines: [], ply: 0 };
  const paths: LinePath[] = [];
  op.lines.forEach((line, li) => {
    const chess = new Chess();
    let node = root;
    node.lines.push(li);
    const nodes: TreeNode[] = [];
    for (const t of tokenize(line.pgn)) {
      let mv;
      try {
        mv = chess.move(t.san);
      } catch {
        throw new Error(`${op.id} line ${li} (${line.name}): illegal move ${t.san}`);
      }
      const { text, arrows } = splitArrows(t.comment);
      let child = node.children.find((c) => c.san === mv.san);
      if (!child) {
        child = { san: mv.san, uci: mv.lan, fen: chess.fen(), comment: text, arrows, children: [], lines: [], ply: node.ply + 1 };
        node.children.push(child);
      } else {
        if (!child.comment && text) child.comment = text;
        if (!child.arrows.length && arrows.length) child.arrows = arrows;
      }
      child.lines.push(li);
      nodes.push(child);
      node = child;
    }
    paths.push({ index: li, name: line.name, trap: !!line.trap, nodes });
  });
  const res = { root, paths };
  cache.set(op.id, res);
  return res;
}

export const lineId = (openingId: string, index: number) => `${openingId}:${index}`;
