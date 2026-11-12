# EloForge ♞ Chess Trainer

A mobile-first, offline-capable PWA that takes you from ~900 to 2000 Elo with interactive openings, tactics and endgames.

## Features

- **Rating ladder**: six tiers (Pawn 800 → King 2100). Each has its own openings, puzzles and endgames, and a promotion exam (training rating + opening mastery + endgames cleared). Crossing a tier unlocks the next content, a title and a new board theme, with confetti.
- **Openings**: 33 repertoires. 17 core ones (Italian, Scandinavian, London, Caro-Kann, QGD, Ruy Lopez, Queen's Gambit, French, Najdorf + anti-Sicilians, KID, Scotch, Catalan, Nimzo, Berlin, Grünfeld, Open Sicilian…) count toward the tier exams; 16 extras (Vienna, Petrov, Slav, Evans Gambit, Pirc, English, Alapin, Dutch, Dragon, Alekhine, King's Indian Attack, Semi-Slav, Rossolimo, Queen's Indian, Sveshnikov, Marshall) are optional. Each has main lines, the opponent's deviations and the classic traps.
- **Play it out to checkmate**: when the book line ends, the game continues on the same board against a "natural" opponent that picks human-like moves for your rating and sometimes something unexpected. Learn mode shows the plan with arrows; Drill mode grades every move.
  - **Learn**: guided, with live commentary and arrows for every move.
  - **Drill**: play from memory with no help. The opponent branches toward the lines you know least, and can throw Stockfish-picked **surprise moves** out of book. Each line needs 3 clean runs spaced over days (spaced repetition) to count as mastered.
- **Tactics**: rated puzzles that adapt to your training rating, with a combo streak and theme training (forks, back-rank, smothered mate, sacrifices…). Classic patterns are hand-made; the rest were generated from engine games and verified so every solution move is the single best move.
- **Endgames**: 18 lessons (Queen/Rook mates, opposition, Lucena, Philidor, Vancura, opposite bishops, B+N mate…). Learn the principles, watch a demo, then win or hold against full-strength Stockfish.
- **Sparring**: play a bot from 800 to 2200 with a live coach. Every move is described and graded (best / inaccuracy / mistake / blunder), better moves and threats are shown as arrows, plus accuracy and an eval bar.
- **"What would Magnus / Hikaru do?"** hints: engine candidates filtered through a style model. The Magnus-inspired hint favors positional squeeze, prophylaxis and good endgames; the Hikaru-inspired hint favors initiative, forcing moves and king attack.
- **Strategy overlays**: hanging pieces and threat arrows, isolated / doubled / backward / passed pawns, outposts, king-zone danger.
- **Combat mode**: pieces fight with signature attacks (the bishop draws a pistol, the rook fires a cannon, the queen charges a beam, the knight somersaults), promotions are summoned with an evolution-style animation, brilliant moves get a victory flourish, and every opening family has its own checkmate finisher. An announcer calls out "Fight!", "Finish it!" (forced mate on the board), "Combo!", "Brilliant!" and more. All toggleable in Profile.
- **Gamification**: daily streak with streak freezes, daily XP goal, combo multiplier, badges, unlockable board themes.

## Development

```bash
npm install
npm run content:setup # installs the stockfish npm package (only needed for the content scripts)
npm run dev
npm run build
npm run validate     # checks every opening line / puzzle / endgame with Stockfish
node scripts/gen-puzzles.mjs <seed> <minutes> [skipShortProbability]
node scripts/merge-puzzles.mjs
```

Stack: React 18 + Vite + TypeScript, chess.js, Stockfish 18 lite (WASM, in a Web Worker). Progress is stored locally in the browser.

## License

GPL-3.0-or-later (Stockfish is GPLv3). Pieces: Colin M.L. Burnett (GPL). The Magnus/Hikaru hints are inspired by publicly known playing styles and are not affiliated with either player.
