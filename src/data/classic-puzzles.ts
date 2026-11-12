// Hand-made classic tactical patterns, each with an explanation.

export interface Puzzle {
  id: string;
  fen: string;
  /** Solution in UCI: user move, reply, user move, … */
  moves: string[];
  rating: number;
  themes: string[];
  lastMove?: string;
  title?: string;
  explain?: string;
}

export const CLASSICS: Puzzle[] = [
  { id: 'c-scholar', title: 'Scholar\'s mate', fen: 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4', moves: ['h5f7'], rating: 600, themes: ['mateIn1', 'opening', 'pattern'], explain: 'Queen and bishop both hit f7, the square only the king defends. Black\'s ...Nf6?? blocked nothing.' },
  { id: 'c-backrank', title: 'Back-rank mate', fen: '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1', moves: ['d1d8'], rating: 650, themes: ['mateIn1', 'backRankMate', 'pattern'], explain: 'The black king is trapped behind its own pawns. Always give your king "luft" (h3/h6) to avoid this.' },
  { id: 'c-backrank2', title: 'Remove the guard', fen: '2r3k1/5ppp/8/8/8/8/Q4PPP/2R3K1 w - - 0 1', moves: ['c1c8'], rating: 700, themes: ['mateIn1', 'backRankMate', 'pattern'], explain: 'The only defender of the back rank is the c8 rook. Take it with check and it\'s mate.' },
  { id: 'c-smothered', title: 'Smothered mate', fen: '6rk/6pp/8/6N1/8/8/8/6K1 w - - 0 1', moves: ['g5f7'], rating: 650, themes: ['mateIn1', 'smotheredMate', 'pattern'], explain: 'The king is boxed in by its own rook and pawns: the knight check can\'t be blocked or escaped.' },
  { id: 'c-arabian', title: 'Arabian mate', fen: '7k/1R6/5N2/8/8/8/8/6K1 w - - 0 1', moves: ['b7h7'], rating: 750, themes: ['mateIn1', 'pattern'], explain: 'Knight and rook team up: the knight guards h7 and g8, the rook covers the rest.' },
  { id: 'c-opera', title: 'Opera mate', fen: '4k3/5p2/8/6B1/8/8/8/3R2K1 w - - 0 1', moves: ['d1d8'], rating: 800, themes: ['mateIn1', 'pattern'], explain: 'Morphy\'s famous Opera Game finish: the bishop guards d8, so the rook mates on the back rank.' },
  { id: 'c-boden', title: 'Boden\'s mate', fen: '2kr4/pp1n4/2p5/8/5B2/5Q2/8/5BK1 w - - 0 1', moves: ['f3c6', 'b7c6', 'f1a6'], rating: 1250, themes: ['mateIn2', 'sacrifice', 'pattern'], explain: 'Sacrifice the queen to open b7. Then two crisscrossing bishops mate the castled king.' },
  { id: 'c-philidor', title: 'Philidor\'s legacy', fen: 'r6k/6pp/8/6N1/8/1Q6/8/6K1 w - - 0 1', moves: ['g5f7', 'h8g8', 'f7h6', 'g8h8', 'b3g8', 'a8g8', 'h6f7'], rating: 1500, themes: ['mateIn4', 'smotheredMate', 'sacrifice', 'pattern'], explain: 'Check, double check, queen sacrifice, smothered mate: the most famous combination in chess.' },
];
