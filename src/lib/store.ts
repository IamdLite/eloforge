// Persistent progress: XP, daily streak (with freezes), puzzle rating, spaced-repetition mastery
// for opening lines, endgame clears, badges and tier promotions. Stored in localStorage.
import { useSyncExternalStore } from 'react';
import { BADGES, TIERS } from './levels';
import type { OverlayOptions } from './analysis';
import { OPENINGS } from '../data/openings';
import { ENDGAMES } from '../data/endgames';
import { buildTree, lineId } from './tree';

export interface Reward {
  kind: 'tier' | 'badge' | 'streak';
  title: string;
  subtitle: string;
  icon: string;
  theme?: string;
  xp?: number;
}

/**
 * Mastery of one line, in three stages: 1 = played through guided, 2 = replayed from memory,
 * 3 (MASTERED) = a random variation played to mate with at most EXAM_MISTAKES mistakes.
 */
export interface LineStat {
  lvl: number;
  reps: number;
  last: number;
  due: number;
  /** branch choices of the last guided run, replayed in stage 2 */
  path?: number[];
  /** variations already played through (pathKey) */
  seen?: string[];
}

export interface Progress {
  v: 1;
  xp: number;
  tier: number;
  puzzleRating: number;
  puzzleCount: number;
  combo: number;
  bestCombo: number;
  streak: { count: number; best: number; lastDay: string; freezes: number };
  activity: Record<string, number>;
  puzzles: Record<string, { ok: number; fail: number; last: number }>;
  lines: Record<string, LineStat>;
  endgames: Record<string, { clears: number; clean: number }>;
  strategy: Record<string, number>;
  badges: Record<string, number>;
  theme: string;
  themes: string[];
  mates: number;
  games: { played: number; won: number };
  rewards: Reward[];
  settings: { overlays: OverlayOptions; coach: boolean; sound: boolean; fx?: boolean; voice?: boolean };
  /** local fighter profile for friend battles (nothing leaves the device except to the friend you play) */
  profile?: Fighter;
  battles?: { played: number; won: number; lost: number; drawn: number };
  friends?: Record<string, Fighter & { w: number; l: number; d: number; last: number }>;
}

export interface Fighter {
  uid: string;
  name: string;
  avatar: string;
}

const KEY = 'eloforge-progress-v1';
export const MASTERED = 3;
/** Mistakes (wrong moves, peeks, hints) the final exam forgives. */
export const EXAM_MISTAKES = 5;
const REVIEW_AFTER = 7 * 86400e3;

const fresh = (): Progress => ({
  v: 1,
  xp: 0,
  tier: 0,
  puzzleRating: 900,
  puzzleCount: 0,
  combo: 0,
  bestCombo: 0,
  streak: { count: 0, best: 0, lastDay: '', freezes: 0 },
  activity: {},
  puzzles: {},
  lines: {},
  endgames: {},
  strategy: {},
  badges: {},
  theme: 'slate',
  themes: ['slate'],
  mates: 0,
  games: { played: 0, won: 0 },
  rewards: [],
  settings: { overlays: { pawns: false, hanging: true, outposts: false, king: false }, coach: true, sound: true, fx: true },
});

function load(): Progress {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...fresh(), ...JSON.parse(raw) };
  } catch {
    /* storage unavailable */
  }
  return fresh();
}

let state = load();
const subs = new Set<() => void>();

function commit(next: Progress) {
  state = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* ignore quota / private mode */
  }
  subs.forEach((f) => f());
}

export function useProgress(): Progress {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => state,
  );
}

export const getProgress = () => state;

export const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function award(p: Progress, id: string) {
  if (p.badges[id]) return;
  const b = BADGES.find((x) => x.id === id);
  if (!b) return;
  p.badges[id] = Date.now();
  p.rewards.push({ kind: 'badge', title: b.name, subtitle: b.desc, icon: b.icon, xp: 50 });
  p.xp += 50;
}

function unlockTheme(p: Progress, id: string) {
  if (!p.themes.includes(id)) p.themes.push(id);
}

/** Every completed activity goes through here: XP, daily streak, badges, promotions. */
function activity(p: Progress, xp: number) {
  p.xp += xp;
  const today = dayKey();
  p.activity[today] = (p.activity[today] ?? 0) + xp;
  const s = p.streak;
  if (s.lastDay !== today) {
    const y = new Date();
    y.setDate(y.getDate() - 1);
    const y2 = new Date();
    y2.setDate(y2.getDate() - 2);
    if (s.lastDay === dayKey(y)) s.count += 1;
    else if (s.lastDay === dayKey(y2) && s.freezes > 0) {
      s.freezes -= 1;
      s.count += 1;
      p.rewards.push({ kind: 'streak', title: 'Streak saved!', subtitle: 'A streak freeze covered the day you missed.', icon: '🧊' });
    } else s.count = 1;
    s.lastDay = today;
    s.best = Math.max(s.best, s.count);
    if (s.count > 1 && s.count % 7 === 0 && s.freezes < 2) {
      s.freezes += 1;
      p.rewards.push({ kind: 'streak', title: `${s.count}-day streak!`, subtitle: 'You earned a streak freeze 🧊. It protects your streak if you miss a day.', icon: '🔥', xp: 100 });
      p.xp += 100;
    } else if (s.count > 1) {
      p.rewards.push({ kind: 'streak', title: `Day ${s.count} 🔥`, subtitle: 'Streak extended. Come back tomorrow to keep it alive.', icon: '🔥' });
    }
    if (s.count >= 3) award(p, 'streak-3');
    if (s.count >= 7) { award(p, 'streak-7'); unlockTheme(p, 'midnight'); }
    if (s.count >= 14) award(p, 'streak-14');
    if (s.count >= 30) { award(p, 'streak-30'); unlockTheme(p, 'sakura'); }
  }
  award(p, 'first-steps');
  checkPromotion(p);
}

export interface ExamStatus {
  tier: number;
  puzzle: { have: number; need: number; ok: boolean };
  openings: { have: number; need: number; total: number; ok: boolean };
  endgames: { have: number; need: number; total: number; ok: boolean };
  ready: boolean;
}

export function examStatus(p: Progress, tier = p.tier): ExamStatus {
  const t = TIERS[Math.min(tier, TIERS.length - 1)];
  const ids = OPENINGS.filter((o) => o.tier === tier && !o.extra).flatMap((o) => buildTree(o).paths.map((l) => lineId(o.id, l.index)));
  const mastered = ids.filter((id) => (p.lines[id]?.lvl ?? 0) >= MASTERED).length;
  const egs = ENDGAMES.filter((e) => e.tier === tier);
  const cleared = egs.filter((e) => (p.endgames[e.id]?.clears ?? 0) > 0).length;
  const puzzle = { have: Math.round(p.puzzleRating), need: t.range[1], ok: p.puzzleRating >= t.range[1] };
  const openings = { have: mastered, need: Math.ceil(ids.length * 0.5), total: ids.length, ok: mastered >= Math.ceil(ids.length * 0.5) };
  const endgames = { have: cleared, need: Math.min(egs.length, Math.max(1, Math.ceil(egs.length * 0.75))), total: egs.length, ok: false };
  endgames.ok = cleared >= endgames.need;
  return { tier, puzzle, openings, endgames, ready: puzzle.ok && openings.ok && endgames.ok };
}

function checkPromotion(p: Progress) {
  while (p.tier < TIERS.length && examStatus(p).ready) {
    const passed = TIERS[p.tier];
    p.tier += 1;
    p.xp += 500;
    unlockTheme(p, passed.reward.theme);
    p.badges[`tier-${p.tier}`] = Date.now();
    const next = TIERS[p.tier];
    p.rewards.push({
      kind: 'tier',
      title: next ? `Promoted to ${next.name}!` : 'You passed the King exam!',
      subtitle: next
        ? `You crossed ${passed.range[1]}. New openings, puzzles and endgames are unlocked, plus the "${passed.reward.title}" title and a new board theme.`
        : 'Your training rating is above 2000 and the master repertoire is mastered. Time to take it to the arena!',
      icon: next ? next.icon : '👑',
      theme: passed.reward.theme,
      xp: 500,
    });
  }
}

function update(fn: (p: Progress) => void) {
  const next: Progress = structuredClone(state);
  fn(next);
  commit(next);
}

export const actions = {
  puzzle(id: string, rating: number, success: boolean, themes: string[], hinted: boolean) {
    update((p) => {
      const rec = (p.puzzles[id] ??= { ok: 0, fail: 0, last: 0 });
      rec.last = Date.now();
      const firstTime = rec.ok + rec.fail === 0;
      if (success && !hinted) rec.ok++;
      else rec.fail++;
      if (firstTime) {
        const k = p.puzzleCount < 30 ? 40 : 24;
        const exp = 1 / (1 + 10 ** ((rating - p.puzzleRating) / 400));
        const res = success && !hinted ? 1 : 0;
        p.puzzleRating = Math.max(400, p.puzzleRating + k * (res - exp));
        p.puzzleCount++;
      }
      if (success && !hinted) {
        p.combo++;
        p.bestCombo = Math.max(p.bestCombo, p.combo);
        if (p.combo >= 5) award(p, 'combo-5');
        if (p.combo >= 10) award(p, 'combo-10');
        if (p.combo >= 25) award(p, 'combo-25');
        if (themes.some((t) => t.startsWith('mate'))) {
          p.mates++;
          if (p.mates >= 20) award(p, 'mate-master');
        }
      } else p.combo = 0;
      activity(p, success ? 10 + Math.min(p.combo, 10) * 2 : 2);
    });
  },
  /** A line was played out to mate in the given stage; `mistakes` decides whether it counts. */
  stage(id: string, stage: 1 | 2 | 3, mistakes: number, choices: number[], key: string) {
    update((p) => {
      const rec = (p.lines[id] ??= { lvl: 0, reps: 0, last: 0, due: 0 });
      rec.reps++;
      rec.last = Date.now();
      rec.seen = [...new Set([...(rec.seen ?? []), key])];
      const clean = mistakes === 0;
      if (stage === 1) {
        rec.lvl = Math.max(rec.lvl, 1);
        rec.path = choices;
      } else if (stage === 2 && clean) rec.lvl = Math.max(rec.lvl, 2);
      else if (stage === 3) rec.lvl = mistakes <= EXAM_MISTAKES ? MASTERED : Math.min(rec.lvl, 2);
      // Mastered lines come back for a review a week later; unfinished ones are ready right away.
      rec.due = rec.lvl >= MASTERED ? Date.now() + REVIEW_AFTER : Date.now();
      const masteredOpenings = OPENINGS.filter((o) => buildTree(o).paths.every((l) => (p.lines[lineId(o.id, l.index)]?.lvl ?? 0) >= MASTERED)).length;
      if (masteredOpenings >= 1) award(p, 'opening-1');
      if (masteredOpenings >= 5) award(p, 'opening-5');
      activity(p, stage === 3 && mistakes <= EXAM_MISTAKES ? (clean ? 60 : 40) : clean ? 25 : 8);
    });
  },
  setProfile(name: string, avatar: string) {
    update((p) => {
      p.profile = { uid: p.profile?.uid ?? Math.random().toString(36).slice(2, 12), name: name.trim().slice(0, 20), avatar };
    });
  },
  battle(friend: Fighter, result: 'win' | 'loss' | 'draw') {
    update((p) => {
      const b = (p.battles ??= { played: 0, won: 0, lost: 0, drawn: 0 });
      b.played++;
      if (result === 'win') b.won++;
      else if (result === 'loss') b.lost++;
      else b.drawn++;
      const f = ((p.friends ??= {})[friend.uid] ??= { ...friend, w: 0, l: 0, d: 0, last: 0 });
      Object.assign(f, { name: friend.name, avatar: friend.avatar, last: Date.now() });
      if (result === 'win') f.w++;
      else if (result === 'loss') f.l++;
      else f.d++;
      activity(p, result === 'win' ? 40 : result === 'draw' ? 20 : 10);
    });
  },
  endgame(id: string, clean: boolean) {
    update((p) => {
      const rec = (p.endgames[id] ??= { clears: 0, clean: 0 });
      rec.clears++;
      if (clean) rec.clean++;
      if (Object.keys(p.endgames).length >= 5) award(p, 'endgame-5');
      activity(p, clean ? 40 : 20);
    });
  },
  strategy(id: string, ok: boolean) {
    update((p) => {
      if (ok) p.strategy[id] = (p.strategy[id] ?? 0) + 1;
      activity(p, ok ? 15 : 3);
    });
  },
  game(won: boolean, botElo: number) {
    update((p) => {
      p.games.played++;
      if (won) p.games.won++;
      if (won && botElo >= 1500) award(p, 'beat-engine');
      activity(p, won ? 60 : 20);
    });
  },
  xp(amount: number) {
    update((p) => activity(p, amount));
  },
  popReward() {
    update((p) => {
      p.rewards.shift();
    });
  },
  setTheme(id: string) {
    update((p) => {
      if (p.themes.includes(id)) p.theme = id;
    });
  },
  setOverlay(k: keyof OverlayOptions, v: boolean) {
    update((p) => {
      p.settings.overlays[k] = v;
    });
  },
  setSetting(k: 'coach' | 'sound' | 'fx' | 'voice', v: boolean) {
    update((p) => {
      p.settings[k] = v;
    });
  },
  reset() {
    commit(fresh());
  },
};
