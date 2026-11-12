// Merges generator output into src/data/generated-puzzles.json and spreads ratings over the
// 650–2150 ladder by difficulty rank (the raw heuristic bunches puzzles at the low end).
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';

const seen = new Set();
const all = [];
for (const f of readdirSync('scripts/out').filter((f) => f.endsWith('.json'))) {
  for (const p of JSON.parse(readFileSync(`scripts/out/${f}`, 'utf8'))) {
    const key = p.fen.split(' ').slice(0, 4).join(' ');
    if (seen.has(key)) continue;
    seen.add(key);
    all.push(p);
  }
}

// Difficulty: heuristic rating, plus length of the forced line and quiet/sacrificial first moves.
const difficulty = (p) => p.rating + 60 * p.moves.length + (p.themes.includes('quietMove') ? 80 : 0) - (p.themes.includes('mateIn1') ? 300 : 0);
all.sort((a, b) => difficulty(a) - difficulty(b));
all.forEach((p, i) => {
  p.rating = Math.round((650 + (1500 * i) / Math.max(1, all.length - 1)) / 10) * 10;
});
writeFileSync('src/data/generated-puzzles.json', JSON.stringify(all));
console.log(`${all.length} puzzles, ratings ${all[0]?.rating}–${all.at(-1)?.rating}`);
