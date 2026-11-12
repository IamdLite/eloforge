// Copies the single-threaded lite Stockfish build into public/ so it can run as a Web Worker.
// The copied files are committed, so builds without the (large, optional) package still work.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';

const src = 'node_modules/stockfish/bin/';
const dest = 'public/engine/';
if (!existsSync(src)) {
  console.log('stockfish package not installed; using committed engine files');
  process.exit(0);
}
mkdirSync(dest, { recursive: true });
for (const f of ['stockfish-18-lite-single.js', 'stockfish-18-lite-single.wasm']) {
  copyFileSync(src + f, dest + f);
}
console.log('engine copied');
