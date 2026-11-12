// Generates tactics puzzles from engine self-play with injected human-like errors.
// A puzzle is kept only when every solution move is the single clearly-best move (or a mate).
// Usage: node scripts/gen-puzzles.mjs <seed> <minutes>  → scripts/out/puzzles-<seed>.json
import { Chess } from 'chess.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { Uci, score, winPct, uciMove } from './uci.mjs';

const seed = Number(process.argv[2] ?? 1);
const minutes = Number(process.argv[3] ?? 20);
const SKIP_SHORT = Number(process.argv[4] ?? 0); // probability of dropping one-move puzzles
const deadline = Date.now() + minutes * 60_000;
const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };

let s = seed * 9973;
const rng = () => {
  s |= 0; s = (s + 0x6d2b79f5) | 0;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (a) => a[Math.floor(rng() * a.length)];

const uci = new Uci();
await uci.init();
const puzzles = [];
const seen = new Set();

function attackedValuable(chess, square, color) {
  // enemy pieces attacked by the piece on `square`
  const piece = chess.get(square);
  const out = [];
  for (const row of chess.board()) for (const p of row) {
    if (!p || p.color === color) continue;
    const atk = chess.attackers(p.square, color);
    if (!atk.includes(square)) continue;
    const defended = chess.attackers(p.square, p.color).length > 0;
    if (p.type === 'k' || VALUE[p.type] > VALUE[piece.type] || !defended) out.push(p);
  }
  return out;
}

function themes(fen, moves, mate) {
  const t = new Set();
  const c = new Chess(fen);
  const me = c.turn();
  const nonPawn = c.board().flat().filter((p) => p && p.type !== 'p' && p.type !== 'k').length;
  if (nonPawn <= 4) t.add('endgame');
  moves.forEach((u, i) => {
    const before = new Chess(c.fen());
    const m = c.move(uciMove(u));
    if (i % 2 !== 0) return;
    if (m.promotion) t.add(m.promotion === 'q' ? 'promotion' : 'underPromotion');
    if (c.inCheck()) {
      const k = c.board().flat().find((p) => p && p.type === 'k' && p.color !== me).square;
      const checkers = c.attackers(k, me);
      if (checkers.length > 1) t.add('doubleCheck');
      else if (!checkers.includes(m.to)) t.add('discoveredAttack');
    }
    if (!c.isCheckmate() && attackedValuable(c, m.to, me).length >= 2 && m.piece !== 'q') t.add('fork');
    if (i === 0) {
      if (m.captured && before.attackers(m.to, before.turn() === 'w' ? 'b' : 'w').length === 0 && moves.length === 1) t.add('hangingPiece');
      const att = c.attackers(m.to, c.turn());
      const cheapest = Math.min(...att.map((a) => VALUE[c.get(a).type]));
      if (att.length && VALUE[m.piece] > cheapest + (m.captured ? VALUE[m.captured] : 0) && m.piece !== 'k') t.add('sacrifice');
      if (!m.captured && !m.san.includes('+')) t.add('quietMove');
    }
  });
  if (c.isCheckmate()) {
    t.add(`mateIn${mate}`);
    const k = c.board().flat().find((p) => p && p.type === 'k' && p.color === c.turn()).square;
    const last = c.history({ verbose: true }).at(-1);
    if ((k[1] === '1' || k[1] === '8') && (last.piece === 'r' || last.piece === 'q') && last.to[1] === k[1]) t.add('backRankMate');
    if (last.piece === 'n') {
      const ring = c.moves({ square: k }).length === 0;
      if (ring) t.add('smotheredMate');
    }
  }
  if (!t.size || [...t].every((x) => x === 'endgame' || x === 'quietMove')) t.add(mate ? `mateIn${mate}` : 'advantage');
  return [...t];
}

async function buildPuzzle(fen) {
  const deep = await uci.analyse(fen, { depth: 16, multipv: 2 });
  const [b, s2] = deep;
  if (!b || score(b) < 220) return null;
  if (s2 && b.mate === undefined && winPct(score(b)) - winPct(score(s2)) < 22) return null;
  if (s2 && b.mate !== undefined && s2.mate !== undefined && s2.mate > 0) return null;
  const mate = b.mate !== undefined && b.mate > 0 ? b.mate : 0;
  if (b.mate !== undefined && b.mate > 4) return null;
  const c = new Chess(fen);
  const moves = [b.uci];
  c.move(uciMove(b.uci));
  for (let k = 0; k < 6 && !c.isGameOver(); k++) {
    const reply = (await uci.analyse(c.fen(), { depth: 14 }))[0];
    if (!reply?.uci) break;
    const save = c.fen();
    c.move(uciMove(reply.uci));
    if (c.isGameOver()) { c.load(save); break; }
    const d = await uci.analyse(c.fen(), { depth: 16, multipv: 2 });
    const [db, ds] = d;
    let unique;
    if (mate) unique = db.mate !== undefined && db.mate > 0 && !(ds && ds.mate !== undefined && ds.mate > 0 && ds.mate <= db.mate);
    else unique = db.mate === undefined && (!ds || winPct(score(db)) - winPct(score(ds)) >= 22) && score(db) > 150;
    if (!unique) {
      // Mate puzzles may end with several mating moves; accept a final mate-in-1 with alternatives.
      if (mate && db.mate === 1) { moves.push(reply.uci, db.uci); c.move(uciMove(db.uci)); }
      break;
    }
    moves.push(reply.uci, db.uci);
    c.move(uciMove(db.uci));
  }
  if (mate && !c.isCheckmate()) return null;
  // How hard is it to see? Depth at which the engine settles on the first move.
  let stable = 1;
  for (let d = 1; d <= 14; d++) {
    const l = (await uci.analyse(fen, { depth: d }))[0];
    if (l.uci !== b.uci) stable = d + 1;
  }
  const userMoves = Math.ceil(moves.length / 2);
  const th = themes(fen, moves, mate);
  let rating = 520 + 150 * userMoves + 55 * Math.min(stable, 15);
  if (th.includes('quietMove')) rating += 180;
  if (th.includes('sacrifice')) rating += 140;
  if (th.includes('hangingPiece')) rating -= 150;
  if (mate === 1) rating = Math.min(rating, 950);
  rating = Math.max(600, Math.min(2300, Math.round(rating / 10) * 10));
  return { fen, moves, rating, themes: th };
}

let games = 0;
while (Date.now() < deadline) {
  games++;
  const c = new Chess();
  let prevEval = 0; // from side-to-move perspective at the current position
  let lopsided = 0;
  while (!c.isGameOver() && c.history().length < 150 && Date.now() < deadline) {
    const ply = c.history().length;
    let move;
    if (ply < 10) {
      const lines = await uci.analyse(c.fen(), { depth: 7, multipv: 4 });
      const top = score(lines[0]);
      move = pick(lines.filter((l) => score(l) >= top - 70)).uci;
    } else if (rng() < 0.03) {
      move = pick(c.moves({ verbose: true })).lan;
    } else if (rng() < 0.25) {
      // Shallow search misses deeper tactics, the way club players do.
      move = (await uci.analyse(c.fen(), { depth: 1 + Math.floor(rng() * 4) }))[0].uci;
    } else {
      const lines = await uci.analyse(c.fen(), { depth: 8, multipv: 3 });
      const r = rng();
      move = (r < 0.6 ? lines[0] : r < 0.85 ? lines[1] ?? lines[0] : lines[2] ?? lines[0]).uci;
    }
    c.move(uciMove(move));
    if (c.isGameOver()) break;
    const quick = await uci.analyse(c.fen(), { depth: 10 });
    const now = score(quick[0]);
    // Side to move was at -prevEval before the opponent's move; a big swing means a blunder.
    if (now >= 220 && -prevEval <= 120) {
      const fen = c.fen();
      const key = fen.split(' ').slice(0, 4).join(' ');
      if (!seen.has(key)) {
        seen.add(key);
        const p = await buildPuzzle(fen);
        const skip = p && ((p.themes.includes('hangingPiece') && rng() < 0.7) || (p.moves.length === 1 && rng() < SKIP_SHORT));
        if (p && !skip) {
          p.lastMove = move;
          p.id = `g${seed}-${puzzles.length}`;
          puzzles.push(p);
          console.log(seed, puzzles.length, p.rating, p.themes.join(','), p.moves.length);
          mkdirSync('scripts/out', { recursive: true });
          writeFileSync(`scripts/out/puzzles-${seed}.json`, JSON.stringify(puzzles));
        }
      }
    }
    prevEval = now;
    lopsided = Math.abs(now) > 600 ? lopsided + 1 : 0;
    if (lopsided >= 4) break;
  }
}
console.log('games', games, 'puzzles', puzzles.length);
uci.quit();
