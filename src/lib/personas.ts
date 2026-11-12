// "What would Magnus / Hikaru do?" hints. Both personas start from the engine's candidate moves
// and choose the one that best fits a playing style: Magnus-inspired = squeeze, prophylaxis,
// improve the worst piece, trade into good endgames; Hikaru-inspired = initiative, forcing moves,
// open lines to the king. In positions with one winning move both simply find it.
import { Chess, type Color } from 'chess.js';
import { VALUE, kingZone, formatLine, pvToSan, uciToMove } from './analysis';
import { describeMove } from './commentary';
import { engine, winPct, type EngineLine } from './engine';

export type Persona = 'magnus' | 'hikaru';

export const PERSONAS: Record<Persona, { name: string; tag: string; color: string; avatar: string; principles: string[] }> = {
  magnus: {
    name: 'Magnus',
    tag: 'Positional squeeze',
    color: '#38bdf8',
    avatar: '🧊',
    principles: [
      'Improve your worst-placed piece before you start any action.',
      'When you are better, trade pieces (not pawns) and grind the endgame.',
      'Ask what your opponent wants to do, then take it away: prophylaxis.',
      'A small, lasting edge beats a speculative attack.',
      'In the endgame the king is a fighting piece: bring it to the center.',
      'Keep the tension and keep asking questions. Opponents crack under long pressure.',
    ],
  },
  hikaru: {
    name: 'Hikaru',
    tag: 'Initiative & attack',
    color: '#f97316',
    avatar: '⚡',
    principles: [
      'Checks, captures, threats: scan them in that order, every move.',
      'Keep the initiative. Every move should force your opponent to react.',
      'With opposite-side castling, throw your pawns at the enemy king.',
      'Open lines toward the king: files and diagonals are highways for your pieces.',
      'Speed matters: forcing moves limit what your opponent can try.',
      'Trust the pattern. You have seen this motif before, so go for it.',
    ],
  },
};

export interface PersonaHint {
  persona: Persona;
  uci: string;
  san: string;
  line: string;
  why: string[];
  principle: string;
  onlyMove: boolean;
}

/** Legal move count for `color` (optionally for one square) as if it were their turn. */
function mobility(fen: string, color: Color, square?: string): number {
  const parts = fen.split(' ');
  parts[1] = color;
  parts[3] = '-';
  try {
    const c = new Chess(parts.join(' '));
    return (square ? c.moves({ square: square as never }) : c.moves()).length;
  } catch {
    return 0;
  }
}

function lineScore(l: EngineLine): number {
  return l.mate !== undefined ? Math.sign(l.mate || -1) * (10000 - Math.abs(l.mate) * 10) : l.cp ?? 0;
}

function styleScore(p: Persona, fen: string, l: EngineLine, bestWp: number): number {
  const c = new Chess(fen);
  const me = c.turn();
  const them: Color = me === 'w' ? 'b' : 'w';
  const pieceMobBefore = c.moves({ square: l.uci.slice(0, 2) as never }).length;
  const oppMobBefore = mobility(fen, them);
  const m = c.move(uciToMove(l.uci));
  const after = c.fen();
  const drop = bestWp - winPct(lineScore(l));
  const pieceMobAfter = mobility(after, me, m.to);
  const oppMobAfter = mobility(after, them);
  const zone = kingZone(c, them);
  const zoneHits = zone.filter((s) => c.attackers(s, me).length).length;
  const nonPawn = c.board().flat().filter((x) => x && x.type !== 'p' && x.type !== 'k').length;
  const ahead = lineScore(l) > 150;
  let s = -drop * 1.6;
  if (p === 'magnus') {
    if (!m.captured && !c.inCheck()) s += 1;
    s += Math.max(0, pieceMobAfter - pieceMobBefore) * 0.25;
    s += Math.max(0, oppMobBefore - oppMobAfter) * 0.2;
    if (ahead && m.captured && VALUE[m.captured] === VALUE[m.piece]) s += 2;
    if (nonPawn <= 6 && m.piece === 'k') s += 1.5;
    if (m.piece === 'p' && !m.captured) s += 0.3;
  } else {
    if (c.inCheck()) s += 2;
    if (m.captured) s += 1.2;
    s += zoneHits * 0.6;
    if (m.piece === 'p' && zone.some((z) => z[0] === m.to[0] || Math.abs(z.charCodeAt(0) - m.to.charCodeAt(0)) === 1)) s += 0.8;
    s += Math.max(0, mobility(after, me) - mobility(fen, me)) * 0.05;
    if (!m.captured && !c.inCheck() && zoneHits === 0) s -= 0.5;
  }
  return s;
}

export async function personaHint(fen: string, persona: Persona, lines?: EngineLine[]): Promise<PersonaHint | null> {
  const ls = lines && lines.length >= 3 ? lines : await engine.analyse(fen, { depth: 14, multipv: 4 }, 'hint');
  if (!ls.length) return null;
  const bestWp = winPct(lineScore(ls[0]));
  const second = ls[1] ? winPct(lineScore(ls[1])) : -100;
  const onlyMove = bestWp - second >= 15;
  const tolerance = persona === 'magnus' ? 6 : 8;
  const candidates = onlyMove ? [ls[0]] : ls.filter((l) => bestWp - winPct(lineScore(l)) <= tolerance);
  let chosen = candidates[0];
  let bestStyle = -Infinity;
  for (const l of candidates) {
    const sc = styleScore(persona, fen, l, bestWp);
    if (sc > bestStyle) {
      bestStyle = sc;
      chosen = l;
    }
  }
  const c = new Chess(fen);
  const mv = c.move(uciToMove(chosen.uci));
  const why = describeMove(mv, c);
  const sans = pvToSan(fen, chosen.pv, 6);
  const P = PERSONAS[persona];
  const principle = pickPrinciple(persona, mv.captured != null, c.inCheck(), mv.piece);
  if (onlyMove) why.unshift('This position has one move that keeps everything together, so calculate it to the end.');
  return { persona, uci: chosen.uci, san: mv.san, line: formatLine(fen, sans), why, principle: `${P.name}-style: ${principle}`, onlyMove };
}

function pickPrinciple(p: Persona, capture: boolean, check: boolean, piece: string): string {
  const pr = PERSONAS[p].principles;
  if (p === 'magnus') {
    if (piece === 'k') return pr[4];
    if (capture) return pr[1];
    return pr[[0, 2, 3, 5][Math.floor(Math.random() * 4)]];
  }
  if (check || capture) return pr[0];
  if (piece === 'p') return pr[2];
  return pr[[1, 3, 4, 5][Math.floor(Math.random() * 4)]];
}
