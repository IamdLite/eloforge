// Minimal Node UCI client for the Stockfish WASM build (used by content scripts only).
import { spawn } from 'node:child_process';

export class Uci {
  constructor() {
    this.p = spawn(process.execPath, ['node_modules/stockfish/bin/stockfish-18-lite-single.js'], { stdio: ['pipe', 'pipe', 'inherit'] });
    this.buf = '';
    this.listeners = [];
    this.p.stdout.on('data', (d) => {
      this.buf += d.toString();
      let i;
      while ((i = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, i).trim();
        this.buf = this.buf.slice(i + 1);
        for (const l of [...this.listeners]) l(line);
      }
    });
  }

  send(cmd) {
    this.p.stdin.write(cmd + '\n');
  }

  waitFor(pred) {
    return new Promise((res) => {
      const l = (line) => {
        if (pred(line)) {
          this.listeners.splice(this.listeners.indexOf(l), 1);
          res(line);
        }
      };
      this.listeners.push(l);
    });
  }

  async init() {
    this.send('uci');
    await this.waitFor((l) => l === 'uciok');
    this.send('setoption name Hash value 32');
    this.send('isready');
    await this.waitFor((l) => l === 'readyok');
  }

  /** Returns lines sorted by multipv: {uci, cp, mate, pv} from side-to-move perspective. */
  async analyse(fen, { depth = 14, multipv = 1, nodes } = {}) {
    const lines = new Map();
    const l = (line) => {
      if (!line.startsWith('info') || !line.includes(' pv ') || line.includes('bound')) return;
      const t = line.split(' ');
      const get = (k) => t[t.indexOf(k) + 1];
      const m = t.includes('multipv') ? Number(get('multipv')) : 1;
      const pv = t.slice(t.indexOf('pv') + 1);
      const o = { uci: pv[0], pv, depth: Number(get('depth')) };
      if (t.includes('mate')) o.mate = Number(get('mate'));
      else o.cp = Number(get('cp'));
      lines.set(m, o);
    };
    this.listeners.push(l);
    this.send(`setoption name MultiPV value ${multipv}`);
    this.send(`position fen ${fen}`);
    this.send(nodes ? `go nodes ${nodes}` : `go depth ${depth}`);
    const best = await this.waitFor((x) => x.startsWith('bestmove'));
    this.listeners.splice(this.listeners.indexOf(l), 1);
    const out = [...lines.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1]);
    if (!out.length) out.push({ uci: best.split(' ')[1], pv: [], cp: 0 });
    return out;
  }

  quit() {
    this.send('quit');
    setTimeout(() => this.p.kill(), 200);
  }
}

/** Score to a single number (side to move), mate mapped to ±10000. */
export const score = (l) => (l.mate !== undefined ? Math.sign(l.mate || -1) * (10000 - Math.abs(l.mate) * 10) : l.cp);
export const winPct = (cp) => {
  const c = Math.max(-1500, Math.min(1500, cp));
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * c)) - 1);
};
export const uciMove = (u) => ({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
