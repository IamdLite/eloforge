// Rating ladder from ~900 to 2000+. Every tier has its own openings, puzzles and endgames;
// passing a tier's exam unlocks the next one and grants a reward.

export interface Tier {
  id: number;
  name: string;
  icon: string;
  range: [number, number];
  color: string;
  focus: string;
  reward: { theme: string; title: string };
}

export const TIERS: Tier[] = [
  { id: 0, name: 'Pawn', icon: '♟', range: [800, 1100], color: '#a3a3a3', focus: 'Stop hanging pieces, develop fast, castle, and spot one-move tactics.', reward: { theme: 'classic', title: 'Pawn Storm' } },
  { id: 1, name: 'Knight', icon: '♞', range: [1100, 1300], color: '#22c55e', focus: 'Forks, pins and basic checkmates. Learn your first full repertoire.', reward: { theme: 'emerald', title: 'Fork Master' } },
  { id: 2, name: 'Bishop', icon: '♝', range: [1300, 1500], color: '#38bdf8', focus: 'Two-move combinations, pawn structure, and the key rook endgames.', reward: { theme: 'ocean', title: 'Long Diagonal' } },
  { id: 3, name: 'Rook', icon: '♜', range: [1500, 1700], color: '#a855f7', focus: 'Sharp openings (Sicilian, KID), calculation, active pieces.', reward: { theme: 'amethyst', title: 'Open File' } },
  { id: 4, name: 'Queen', icon: '♛', range: [1700, 1900], color: '#f43f5e', focus: 'Deep tactics, strategic squeezes, technical endgames.', reward: { theme: 'ruby', title: 'Royal Power' } },
  { id: 5, name: 'King', icon: '♚', range: [1900, 2100], color: '#f59e0b', focus: 'Master-level preparation: Najdorf, Nimzo, Grünfeld, and precise endgame technique.', reward: { theme: 'gold', title: '2000 Club' } },
];

export function tierForRating(r: number): number {
  for (let i = TIERS.length - 1; i >= 0; i--) if (r >= TIERS[i].range[0]) return i;
  return 0;
}

export interface BoardTheme {
  id: string;
  name: string;
  light: string;
  dark: string;
  unlock: string;
}

export const BOARD_THEMES: BoardTheme[] = [
  { id: 'slate', name: 'Slate', light: '#cbd5e1', dark: '#64748b', unlock: 'Starter' },
  { id: 'classic', name: 'Classic Wood', light: '#f0d9b5', dark: '#b58863', unlock: 'Reach Knight' },
  { id: 'emerald', name: 'Emerald', light: '#eeeed2', dark: '#769656', unlock: 'Reach Bishop' },
  { id: 'ocean', name: 'Ocean', light: '#dee3e6', dark: '#8ca2ad', unlock: 'Reach Rook' },
  { id: 'amethyst', name: 'Amethyst', light: '#e9d5ff', dark: '#9061c2', unlock: 'Reach Queen' },
  { id: 'ruby', name: 'Ruby', light: '#fde2e2', dark: '#c0504d', unlock: 'Reach King' },
  { id: 'gold', name: 'Gold', light: '#fef3c7', dark: '#c48f2c', unlock: 'Pass the King exam' },
  { id: 'midnight', name: 'Midnight', light: '#9fb3c8', dark: '#334e68', unlock: '7-day streak' },
  { id: 'sakura', name: 'Sakura', light: '#fdf2f8', dark: '#db7093', unlock: '30-day streak' },
];

export interface Badge {
  id: string;
  name: string;
  icon: string;
  desc: string;
}

export const BADGES: Badge[] = [
  { id: 'first-steps', name: 'First Steps', icon: '👣', desc: 'Complete your first training activity' },
  { id: 'streak-3', name: 'On Fire', icon: '🔥', desc: '3-day training streak' },
  { id: 'streak-7', name: 'Week Warrior', icon: '🗓️', desc: '7-day streak (unlocks Midnight board)' },
  { id: 'streak-14', name: 'Fortnight', icon: '💪', desc: '14-day streak' },
  { id: 'streak-30', name: 'Unstoppable', icon: '🏆', desc: '30-day streak (unlocks Sakura board)' },
  { id: 'combo-5', name: 'Combo x5', icon: '⚡', desc: 'Solve 5 puzzles in a row' },
  { id: 'combo-10', name: 'Combo x10', icon: '🌩️', desc: 'Solve 10 puzzles in a row' },
  { id: 'combo-25', name: 'Tactical Machine', icon: '🤖', desc: 'Solve 25 puzzles in a row' },
  { id: 'opening-1', name: 'Repertoire Builder', icon: '📖', desc: 'Master every line of one opening' },
  { id: 'opening-5', name: 'Theory Nerd', icon: '📚', desc: 'Master 5 openings' },
  { id: 'endgame-5', name: 'Technique', icon: '🎯', desc: 'Clear 5 endgame lessons' },
  { id: 'mate-master', name: 'Mate Master', icon: '♚', desc: 'Solve 20 checkmate puzzles' },
  { id: 'beat-engine', name: 'Giant Slayer', icon: '🗡️', desc: 'Beat the sparring bot at 1500+' },
  ...TIERS.slice(1).map((t) => ({ id: `tier-${t.id}`, name: `${t.name} Rank`, icon: t.icon, desc: `Reach the ${t.name} tier (${t.range[0]}+)` })),
  { id: 'tier-6', name: '2000 Club', icon: '👑', desc: 'Pass the King exam' },
];
