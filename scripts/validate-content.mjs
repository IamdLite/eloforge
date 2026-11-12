// Validates training content with Stockfish:
//  - every opening line is legal; the learner's moves are close to engine-best; final position is OK
//  - every hand-made puzzle has a unique best move at each step (or a mate)
//  - every endgame has the advertised result
// Usage: node scripts/validate-content.mjs [openings|puzzles|endgames] [comma-separated opening ids]
import { Chess } from 'chess.js';

import { Uci, score, winPct, uciMove } from './uci.mjs';

const { OPENINGS } = await import('../src/data/openings.ts');
const { ENDGAMES } = await import('../src/data/endgames.ts');
const what = process.argv[2] ?? 'all';
const only = process.argv[3]?.split(',');
const uci = new Uci();
await uci.init();
let problems = 0;

const tokens = (pgn) => {
  const out = [];
  const re = /\{([^}]*)\}|([^\s{}]+)/g;
  let m;
  while ((m = re.exec(pgn))) if (m[2]) out.push(m[2].replace(/^\d+\.+/, ''));
  return out;
};

if (what === 'all' || what === 'openings') {
  const cache = new Map();
  const evalFen = async (fen) => {
    if (!cache.has(fen)) cache.set(fen, await uci.analyse(fen, { depth: 14 }));
    return cache.get(fen);
  };
  for (const op of OPENINGS.filter((o) => !only || only.includes(o.id))) {
    for (const [i, line] of op.lines.entries()) {
      const c = new Chess();
      for (const san of tokens(line.pgn)) {
        const fen = c.fen();
        const mover = c.turn();
        let mv;
        try {
          mv = c.move(san);
        } catch {
          console.log(`ILLEGAL ${op.id}#${i} ${line.name}: ${san} at ${fen}`);
          problems++;
          break;
        }
        if (mover !== op.side) continue;
        const best = (await evalFen(fen))[0];
        const after = (await evalFen(c.fen()))[0];
        const bestCp = score(best);
        const playedCp = -score(after);
        const drop = winPct(bestCp) - winPct(playedCp);
        if (drop > 9 && mv.lan !== best.uci) {
          console.log(`WEAK  ${op.id}#${i} ${line.name}: ${mv.san} (best ${best.uci}) drop ${drop.toFixed(1)}% [${bestCp} → ${playedCp}]`);
          problems++;
        }
      }
      const fin = (await evalFen(c.fen()))[0];
      const cp = score(fin) * (c.turn() === op.side ? 1 : -1);
      if (cp < -90) {
        console.log(`END   ${op.id}#${i} ${line.name}: final eval for learner ${cp}`);
        problems++;
      }
    }
    console.log(`ok ${op.id}`);
  }
}

if (what === 'all' || what === 'puzzles') {
  const { CLASSICS: PUZZLES } = await import('../src/data/classic-puzzles.ts');
  for (const p of PUZZLES.filter((x) => x.id.startsWith('c-'))) {
    const c = new Chess(p.fen);
    for (let k = 0; k < p.moves.length; k += 2) {
      const lines = await uci.analyse(c.fen(), { depth: 18, multipv: 2 });
      const [b, s] = lines;
      const mv = c.move(uciMove(p.moves[k]));
      const last = k === p.moves.length - 1;
      if (last && c.isCheckmate()) break;
      if (b.uci !== p.moves[k]) {
        console.log(`PUZ ${p.id}: step ${k} expected ${p.moves[k]} engine ${b.uci} (${score(b)})`);
        problems++;
      } else if (s && b.mate === undefined && winPct(score(b)) - winPct(score(s)) < 20) {
        console.log(`PUZ ${p.id}: step ${k} not unique (${score(b)} vs ${s.uci} ${score(s)})`);
      }
      if (!last) c.move(uciMove(p.moves[k + 1]));
      void mv;
    }
    if (p.themes.some((t) => t.startsWith('mateIn')) && !c.isCheckmate()) {
      console.log(`PUZ ${p.id}: does not end in mate`);
      problems++;
    }
    console.log(`ok ${p.id}`);
  }
}

if (what === 'all' || what === 'endgames') {
  for (const e of ENDGAMES) {
    const l = (await uci.analyse(e.fen, { depth: 20 }))[0];
    const sc = score(l);
    const ok = e.goal === 'draw' ? Math.abs(sc) < 120 || !e.evalCheck : sc > 250 || !e.evalCheck;
    console.log(`${ok ? 'ok' : 'BAD'} endgame ${e.id} ${sc}`);
    if (!ok) problems++;
  }
}

console.log(`\n${problems} problem(s)`);
uci.quit();
