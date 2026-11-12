// Thin UCI wrapper around the Stockfish 18 lite (single-threaded) WASM build running in a Web Worker.
// Jobs are serialized; enqueuing a job with a key replaces any pending job with the same key so
// the UI never waits behind stale analysis.

export interface EngineLine {
  uci: string;
  cp?: number; // centipawns from side-to-move perspective
  mate?: number; // moves to mate from side-to-move perspective (negative = getting mated)
  pv: string[];
  depth: number;
}

export interface AnalyseOptions {
  depth?: number;
  movetime?: number;
  multipv?: number;
  skill?: number; // 0..20
  elo?: number; // uses UCI_LimitStrength when >= 1320
}

interface Job {
  key?: string;
  fen: string;
  opts: AnalyseOptions;
  resolve: (lines: EngineLine[]) => void;
  reject: (e: unknown) => void;
}

class Engine {
  private worker: Worker | null = null;
  private ready: Promise<void> | null = null;
  private queue: Job[] = [];
  private running: Job | null = null;
  private lines = new Map<number, EngineLine>();
  private waiters: { match: (s: string) => boolean; fn: () => void }[] = [];

  private start(): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = new Promise((resolve, reject) => {
      try {
        this.worker = new Worker('/engine/stockfish-18-lite-single.js');
      } catch (e) {
        reject(e);
        return;
      }
      this.worker.onmessage = (e) => this.onLine(String(e.data));
      this.worker.onerror = (e) => reject(e);
      this.waitFor((s) => s === 'uciok').then(() => {
        this.send('setoption name Hash value 32');
        this.send('isready');
        return this.waitFor((s) => s === 'readyok');
      }).then(resolve);
      this.send('uci');
    });
    return this.ready;
  }

  private send(cmd: string) {
    this.worker?.postMessage(cmd);
  }

  private waitFor(match: (s: string) => boolean): Promise<void> {
    return new Promise((fn) => this.waiters.push({ match, fn }));
  }

  private onLine(line: string) {
    for (let i = 0; i < this.waiters.length; i++) {
      if (this.waiters[i].match(line)) {
        const w = this.waiters.splice(i, 1)[0];
        w.fn();
        i--;
      }
    }
    if (!this.running) return;
    if (line.startsWith('info') && line.includes(' pv ') && !line.includes('bound')) {
      const t = line.split(' ');
      const get = (k: string) => t[t.indexOf(k) + 1];
      const mpv = t.includes('multipv') ? Number(get('multipv')) : 1;
      const l: EngineLine = { uci: '', pv: t.slice(t.indexOf('pv') + 1), depth: Number(get('depth')) };
      l.uci = l.pv[0];
      if (t.includes('mate')) l.mate = Number(get('mate'));
      else l.cp = Number(get('cp'));
      this.lines.set(mpv, l);
    } else if (line.startsWith('bestmove')) {
      const job = this.running;
      const best = line.split(' ')[1];
      let out = [...this.lines.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1]);
      if (!out.length && best && best !== '(none)') out = [{ uci: best, pv: [best], depth: 0, cp: 0 }];
      // With skill limits the played move may differ from PV #1; put it first.
      if (best && out.length && out[0].uci !== best) {
        const idx = out.findIndex((l) => l.uci === best);
        if (idx > 0) out.unshift(out.splice(idx, 1)[0]);
        else if (idx < 0) out.unshift({ uci: best, pv: [best], depth: 0, cp: out[0].cp, mate: out[0].mate });
      }
      this.running = null;
      job.resolve(out);
      this.pump();
    }
  }

  private pump() {
    if (this.running || !this.queue.length) return;
    const job = this.queue.shift()!;
    this.running = job;
    this.lines.clear();
    const o = job.opts;
    const limit = o.elo !== undefined && o.elo >= 1320;
    this.send('ucinewgame');
    this.send(`setoption name MultiPV value ${o.multipv ?? 1}`);
    this.send(`setoption name UCI_LimitStrength value ${limit}`);
    if (limit) this.send(`setoption name UCI_Elo value ${Math.min(3190, o.elo!)}`);
    this.send(`setoption name Skill Level value ${o.skill ?? 20}`);
    this.send(`position fen ${job.fen}`);
    if (o.movetime) this.send(`go movetime ${o.movetime}${o.depth ? ` depth ${o.depth}` : ''}`);
    else this.send(`go depth ${o.depth ?? 14}`);
  }

  async analyse(fen: string, opts: AnalyseOptions = {}, key?: string): Promise<EngineLine[]> {
    await this.start();
    return new Promise((resolve, reject) => {
      if (key) {
        const i = this.queue.findIndex((j) => j.key === key);
        if (i >= 0) this.queue.splice(i, 1)[0].reject(new Error('superseded'));
        if (this.running?.key === key) this.send('stop');
      }
      this.queue.push({ key, fen, opts, resolve, reject });
      this.pump();
    });
  }
}

export const engine = new Engine();

/** Engine score (side-to-move) → white-perspective centipawns, mate mapped to ±10000. */
export function whiteCp(line: EngineLine | undefined, fen: string): number {
  if (!line) return 0;
  const stm = fen.split(' ')[1] === 'w' ? 1 : -1;
  const raw = line.mate !== undefined ? Math.sign(line.mate || -1) * (10000 - Math.abs(line.mate) * 10) : line.cp ?? 0;
  return raw * stm;
}

/** Win probability (0..100) for a centipawn score, same curve lichess uses for accuracy. */
export function winPct(cp: number): number {
  const c = Math.max(-1500, Math.min(1500, cp));
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * c)) - 1);
}

export function formatScore(cpWhite: number): string {
  if (Math.abs(cpWhite) >= 9000) {
    const n = Math.round((10000 - Math.abs(cpWhite)) / 10);
    return `${cpWhite > 0 ? '' : '-'}M${n}`;
  }
  const v = cpWhite / 100;
  return `${v > 0 ? '+' : ''}${v.toFixed(1)}`;
}
