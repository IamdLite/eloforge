import { useEffect, useRef, useState } from 'react';
import { Chess, type Color } from 'chess.js';
import { useNav } from '../App';
import { finisherFor } from '../lib/finishers';
import Board, { ARROW, type BoardMove } from '../components/Board';
import { CoachFeed, EvalBar, HintBar, OverlayBar, nextFeedId, useOverlay, useSfx, type FeedItem } from '../components/ui';
import { ENDGAMES } from '../data/endgames';
import { actions, useProgress } from '../lib/store';
import { describeMove } from '../lib/commentary';
import { engine, whiteCp, type EngineLine } from '../lib/engine';
import { VALUE, formatLine, pvToSan, uciToMove, type Arrow } from '../lib/analysis';

type Phase = 'lesson' | 'practice' | 'demo' | 'won' | 'failed';

const lineScore = (l: EngineLine) => (l.mate !== undefined ? Math.sign(l.mate || -1) * (10000 - Math.abs(l.mate) * 10) : l.cp ?? 0);

function material(c: Chess, color: Color) {
  let s = 0, queens = 0, pawns = 0, pieces = 0;
  for (const p of c.board().flat()) {
    if (!p || p.color !== color || p.type === 'k') continue;
    s += VALUE[p.type];
    if (p.type === 'q') queens++;
    if (p.type === 'p') pawns++;
    else pieces++;
  }
  return { s, queens, pawns, pieces };
}

export default function EndgameTrainer({ id }: { id: string }) {
  const eg = ENDGAMES.find((e) => e.id === id)!;
  const p = useProgress();
  const { back } = useNav();
  const sfx = useSfx();
  const user = new Chess(eg.fen).turn();
  const opp: Color = user === 'w' ? 'b' : 'w';
  const start = useRef({ diff: 0, queens: 0 });
  const [phase, setPhase] = useState<Phase>('lesson');
  const [fen, setFen] = useState(eg.fen);
  const [history, setHistory] = useState<string[]>([]);
  const [moves, setMoves] = useState(0);
  const [clean, setClean] = useState(true);
  const [thinking, setThinking] = useState(false);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [lastMove, setLastMove] = useState<[string, string] | null>(null);
  const [arrows, setArrows] = useState<Arrow[]>([]);
  const [evalCp, setEvalCp] = useState<number | null>(null);
  const [best, setBest] = useState<EngineLine | null>(null);
  const demoRef = useRef(0);
  const overlay = useOverlay(fen);

  useEffect(() => {
    const c = new Chess(eg.fen);
    start.current = { diff: material(c, user).s - material(c, opp).s, queens: material(c, user).queens };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const push = (it: Omit<FeedItem, 'id'>) => setFeed((f) => [...f, { ...it, id: nextFeedId() }]);

  // Keep a best-move line for the learner's turn (used to explain mistakes).
  useEffect(() => {
    if (phase !== 'practice' || thinking) return;
    if (new Chess(fen).turn() !== user) return;
    let live = true;
    engine.analyse(fen, { depth: 16 }, 'eg-best').then((ls) => {
      if (!live) return;
      setBest(ls[0]);
      setEvalCp(whiteCp(ls[0], fen));
    }).catch(() => {});
    return () => {
      live = false;
    };
  }, [fen, phase, thinking]); // eslint-disable-line react-hooks/exhaustive-deps

  const startPractice = () => {
    demoRef.current++;
    setPhase('practice');
    setFen(eg.fen);
    setHistory([]);
    setMoves(0);
    setClean(true);
    setArrows([]);
    setLastMove(null);
    setFeed([{ id: nextFeedId(), who: 'coach', text: goalText() }]);
  };

  const goalText = () =>
    eg.goal === 'mate' ? `Checkmate within ${eg.moves} moves. Stockfish defends perfectly.`
      : eg.goal === 'win' ? `Win this position (promote or mate) within ${eg.moves} moves. Stockfish defends perfectly.`
        : `Hold the draw for ${eg.moves} moves against Stockfish.`;

  const fail = (reason: string) => {
    setPhase('failed');
    sfx('bad');
    push({ who: 'coach', verdict: 'mistake', text: reason });
  };

  const win = () => {
    setPhase('won');
    sfx('good');
    actions.endgame(eg.id, clean);
    push({ who: 'coach', text: clean ? '🏆 Perfect technique, no help needed!' : '✅ Done! Now try it again without hints or takebacks for a ⭐.' });
  };

  const onMove = async (mv: BoardMove) => {
    if (phase !== 'practice' || thinking) return;
    const c = new Chess(fen);
    let m;
    try {
      m = c.move(mv);
    } catch {
      return;
    }
    const prevBest = best;
    const before = fen;
    sfx(m.captured ? 'capture' : 'move');
    setHistory((h) => [...h, fen]);
    setFen(c.fen());
    setLastMove([m.from, m.to]);
    setArrows([]);
    const n = moves + 1;
    setMoves(n);
    push({ who: 'you', san: m.san, text: describeMove(m, c).join(' ') });

    if (c.isCheckmate()) return eg.goal === 'draw' ? win() : win();
    if (c.isDraw() || c.isStalemate()) {
      if (eg.goal === 'draw') return win();
      return fail(c.isStalemate() ? 'Stalemate! The king had no legal moves. Always leave it a square until the final blow.' : 'The position became a draw. The win slipped away.');
    }
    const um = material(c, user), om = material(c, opp);
    if (eg.goal !== 'draw' && om.s === 0 && (um.queens > 0 || um.pieces > 1 || um.s >= 5) && eg.goal === 'win') return win();

    setThinking(true);
    const ls = await engine.analyse(c.fen(), { depth: 18, movetime: 900 }, 'eg-reply');
    const reply = ls[0];
    const userEval = -lineScore(reply);
    const betterSan = prevBest ? pvToSan(before, prevBest.pv, 1)[0] : undefined;
    if (eg.evalCheck) {
      const thrown = eg.goal !== 'draw' ? userEval < 150 && reply.mate === undefined : userEval < -350;
      if (thrown) {
        setThinking(false);
        setEvalCp(whiteCp(reply, c.fen()));
        if (prevBest) setArrows([{ from: prevBest.uci.slice(0, 2) as never, to: prevBest.uci.slice(2, 4) as never, color: ARROW.move }]);
        return fail(eg.goal === 'draw'
          ? `That loses. ${betterSan ? `${betterSan} held the draw (${formatLine(before, pvToSan(before, prevBest!.pv, 4))}).` : ''}`
          : `That throws away the win. ${betterSan ? `${betterSan} kept it (${formatLine(before, pvToSan(before, prevBest!.pv, 4))}).` : ''}`);
      }
    }
    if (eg.goal === 'mate' && n >= eg.moves) {
      setThinking(false);
      return fail(`Out of moves: you need to mate within ${eg.moves}. Use the technique to shrink the box faster.`);
    }
    // Engine reply.
    const r = c.move(uciToMove(reply.uci));
    sfx(r.captured ? 'capture' : 'move');
    setFen(c.fen());
    setLastMove([r.from, r.to]);
    setThinking(false);
    push({ who: 'opp', san: r.san, text: describeMove(r, c).join(' ') });
    if (c.isCheckmate()) return fail('You got mated!');
    if (c.isDraw() || c.isStalemate()) return eg.goal === 'draw' ? win() : fail('The position is a draw now.');
    const um2 = material(c, user), om2 = material(c, opp);
    if (eg.goal === 'win' && um2.queens > start.current.queens && um2.s - om2.s >= start.current.diff + 3) return win();
    if (eg.goal === 'draw' && n >= eg.moves) return win();
    if (eg.goal === 'win' && n >= eg.moves) return fail(`Out of moves (${eg.moves}). Convert faster next time.`);
  };

  const takeback = () => {
    if (!history.length || thinking) return;
    const prev = history[history.length - 1];
    setHistory((h) => h.slice(0, -1));
    setFen(prev);
    setMoves((m) => Math.max(0, m - 1));
    setClean(false);
    setArrows([]);
    setLastMove(null);
    if (phase === 'failed') setPhase('practice');
    push({ who: 'coach', text: 'Took back your move (no ⭐ this run).' });
  };

  const demo = async () => {
    const token = ++demoRef.current;
    setPhase('demo');
    const c = new Chess(eg.fen);
    setFen(c.fen());
    setLastMove(null);
    setArrows([]);
    setFeed([{ id: nextFeedId(), who: 'coach', text: `Watch the technique: ${eg.technique}` }]);
    for (let i = 0; i < 24 && !c.isGameOver(); i++) {
      const ls = await engine.analyse(c.fen(), { depth: 16, movetime: 500 }, 'eg-demo');
      if (token !== demoRef.current) return;
      const m = c.move(uciToMove(ls[0].uci));
      setFen(c.fen());
      setLastMove([m.from, m.to]);
      setEvalCp(whiteCp(ls[0], c.fen()));
      setFeed((f) => [...f, { id: nextFeedId(), who: m.color === user ? 'you' : 'opp', san: m.san, text: describeMove(m, c).join(' ') }]);
      await new Promise((res) => setTimeout(res, 900));
      if (token !== demoRef.current) return;
    }
    setFeed((f) => [...f, { id: nextFeedId(), who: 'coach', text: 'Your turn: try it yourself.' }]);
  };

  return (
    <div className="trainer">
      <div className="trainer-head">
        <button className="back" onClick={() => { demoRef.current++; back(); }}>‹</button>
        <div>
          <div className="eyebrow">🏁 Endgame · {eg.goal === 'draw' ? 'Hold the draw' : eg.goal === 'mate' ? 'Checkmate' : 'Win'}</div>
          <b>{eg.title}</b>
        </div>
        {phase === 'practice' && <div className="pill">{moves}/{eg.moves}</div>}
      </div>

      <div className="board-row">
        {(phase === 'practice' || phase === 'demo') && <EvalBar cp={evalCp} orientation={user} />}
        <Board fen={fen} orientation={user} interactive={phase === 'practice' && !thinking} onMove={onMove} arrows={[...overlay.arrows, ...arrows]} markers={overlay.markers} lastMove={lastMove} theme={p.theme} finisher={finisherFor(null, eg.id)} />
      </div>

      {phase === 'lesson' && (
        <div className="card lesson">
          <h3>Key ideas</h3>
          <ul>{eg.principles.map((x) => <li key={x}>{x}</li>)}</ul>
          <p className="technique"><b>Technique:</b> {eg.technique}</p>
          <div className="row gap">
            <button className="btn" onClick={demo}>▶ Watch demo</button>
            <button className="btn primary" onClick={startPractice}>Practice vs Stockfish</button>
          </div>
        </div>
      )}
      {phase === 'demo' && (
        <div className="row gap">
          <button className="btn" onClick={() => { demoRef.current++; setPhase('lesson'); setFen(eg.fen); }}>■ Stop</button>
          <button className="btn primary" onClick={startPractice}>Practice now</button>
        </div>
      )}
      {phase === 'practice' && (
        <>
          <div className="prompt subtle"><b>{thinking ? 'Stockfish is thinking…' : 'Your move'}</b><span>{goalText()}</span></div>
          <HintBar fen={fen} disabled={thinking} onHint={(_, a) => { setArrows([a]); setClean(false); }} />
          <div className="row gap toolbar">
            <button className="btn small" onClick={takeback} disabled={!history.length || thinking}>↶ Takeback</button>
            <button className="btn small" onClick={startPractice}>↺ Restart</button>
          </div>
        </>
      )}
      {(phase === 'won' || phase === 'failed') && (
        <div className={`result card ${phase === 'won' ? 'win' : ''}`}>
          <h3>{phase === 'won' ? (clean ? '⭐ Mastered!' : '✅ Cleared') : '❌ Not this time'}</h3>
          <div className="row gap wrap">
            {phase === 'failed' && <button className="btn" onClick={takeback}>↶ Take back & retry</button>}
            <button className="btn primary" onClick={startPractice}>↺ {phase === 'won' ? 'Again' : 'Restart'}</button>
            <button className="btn" onClick={() => setPhase('lesson')}>📘 Lesson</button>
          </div>
        </div>
      )}

      <OverlayBar notes={overlay.notes} />
      <CoachFeed items={feed} />
    </div>
  );
}
