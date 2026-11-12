// Turns a move into plain-English commentary: what it does (develops, attacks, forks, pins…)
// and, when engine evals are available, how good it was.
import { Chess, type Color, type Move, type PieceSymbol, type Square } from 'chess.js';
import { NAME, VALUE, fileOf, rankOf, sq } from './analysis';
import { winPct } from './engine';

const CENTER = ['d4', 'e4', 'd5', 'e5'];

export type Verdict = 'brilliant' | 'best' | 'good' | 'inaccuracy' | 'mistake' | 'blunder' | 'book';

export const VERDICT_LABEL: Record<Verdict, { label: string; icon: string; cls: string }> = {
  brilliant: { label: 'Brilliant', icon: '!!', cls: 'v-brilliant' },
  best: { label: 'Best move', icon: '★', cls: 'v-best' },
  good: { label: 'Good', icon: '✓', cls: 'v-good' },
  inaccuracy: { label: 'Inaccuracy', icon: '?!', cls: 'v-inacc' },
  mistake: { label: 'Mistake', icon: '?', cls: 'v-mistake' },
  blunder: { label: 'Blunder', icon: '??', cls: 'v-blunder' },
  book: { label: 'Book move', icon: '📖', cls: 'v-book' },
};

/** Classify by drop in win probability for the mover (both cp values from mover's perspective). */
export function classify(bestCp: number, playedCp: number, wasOnlyMove = false, sacrificed = false): Verdict {
  const drop = winPct(bestCp) - winPct(playedCp);
  if (drop < 2) return sacrificed && playedCp > 150 ? 'brilliant' : wasOnlyMove ? 'brilliant' : 'best';
  if (drop < 6) return 'good';
  if (drop < 12) return 'inaccuracy';
  if (drop < 22) return 'mistake';
  return 'blunder';
}

function rayPin(chess: Chess, from: Square, color: Color): string | null {
  const p = chess.get(from);
  if (!p || !['b', 'r', 'q'].includes(p.type)) return null;
  const dirs: [number, number][] = [];
  if (p.type !== 'b') dirs.push([1, 0], [-1, 0], [0, 1], [0, -1]);
  if (p.type !== 'r') dirs.push([1, 1], [1, -1], [-1, 1], [-1, -1]);
  for (const [df, dr] of dirs) {
    let f = fileOf(from) + df, r = rankOf(from) + dr;
    let first: { sq: Square; type: PieceSymbol } | null = null;
    while (f >= 0 && f < 8 && r >= 0 && r < 8) {
      const s = sq(f, r);
      const q = chess.get(s);
      if (q) {
        if (q.color === color) break;
        if (!first) first = { sq: s, type: q.type };
        else {
          if (VALUE[q.type] > VALUE[first.type] && first.type !== 'k') {
            return q.type === 'k'
              ? `pins the ${NAME[first.type]} on ${first.sq} to the king`
              : `pins the ${NAME[first.type]} on ${first.sq} to the ${NAME[q.type]}`;
          }
          if (first.type === 'k' || (VALUE[first.type] > VALUE[q.type] && first.type !== 'p')) {
            return `skewers the ${NAME[first.type]} — the ${NAME[q.type]} behind it is next`;
          }
          break;
        }
      }
      f += df;
      r += dr;
    }
  }
  return null;
}

/** Feature-based description of a move. `chess` is the position *after* the move. */
export function describeMove(m: Move, chess: Chess): string[] {
  const out: string[] = [];
  const me = m.color;
  const them: Color = me === 'w' ? 'b' : 'w';
  const moveNo = Number(chess.fen().split(' ')[5]);
  const pieces = chess.board().flat().filter((p) => p && p.type !== 'p' && p.type !== 'k').length;
  const opening = moveNo <= 12 && pieces >= 10;

  if (m.san.startsWith('O-O-O')) out.push('Castles queenside: the king hides and the rook jumps to the central d-file.');
  else if (m.san.startsWith('O-O')) out.push('Castles kingside: king to safety and the rooks get connected.');
  if (m.promotion) out.push(`Promotes to a ${NAME[m.promotion]}!`);
  if (m.captured) {
    const trade = VALUE[m.captured] === VALUE[m.piece] ? ' — an even trade' : VALUE[m.captured] > VALUE[m.piece] ? ' — winning material' : '';
    out.push(`Captures the ${NAME[m.captured]} on ${m.to}${trade}.`);
  }
  if (chess.isCheckmate()) {
    out.push('Checkmate!');
    return out;
  }
  if (chess.inCheck()) {
    const k = chess.board().flat().find((p) => p && p.type === 'k' && p.color === them)!.square;
    const checkers = chess.attackers(k, me);
    if (checkers.length > 1) out.push('Double check — the king must move!');
    else if (!checkers.includes(m.to)) out.push('Discovered check: the piece that moved unmasked another attacker.');
    else out.push('Check, forcing a reply.');
  }
  if (opening && !m.captured && (m.piece === 'n' || m.piece === 'b') && (m.from[1] === '1' || m.from[1] === '8')) {
    out.push(`Develops the ${NAME[m.piece]}${m.piece === 'n' && ['c3', 'f3', 'c6', 'f6', 'd2', 'd7', 'e2', 'e7'].includes(m.to) ? ' toward the center' : ''}.`);
  }
  if (m.piece === 'p' && CENTER.includes(m.to) && opening) out.push('Claims the center with a pawn.');
  if (m.piece === 'b' && ['g2', 'b2', 'g7', 'b7'].includes(m.to)) out.push('Fianchetto: the bishop eyes the long diagonal.');
  if (m.piece === 'q' && opening && moveNo <= 6 && !m.captured) out.push('Early queen move — it can become a target for developing moves.');
  if (m.piece === 'r' && !m.captured) {
    const file = m.to[0];
    const pawnsOnFile = chess.board().flat().filter((p) => p && p.type === 'p' && p.square[0] === file);
    if (!pawnsOnFile.length) out.push('Rook to an open file.');
    else if (!pawnsOnFile.some((p) => p!.color === me)) out.push('Rook to a half-open file, pressuring the pawn there.');
  }
  if (m.piece === 'k' && !m.san.startsWith('O') && pieces <= 4) {
    out.push('Activates the king — in the endgame it is a strong piece.');
  }

  // Attacks created by the moved piece.
  const targets: string[] = [];
  let forkCount = 0;
  for (const p of chess.board().flat()) {
    if (!p || p.color !== them || p.type === 'k') continue;
    if (!chess.attackers(p.square, me).includes(m.to)) continue;
    const defended = chess.attackers(p.square, them).length > 0;
    if (VALUE[p.type] > VALUE[m.piece] || !defended) {
      targets.push(`${NAME[p.type]} on ${p.square}`);
      forkCount++;
    }
  }
  if (chess.inCheck()) forkCount++;
  if (forkCount >= 2 && targets.length) out.push(`A fork! It hits ${chess.inCheck() ? 'the king and ' : ''}${targets.join(' and ')}.`);
  else if (targets.length) out.push(`Attacks the ${targets[0]}.`);

  const pin = rayPin(chess, m.to, me);
  if (pin) out.push(`It ${pin}.`);

  // Did the move leave the piece en prise?
  if (m.piece !== 'k') {
    const att = chess.attackers(m.to, them);
    if (att.length) {
      const cheapest = Math.min(...att.map((a) => VALUE[chess.get(a)!.type]));
      const defended = chess.attackers(m.to, me).length > 0;
      if (!defended || cheapest < VALUE[m.piece]) out.push(`Careful: the ${NAME[m.piece]} on ${m.to} can be captured.`);
    }
  }
  if (m.piece === 'p' && !m.promotion && (m.to[1] === (me === 'w' ? '7' : '2'))) out.push('The pawn reaches the 7th rank and threatens to promote!');
  if (!out.length) {
    if (m.piece === 'p') out.push(m.to[1] === '4' || m.to[1] === '5' ? 'Gains space with a pawn.' : 'A quiet pawn move, securing squares.');
    else out.push(`Repositions the ${NAME[m.piece]} to ${m.to}.`);
  }
  return out;
}

export function sanFeatures(fen: string, uci: string): { move: Move; after: Chess } | null {
  const c = new Chess(fen);
  try {
    const move = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || undefined });
    return { move, after: c };
  } catch {
    return null;
  }
}
