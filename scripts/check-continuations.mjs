// Checks the generated continuations: every variation is legal and ends in checkmate by the learner.
// Usage: node scripts/check-continuations.mjs
import { Chess } from 'chess.js';
import { existsSync, readFileSync } from 'node:fs';

const { OPENINGS } = await import('../src/data/openings.ts');
const { buildTree } = await import('../src/lib/tree.ts');

let problems = 0;
let variations = 0;
let longest = 0;
const missing = [];

function walk(chess, cont, side, where, plies) {
  for (const san of cont.m) {
    try {
      chess.move(san);
    } catch {
      console.log(`ILLEGAL ${where}: ${san} at ${chess.fen()}`);
      problems++;
      return;
    }
  }
  plies += cont.m.length;
  if (cont.v) {
    for (const [i, sub] of cont.v.entries()) walk(new Chess(chess.fen()), sub, side, `${where}.${i}`, plies);
    return;
  }
  variations++;
  longest = Math.max(longest, plies);
  if (!chess.isCheckmate() || chess.turn() === side) {
    console.log(`NO MATE ${where}: ends at ${chess.fen()}`);
    problems++;
  }
}

for (const op of OPENINGS) {
  const file = `src/data/continuations/${op.id}.json`;
  if (!existsSync(file)) {
    missing.push(op.id);
    continue;
  }
  const data = JSON.parse(readFileSync(file, 'utf8'));
  for (const path of buildTree(op).paths) {
    const end = new Chess(path.nodes[path.nodes.length - 1].fen);
    const cont = data[path.index];
    if (cont === undefined) {
      console.log(`MISSING ${op.id}#${path.index}`);
      problems++;
    } else if (cont === null) {
      if (!end.isCheckmate()) {
        console.log(`NULL ${op.id}#${path.index} but the book line does not end in mate`);
        problems++;
      }
    } else walk(end, cont, op.side, `${op.id}#${path.index}`, 0);
  }
}
if (missing.length) console.log(`not generated yet: ${missing.join(', ')}`);
console.log(`${variations} variations, longest ${longest} plies after the book, ${problems} problem(s)`);
process.exit(problems || missing.length ? 1 : 0);
