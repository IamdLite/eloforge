// Checkmate finishers: each opening family ends the game with its own animation.
import { OPENINGS } from '../data/openings';
import { buildTree } from './tree';

export type FinisherId = 'inferno' | 'glacier' | 'thunder' | 'vortex' | 'blade' | 'meteor' | 'venom' | 'quake';

export const FINISHERS: Record<FinisherId, { name: string; icon: string; color: string; tagline: string }> = {
  inferno: { name: 'INFERNO', icon: '🔥', color: '#f97316', tagline: 'Open games burn hot: the king is reduced to ash.' },
  glacier: { name: 'DEEP FREEZE', icon: '🧊', color: '#7dd3fc', tagline: 'Solid defenses turn cold-blooded: the king freezes and shatters.' },
  thunder: { name: 'THUNDERSTRIKE', icon: '⚡', color: '#facc15', tagline: 'Sicilian sharpness: lightning from a clear sky.' },
  vortex: { name: 'EVENT HORIZON', icon: '🌀', color: '#a855f7', tagline: 'Hypermodern gravity: the king is pulled into the void.' },
  blade: { name: 'SYSTEM CUT', icon: '⚔️', color: '#e2e8f0', tagline: 'Systematic openings, surgical finish: one clean slash.' },
  meteor: { name: 'METEOR CRASH', icon: '☄️', color: '#fb923c', tagline: 'Early aggression ends with a crater.' },
  venom: { name: 'VENOM', icon: '🐍', color: '#4ade80', tagline: 'Slow poison from a closed position: the king melts.' },
  quake: { name: 'EARTHSHATTER', icon: '💥', color: '#d97706', tagline: 'The board itself breaks under the king.' },
};

export const OPENING_FINISHER: Record<string, FinisherId> = {
  italian: 'inferno',
  'ruy-lopez': 'inferno',
  scotch: 'inferno',
  'early-queen': 'meteor',
  scandinavian: 'meteor',
  london: 'blade',
  catalan: 'blade',
  'queens-gambit': 'blade',
  'caro-kann': 'glacier',
  qgd: 'glacier',
  berlin: 'glacier',
  najdorf: 'thunder',
  'open-sicilian': 'thunder',
  kid: 'vortex',
  grunfeld: 'vortex',
  french: 'venom',
  nimzo: 'venom',
};

const ALL = Object.keys(FINISHERS) as FinisherId[];

/** Opening whose repertoire tree matches the most opening moves of a game (needs ≥ 2 plies). */
export function detectOpening(sans: string[]): string | null {
  let best: string | null = null;
  let depth = 1;
  for (const o of OPENINGS) {
    let node = buildTree(o).root;
    let d = 0;
    for (const s of sans) {
      const next = node.children.find((c) => c.san === s);
      if (!next) break;
      node = next;
      d++;
    }
    if (d > depth) {
      depth = d;
      best = o.id;
    }
  }
  return best;
}

/** Finisher for an opening; without one, pick deterministically from a seed so it varies. */
export function finisherFor(openingId?: string | null, seed = ''): FinisherId {
  if (openingId && OPENING_FINISHER[openingId]) return OPENING_FINISHER[openingId];
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return seed ? ALL[Math.abs(h) % ALL.length] : 'quake';
}
