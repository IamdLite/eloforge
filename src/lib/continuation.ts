// Opening lines extended to checkmate (generated offline by scripts/gen-continuations.mjs).
// A continuation is a small tree: the learner's moves are fixed, and at a few points the opponent
// has more than one natural reply. A "path" is the list of choices taken at those branch points.
import { useEffect, useState } from 'react';
import { Chess, type Square } from 'chess.js';
import { START_FEN, type LinePath } from './tree';
import { describeMove } from './commentary';

export interface Cont {
  /** moves in order, alternating sides */
  m: string[];
  /** the opponent's alternative replies after `m`; absent when the last move of `m` mates */
  v?: Cont[];
}
type ContFile = Record<string, Cont | null>;

const files = import.meta.glob<ContFile>('../data/continuations/*.json', { import: 'default' });
const cache = new Map<string, ContFile | null>();

export async function loadContinuations(opId: string): Promise<ContFile | null> {
  if (cache.has(opId)) return cache.get(opId)!;
  const load = files[`../data/continuations/${opId}.json`];
  const data = load ? await load() : null;
  cache.set(opId, data);
  return data;
}

/** undefined while loading, null when the opening has no generated continuations. */
export function useContinuations(opId: string): ContFile | null | undefined {
  const [data, setData] = useState<ContFile | null | undefined>(() => cache.get(opId));
  useEffect(() => {
    let live = true;
    loadContinuations(opId).then((d) => live && setData(d)).catch(() => live && setData(null));
    return () => {
      live = false;
    };
  }, [opId]);
  return data;
}

/** Every variation as its list of branch choices. */
export function allPaths(c: Cont | null | undefined): number[][] {
  if (!c?.v) return [[]];
  return c.v.flatMap((sub, i) => allPaths(sub).map((rest) => [i, ...rest]));
}

export const pathKey = (choices: number[]) => choices.join('.') || '-';

export interface ScriptPly {
  san: string;
  uci: string;
  from: Square;
  to: Square;
  fen: string;
  /** part of the opening book (as opposed to the play-out to mate) */
  book: boolean;
  comment: string;
  arrows: [Square, Square][];
  /** the opponent's other natural replies at a branch point */
  alts?: string[];
}

/** The whole game for one variation: the book line, then the continuation to checkmate. */
export function buildScript(line: LinePath, cont: Cont | null | undefined, choices: number[]): ScriptPly[] {
  const out: ScriptPly[] = [];
  const chess = new Chess(START_FEN);
  for (const n of line.nodes) {
    const m = chess.move(n.san);
    out.push({ san: m.san, uci: m.lan, from: m.from, to: m.to, fen: chess.fen(), book: true, comment: n.comment || describeMove(m, chess).join(' '), arrows: n.arrows });
  }
  let c = cont;
  let k = 0;
  let alts: string[] | undefined;
  while (c) {
    c.m.forEach((san, i) => {
      const m = chess.move(san);
      out.push({ san: m.san, uci: m.lan, from: m.from, to: m.to, fen: chess.fen(), book: false, comment: describeMove(m, chess).join(' '), arrows: [], ...(i === 0 && alts ? { alts } : {}) });
    });
    if (!c.v) break;
    const pick = Math.min(choices[k++] ?? 0, c.v.length - 1);
    alts = c.v.filter((_, i) => i !== pick).map((x) => x.m[0]);
    c = c.v[pick];
  }
  return out;
}
