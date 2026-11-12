// Static positional analysis used for the strategy overlays: pawn weaknesses, hanging pieces,
// outposts and immediate threats. Pure chess.js, no engine.
import { Chess, type Color, type PieceSymbol, type Square } from 'chess.js';

export const VALUE: Record<PieceSymbol, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };
export const NAME: Record<PieceSymbol, string> = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
const FILES = 'abcdefgh';

export type MarkerKind = 'isolated' | 'doubled' | 'backward' | 'passed' | 'hanging' | 'outpost' | 'kingzone';

export interface Marker {
  square: Square;
  kind: MarkerKind;
  color: Color; // owner of the feature
  note: string;
}

export interface Arrow {
  from: Square;
  to: Square;
  color: string;
  width?: number;
}

export const sq = (file: number, rank: number) => (FILES[file] + (rank + 1)) as Square;
export const fileOf = (s: string) => FILES.indexOf(s[0]);
export const rankOf = (s: string) => Number(s[1]) - 1;

interface PawnInfo { file: number; rank: number; square: Square }

function pawns(chess: Chess, color: Color): PawnInfo[] {
  const out: PawnInfo[] = [];
  chess.board().forEach((row, r) =>
    row.forEach((p, f) => {
      if (p && p.type === 'p' && p.color === color) out.push({ file: f, rank: 7 - r, square: p.square });
    }),
  );
  return out;
}

export function pawnMarkers(chess: Chess): Marker[] {
  const out: Marker[] = [];
  for (const color of ['w', 'b'] as Color[]) {
    const mine = pawns(chess, color);
    const theirs = pawns(chess, color === 'w' ? 'b' : 'w');
    const dir = color === 'w' ? 1 : -1;
    const ahead = (a: number, b: number) => (color === 'w' ? a > b : a < b);
    for (const p of mine) {
      const sameFile = mine.filter((q) => q.file === p.file);
      const neighbours = mine.filter((q) => Math.abs(q.file - p.file) === 1);
      const blockers = theirs.filter((q) => Math.abs(q.file - p.file) <= 1 && ahead(q.rank, p.rank));
      if (!blockers.length) {
        out.push({ square: p.square, kind: 'passed', color, note: 'Passed pawn: no enemy pawn can stop it. Push it, and blockade enemy passers with a knight.' });
        continue;
      }
      if (!neighbours.length) {
        out.push({ square: p.square, kind: 'isolated', color, note: 'Isolated pawn: no friendly pawn on neighbouring files can defend it, and the square in front is a great outpost for the opponent.' });
      } else if (sameFile.length > 1) {
        out.push({ square: p.square, kind: 'doubled', color, note: 'Doubled pawns: two pawns on one file cannot protect each other and are easier to attack.' });
      } else {
        const stopRank = p.rank + dir;
        if (stopRank < 0 || stopRank > 7) continue;
        const supported = neighbours.some((q) => !ahead(q.rank, p.rank));
        const stopAttacked = theirs.some((q) => Math.abs(q.file - p.file) === 1 && q.rank === stopRank + dir);
        if (!supported && stopAttacked) {
          out.push({ square: p.square, kind: 'backward', color, note: 'Backward pawn: its neighbours have advanced, so it cannot be defended by a pawn and cannot safely advance. Pile up on it.' });
        }
      }
    }
  }
  return out;
}

/** Lowest-value attacker of a square by a color, or null. */
function cheapestAttacker(chess: Chess, square: Square, by: Color): PieceSymbol | null {
  let best: PieceSymbol | null = null;
  for (const a of chess.attackers(square, by)) {
    const t = chess.get(a)!.type;
    if (!best || VALUE[t] < VALUE[best]) best = t;
  }
  return best;
}

export function hangingPieces(chess: Chess): Marker[] {
  const out: Marker[] = [];
  chess.board().forEach((row) =>
    row.forEach((p) => {
      if (!p || p.type === 'k') return;
      const enemy: Color = p.color === 'w' ? 'b' : 'w';
      const att = cheapestAttacker(chess, p.square, enemy);
      if (!att) return;
      const defended = chess.attackers(p.square, p.color).length > 0;
      if (!defended) {
        out.push({ square: p.square, kind: 'hanging', color: p.color, note: `The ${NAME[p.type]} on ${p.square} is attacked and undefended.` });
      } else if (VALUE[att] < VALUE[p.type]) {
        out.push({ square: p.square, kind: 'hanging', color: p.color, note: `The ${NAME[p.type]} on ${p.square} can be won: a ${NAME[att]} attacks it.` });
      }
    }),
  );
  return out;
}

/** Squares in the enemy half that no enemy pawn can ever attack and that one of our pawns supports. */
export function outposts(chess: Chess): Marker[] {
  const out: Marker[] = [];
  for (const color of ['w', 'b'] as Color[]) {
    const mine = pawns(chess, color);
    const theirs = pawns(chess, color === 'w' ? 'b' : 'w');
    const ranks = color === 'w' ? [3, 4, 5] : [4, 3, 2];
    for (const r of ranks) {
      for (let f = 1; f <= 6; f++) {
        const s = sq(f, r);
        const occ = chess.get(s);
        if (occ && (occ.color !== color || occ.type === 'p' || occ.type === 'k')) continue;
        const behind = color === 'w' ? -1 : 1;
        const supported = mine.some((p) => Math.abs(p.file - f) === 1 && p.rank === r + behind);
        if (!supported) continue;
        const canBeKicked = theirs.some((p) => Math.abs(p.file - f) === 1 && (color === 'w' ? p.rank > r : p.rank < r));
        if (canBeKicked) continue;
        out.push({ square: s, kind: 'outpost', color, note: `Outpost on ${s}: a pawn supports it and no enemy pawn can chase a piece away. Ideal home for a knight.` });
      }
    }
  }
  return out;
}

/** Arrows from attackers to pieces that are hanging (en prise). */
export function threatArrows(chess: Chess, hanging: Marker[]): Arrow[] {
  const arrows: Arrow[] = [];
  for (const m of hanging) {
    const enemy: Color = m.color === 'w' ? 'b' : 'w';
    const atk = chess.attackers(m.square, enemy);
    let from: Square | null = null;
    for (const a of atk) if (!from || VALUE[chess.get(a)!.type] < VALUE[chess.get(from)!.type]) from = a;
    if (from) arrows.push({ from, to: m.square, color: 'rgba(239,68,68,0.85)' });
  }
  return arrows;
}

export function kingSquare(chess: Chess, color: Color): Square | null {
  for (const row of chess.board()) for (const p of row) if (p && p.type === 'k' && p.color === color) return p.square;
  return null;
}

export function kingZone(chess: Chess, color: Color): Square[] {
  const k = kingSquare(chess, color);
  if (!k) return [];
  const f = fileOf(k), r = rankOf(k);
  const out: Square[] = [];
  for (let df = -1; df <= 1; df++) for (let dr = -1; dr <= 1; dr++) {
    const nf = f + df, nr = r + dr;
    if (nf >= 0 && nf < 8 && nr >= 0 && nr < 8) out.push(sq(nf, nr));
  }
  return out;
}

/** King-zone squares attacked by the enemy (danger signal for king safety overlay). */
export function kingDanger(chess: Chess): Marker[] {
  const out: Marker[] = [];
  for (const color of ['w', 'b'] as Color[]) {
    const enemy: Color = color === 'w' ? 'b' : 'w';
    for (const s of kingZone(chess, color)) {
      if (chess.attackers(s, enemy).length) out.push({ square: s, kind: 'kingzone', color, note: `${s} next to the ${color === 'w' ? 'white' : 'black'} king is under fire.` });
    }
  }
  return out;
}

export interface OverlayOptions {
  pawns: boolean;
  hanging: boolean;
  outposts: boolean;
  king: boolean;
}

export function computeOverlay(fen: string, o: OverlayOptions) {
  const chess = new Chess(fen);
  const markers: Marker[] = [];
  const arrows: Arrow[] = [];
  if (o.pawns) markers.push(...pawnMarkers(chess));
  if (o.hanging) {
    const h = hangingPieces(chess);
    markers.push(...h);
    arrows.push(...threatArrows(chess, h));
  }
  if (o.outposts) markers.push(...outposts(chess));
  if (o.king) markers.push(...kingDanger(chess));
  return { markers, arrows };
}

export function uciToMove(uci: string) {
  return { from: uci.slice(0, 2) as Square, to: uci.slice(2, 4) as Square, promotion: (uci[4] as PieceSymbol | undefined) };
}

/** Convert a UCI PV to SAN strings (stops at the first illegal move). */
export function pvToSan(fen: string, pv: string[], max = 8): string[] {
  const c = new Chess(fen);
  const out: string[] = [];
  for (const u of pv.slice(0, max)) {
    try {
      out.push(c.move(uciToMove(u)).san);
    } catch {
      break;
    }
  }
  return out;
}

/** Format SAN list with move numbers starting at fen's move. */
export function formatLine(fen: string, sans: string[]): string {
  const parts = fen.split(' ');
  let n = Number(parts[5]);
  let white = parts[1] === 'w';
  const out: string[] = [];
  sans.forEach((s, i) => {
    if (white) out.push(`${n}.${s}`);
    else out.push(i === 0 ? `${n}...${s}` : s);
    if (!white) n++;
    white = !white;
  });
  return out.join(' ');
}

export function materialBalance(chess: Chess): number {
  let s = 0;
  for (const row of chess.board()) for (const p of row) if (p && p.type !== 'k') s += (p.color === 'w' ? 1 : -1) * VALUE[p.type];
  return s;
}
