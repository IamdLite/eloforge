// Tactics puzzles. Hand-made classic patterns (with explanations) plus a large set generated from
// engine games (scripts/gen-puzzles.mjs); every solution move was verified to be the single best move.
import generated from './generated-puzzles.json';
import { CLASSICS } from './classic-puzzles';

import type { Puzzle } from './classic-puzzles';

export type { Puzzle };

export const THEME_INFO: Record<string, { name: string; tip: string }> = {
  mateIn1: { name: 'Mate in 1', tip: 'Look at every check. One of them leaves the king with no squares.' },
  mateIn2: { name: 'Mate in 2', tip: 'Start with forcing moves: checks first, then captures, then threats.' },
  mateIn3: { name: 'Mate in 3', tip: 'Find the first check or sacrifice that strips the king\'s cover, then keep checking.' },
  mateIn4: { name: 'Mate in 4', tip: 'A longer forced line: every move must be a check or an unstoppable threat.' },
  backRankMate: { name: 'Back-rank mate', tip: 'A king trapped behind its own pawns dies to a rook or queen on the back rank.' },
  smotheredMate: { name: 'Smothered mate', tip: 'The king is boxed in by its own pieces: a knight check is mate.' },
  fork: { name: 'Fork', tip: 'One piece attacks two targets at once. Knights are the best forkers.' },
  hangingPiece: { name: 'Hanging piece', tip: 'Something is undefended. Before every move, ask: what did my opponent leave unprotected?' },
  sacrifice: { name: 'Sacrifice', tip: 'Give material to open the king or win back more.' },
  discoveredAttack: { name: 'Discovered attack', tip: 'Move one piece to unmask an attack by another.' },
  doubleCheck: { name: 'Double check', tip: 'Two pieces give check at once, so only a king move can answer it.' },
  promotion: { name: 'Promotion', tip: 'Clear the path for a pawn to queen.' },
  underPromotion: { name: 'Underpromotion', tip: 'Sometimes a knight (or rook) is better than a queen.' },
  quietMove: { name: 'Quiet move', tip: 'The key move is not a check or capture. It sets up an unstoppable threat.' },
  advantage: { name: 'Win material', tip: 'Find the sequence that wins material by force.' },
  endgame: { name: 'Endgame', tip: 'Few pieces left: count tempi and look for promotion tricks.' },
  opening: { name: 'Opening trap', tip: 'Early in the game, look for loose pieces and weak f7/f2.' },
  pattern: { name: 'Classic pattern', tip: 'Named mating patterns you should recognize instantly.' },
};



export const PUZZLES: Puzzle[] = [...CLASSICS, ...(generated as Puzzle[])].sort((a, b) => a.rating - b.rating);

export const puzzleById = (id: string) => PUZZLES.find((p) => p.id === id);
