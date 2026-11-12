// Endgame lessons. Every position was checked with Stockfish to have the stated result.
// You play against full-strength Stockfish: win the won ones, hold the drawn ones.

export type EndgameGoal = 'mate' | 'win' | 'draw';

export interface EndgameDef {
  id: string;
  title: string;
  tier: number;
  fen: string;
  goal: EndgameGoal;
  /** For mate/win: maximum moves allowed. For draw: moves you must survive. */
  moves: number;
  /** Use engine eval to detect a thrown win/draw (off for positions the engine misjudges). */
  evalCheck: boolean;
  principles: string[];
  technique: string;
}

export const ENDGAMES: EndgameDef[] = [
  // Tier 0
  {
    id: 'kqk', title: 'Queen mate', tier: 0, fen: '8/8/8/4k3/8/8/8/4K2Q w - - 0 1', goal: 'mate', moves: 20, evalCheck: false,
    principles: ['Put the queen a knight\'s move away from the enemy king to shrink its box.', 'Follow the king as it moves; never give a pointless check.', 'Once the king is on the edge, STOP, and bring your own king closer.', 'Beware stalemate: always leave the enemy king a legal move until the mating move.'],
    technique: 'Box → push to the edge → bring the king → mate on the edge.',
  },
  {
    id: 'krk', title: 'Rook mate', tier: 0, fen: '8/8/8/4k3/8/8/8/R3K3 w - - 0 1', goal: 'mate', moves: 32, evalCheck: false,
    principles: ['The rook cuts the king off along a rank or file.', 'Bring your king to face the enemy king (opposition).', 'When the kings face each other, check from the side to push the king back a row.', 'Use a waiting rook move when you need to lose a tempo.'],
    technique: 'Cut off → opposition → check → repeat until the king is on the edge.',
  },
  {
    id: 'rrk', title: 'Two-rook ladder', tier: 0, fen: '8/8/8/3k4/8/8/8/R3K2R w - - 0 1', goal: 'mate', moves: 10, evalCheck: false,
    principles: ['One rook guards a rank, the other checks on the next rank.', 'Walk the king up the board like climbing a ladder.', 'If the king approaches a rook, move that rook far away to the other side.'],
    technique: 'Rooks take turns: one cuts off, the other checks.',
  },
  {
    id: 'kpk-opposition', title: 'King + pawn: take the opposition', tier: 0, fen: '8/8/3k4/8/8/3K4/3P4/8 w - - 0 1', goal: 'win', moves: 20, evalCheck: true,
    principles: ['Your king must lead, not your pawn.', 'Opposition: kings face each other with one square between. The side NOT to move has it.', 'Gain opposition, then outflank to the side to march forward.', 'King on the 6th rank in front of the pawn wins every time (except rook pawns).'],
    technique: '1.Kd4! takes the opposition. Then outflank with Kc5/Ke5 and escort the pawn.',
  },
  {
    id: 'kpk-sixth', title: 'King on the 6th rank', tier: 0, fen: '3k4/8/3K4/3P4/8/8/8/8 w - - 0 1', goal: 'win', moves: 12, evalCheck: true,
    principles: ['With your king on the 6th rank in front of the pawn, it is always a win.', 'Push the pawn only when your king controls the squares in front.', 'Avoid stalemate when the enemy king is in the corner.'],
    technique: 'Step aside with the king (Kc6/Ke6), then push the pawn with support.',
  },
  // Tier 1
  {
    id: 'kpk-defend', title: 'Defend king vs king + pawn', tier: 1, fen: '8/8/8/4k3/8/4KP2/8/8 b - - 0 1', goal: 'draw', moves: 15, evalCheck: true,
    principles: ['Stand in front of the pawn.', 'Keep the opposition: move so the kings face each other.', 'When pushed back to the 8th rank, step straight back, never diagonally into a lost corner.'],
    technique: 'Keep your king in front of the pawn and take the opposition whenever the white king steps forward.',
  },
  {
    id: 'q-vs-pawn', title: 'Queen vs pawn on the 7th', tier: 1, fen: 'K7/8/8/8/3Q4/8/1pk5/8 w - - 0 1', goal: 'win', moves: 25, evalCheck: true,
    principles: ['Approach with checks and pins so the enemy king must step in front of its pawn.', 'Every time the king blocks its own pawn, you gain one free move: bring your king closer.', 'Knight and center pawns lose; rook and bishop pawns can be drawn because of stalemate tricks.'],
    technique: 'Check, check, force the king in front of the pawn, bring your king one step, repeat.',
  },
  {
    id: 'breakthrough', title: 'Pawn breakthrough', tier: 1, fen: '7k/ppp5/8/PPP5/8/8/8/7K w - - 0 1', goal: 'win', moves: 10, evalCheck: true,
    principles: ['Three pawns against three: the middle pawn sacrifices first.', 'After 1.b6! the defender can only stop one passer.', 'Count: the kings are too far away to interfere.'],
    technique: '1.b6! axb6 2.c6! bxc6 3.a6 (or 1...cxb6 2.a6! bxa6 3.c6) and a pawn queens.',
  },
  {
    id: 'outside-passer', title: 'Outside passed pawn', tier: 1, fen: '8/5kpp/8/8/P7/8/5KPP/8 w - - 0 1', goal: 'win', moves: 30, evalCheck: true,
    principles: ['An outside passed pawn drags the enemy king away.', 'While their king chases it, your king eats the pawns on the other wing.', 'Don\'t rush the passer: use it as a decoy at the right moment.'],
    technique: 'Advance the a-pawn to deflect the king, then raid the kingside with your king.',
  },
  // Tier 2
  {
    id: 'lucena', title: 'Lucena: building a bridge', tier: 2, fen: '1K6/1P2k3/8/8/8/8/r7/3R4 w - - 0 1', goal: 'win', moves: 20, evalCheck: true,
    principles: ['The most important rook endgame win.', 'Step 1: cut off the enemy king with your rook (already done).', 'Step 2: Rd4! prepares a bridge to shield your king from checks.', 'Step 3: walk the king out; when checks come, block with the rook on the 4th rank.'],
    technique: '1.Rd4! Then Kc7, Kb6, Kc6/Kb5 and Rb4 blocks the last check.',
  },
  {
    id: 'philidor', title: 'Philidor defense', tier: 2, fen: '8/4k3/r7/3KP3/8/8/8/7R b - - 0 1', goal: 'draw', moves: 15, evalCheck: true,
    principles: ['Keep your rook on the 6th rank (your 3rd) to stop the enemy king from advancing.', 'Your king stays in front of the pawn.', 'Only when the pawn steps to the 6th, swing the rook to the 1st rank and check from behind.'],
    technique: 'Wait on the 6th rank (...Rb6, ...Ra6). After e6, play ...Ra1 and give endless checks.',
  },
  {
    id: 'cut-off', title: 'Rook: cut off by two files', tier: 2, fen: 'r5k1/8/8/8/3P4/3K4/8/5R2 w - - 0 1', goal: 'win', moves: 30, evalCheck: true,
    principles: ['A king cut off by two files cannot get back in time.', 'Escort the pawn with your king; use the rook to block checks.', 'Aim for a Lucena position.'],
    technique: 'Keep the cut on the f-file, march the king up with the pawn, and shelter from checks.',
  },
  // Tier 3
  {
    id: 'ocb-draw', title: 'Opposite bishops: fortress', tier: 3, fen: '8/8/4k3/2b2p2/P4P2/3B4/4K3/8 b - - 0 1', goal: 'draw', moves: 20, evalCheck: true,
    principles: ['Opposite-colored bishops are famously drawish even a pawn or two down.', 'Blockade passed pawns on squares your bishop controls.', 'Your king blockades one side, your bishop guards the other.'],
    technique: 'Bishop watches the a-pawn from a distance, king blocks the kingside. Don\'t trade into a lost K+P ending.',
  },
  {
    id: 'knight-vs-pawn', title: 'Knight stops the pawn', tier: 3, fen: '8/8/8/8/8/5k2/1p6/3N2K1 w - - 0 1', goal: 'draw', moves: 15, evalCheck: true,
    principles: ['A knight stops a pawn best from in front of it.', 'Use knight forks on the promotion square to win tempo.', 'Watch for the enemy king trying to shoulder your knight away.'],
    technique: 'Get the knight to b2-d3 style blockades; if the king comes, use checks.',
  },
  {
    id: 'wrong-bishop', title: 'Wrong bishop: hold the corner', tier: 3, fen: 'k7/8/1K6/P7/8/8/8/2B5 b - - 0 1', goal: 'draw', moves: 15, evalCheck: false,
    principles: ['A rook pawn + bishop that doesn\'t control the promotion square can\'t win if your king reaches the corner.', 'Shuffle between a8 and b8; stalemate is your friend.'],
    technique: 'Stay in the corner. The dark-squared bishop can never drive you out of a8.',
  },
  // Tier 4
  {
    id: 'vancura', title: 'Vancura defense', tier: 4, fen: '8/8/8/R7/P5k1/8/6K1/r7 b - - 0 1', goal: 'draw', moves: 20, evalCheck: true,
    principles: ['Against a rook pawn with the enemy rook in front: attack the pawn from the side.', 'Your rook on the 6th/f-file keeps the pawn pinned to its rook.', 'Your king stays near the kingside, not in front of the pawn.'],
    technique: 'Rook to the side of the pawn (...Rf1-f6 / ...Ra1 then side checks).',
  },
  {
    id: 'q-vs-c-pawn', title: 'Queen vs bishop pawn (king helps)', tier: 4, fen: '8/8/8/8/8/1K6/2pk4/7Q w - - 0 1', goal: 'win', moves: 20, evalCheck: true,
    principles: ['A bishop pawn on the 7th is usually a draw because of a stalemate trick, unless your king is close.', 'With your king near, build a mating net instead of just stopping the pawn.'],
    technique: 'Pin and check to keep the king busy, then go for mate with king and queen.',
  },
  // Tier 5
  {
    id: 'bishop-knight', title: 'Bishop + knight mate', tier: 5, fen: '8/8/8/4k3/8/8/8/3BNK2 w - - 0 1', goal: 'mate', moves: 40, evalCheck: false,
    principles: ['You can only mate in a corner of your bishop\'s color.', 'Push the king to the edge, then drive it toward the right corner.', 'The W-maneuver: the knight walks in a W shape while king and bishop build a cage.'],
    technique: 'Edge → wrong corner → W-maneuver with the knight → right corner → mate. 33 moves max in theory!',
  },
];
