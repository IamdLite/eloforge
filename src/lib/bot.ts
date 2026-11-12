// A "natural" opponent for playing openings out to checkmate: it plays the kind of moves a human
// at the given rating would choose, and now and then something unexpected.
import { engine, type EngineLine } from './engine';

export const lineScore = (l: EngineLine) => (l.mate !== undefined ? Math.sign(l.mate || -1) * (10000 - Math.abs(l.mate) * 10) : l.cp ?? 0);

export interface NaturalMove {
  uci: string;
  /** set when the move is a deliberate deviation from the obvious one */
  unexpected?: { usual: string };
}

export async function naturalMove(fen: string, elo: number): Promise<NaturalMove> {
  const ls = await engine.analyse(fen, { depth: elo >= 1600 ? 12 : 10, multipv: 5 }, 'natural');
  const top = lineScore(ls[0]);
  // Never miss a forced mate, and always take the only reasonable move.
  if (ls[0].mate !== undefined && ls[0].mate > 0) return { uci: ls[0].uci };
  // How far from best a "natural" move may be: weaker opponents settle for more.
  const margin = elo < 1200 ? 110 : elo < 1500 ? 70 : elo < 1800 ? 45 : 25;
  const natural = ls.filter((l) => top - lineScore(l) <= margin);
  const surpriseRate = elo < 1200 ? 0.16 : elo < 1500 ? 0.11 : elo < 1800 ? 0.07 : 0.04;
  if (Math.random() < surpriseRate) {
    // Plausible but off the beaten path: worse than natural, not a gift.
    const odd = ls.slice(1).filter((l) => top - lineScore(l) > margin && top - lineScore(l) < 350);
    if (odd.length) return { uci: odd[Math.floor(Math.random() * odd.length)].uci, unexpected: { usual: ls[0].uci } };
  }
  const weights = [0.58, 0.24, 0.11, 0.05, 0.02];
  let r = Math.random() * natural.reduce((s, _, i) => s + weights[i], 0);
  for (let i = 0; i < natural.length; i++) {
    r -= weights[i];
    if (r <= 0) return { uci: natural[i].uci };
  }
  return { uci: ls[0].uci };
}
