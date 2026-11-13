// Extends every opening line to checkmate, for the "play it to mate" training stages.
// The learner side plays Stockfish's choice; the opponent plays "natural" moves a club player
// would pick (good-looking but not perfect), and at up to two points the tree branches into a
// second natural reply, so each line ends up with up to three variations, each ending in mate.
// Output: src/data/continuations/<opening>.json = { [lineIndex]: Cont | null }
//   Cont = { m: SAN[] (alternating sides, starting from the end of the book line), v?: Cont[] }
//   `v` lists the opponent's alternatives right after `m`; without `v` the last move of `m` mates.
// Usage: node scripts/gen-continuations.mjs [shard/total] [comma-separated opening ids] [--force]
import { Chess } from 'chess.js';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

import { Uci, score } from './uci.mjs';

const { OPENINGS } = await import('../src/data/openings.ts');
const { buildTree } = await import('../src/lib/tree.ts');

const [shard, total] = (process.argv[2] ?? '1/1').split('/').map(Number);
const only = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3].split(',') : null;
const force = process.argv.includes('--force');
const OUT = 'src/data/continuations';
mkdirSync(OUT, { recursive: true });

const uci = new Uci();
await uci.init();

const MAX_PLIES = 150;
const MAX_LEN = 44; // plies after the book line, longest variation

const toSan = (chess, u) => chess.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }).san;

/** Opponent candidates: the natural moves (close to best), best first. */
async function candidates(fen, margin) {
  const ls = await uci.analyse(fen, { nodes: 150000, multipv: 5 });
  const top = score(ls[0]);
  // A player who is already lost cracks more easily.
  const m = top < -300 ? margin * 3 : margin;
  return { ls: ls.filter((l) => top - score(l) <= m), top };
}

async function extend(chess, learner, margin, branches, depth = 0) {
  const m = [];
  let oppMoves = 0;
  for (;;) {
    if (chess.isCheckmate()) return { m };
    if (chess.isGameOver() || m.length + depth > MAX_PLIES) throw new Error(`no mate (${chess.fen()})`);
    const fen = chess.fen();
    if (chess.turn() === learner) {
      const [best] = await uci.analyse(fen, { nodes: 300000 });
      m.push(toSan(chess, best.uci));
      continue;
    }
    oppMoves++;
    const { ls, top } = await candidates(fen, margin);
    // Branch early, where the opponent has two genuinely different natural replies.
    if (branches > 0 && oppMoves <= 10 && ls.length >= 2 && top > -400 && (oppMoves > 1 || depth === 0)) {
      const v = [];
      for (const [i, l] of ls.slice(0, 2).entries()) {
        const c = new Chess(fen);
        const san = toSan(c, l.uci);
        const sub = await extend(c, learner, margin, i === 0 ? branches - 1 : 0, depth + m.length + 1);
        v.push({ m: [san, ...sub.m], ...(sub.v ? { v: sub.v } : {}) });
      }
      return { m, v };
    }
    // The opponent drifts with the "natural" inaccuracy: the weakest move that still looks plausible.
    m.push(toSan(chess, ls[ls.length - 1].uci));
  }
}

const leaves = (c) => (c.v ? c.v.reduce((s, x) => s + leaves(x), 0) : 1);
const longest = (c) => c.m.length + (c.v ? Math.max(...c.v.map(longest)) : 0);

const mine = OPENINGS.filter((o, i) => (only ? only.includes(o.id) : i % total === shard - 1));
for (const op of mine) {
  const file = `${OUT}/${op.id}.json`;
  if (existsSync(file) && !force) continue;
  const out = {};
  const t0 = Date.now();
  for (const path of buildTree(op).paths) {
    const end = path.nodes[path.nodes.length - 1].fen;
    const chess = new Chess(end);
    if (chess.isCheckmate()) {
      out[path.index] = null;
      continue;
    }
    // Weaker tiers get sloppier opponents, so games finish sooner.
    let margin = op.tier <= 1200 ? 150 : op.tier <= 1600 ? 110 : 80;
    // Keep the line memorable: retry with a sloppier opponent while a variation runs too long.
    let bestTree = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const c = await extend(new Chess(end), op.side, margin, 2);
        if (!bestTree || longest(c) < longest(bestTree)) bestTree = c;
        if (longest(c) <= MAX_LEN) break;
      } catch (e) {
        if (attempt === 3 && !bestTree) throw new Error(`${op.id}#${path.index}: ${e.message}`);
      }
      margin = Math.round(margin * 1.6);
    }
    out[path.index] = bestTree;
    const c = out[path.index];
    console.log(`${op.id}#${path.index} ${path.name}: ${leaves(c)} variations, longest ${longest(c)} plies (margin ${margin})`);
  }
  writeFileSync(file, JSON.stringify(out));
  console.log(`== ${op.id} done in ${Math.round((Date.now() - t0) / 1000)}s`);
}
uci.quit();
