import { useEffect, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import { useNav } from '../App';
import { finisherFor } from '../lib/finishers';
import Board, { ARROW, type BoardMove } from '../components/Board';
import { CoachFeed, HintBar, OverlayBar, nextFeedId, useOverlay, useSfx, type FeedItem } from '../components/ui';
import { THEME_INFO, puzzleById, type Puzzle } from '../data/puzzles';
import { actions, getProgress, useProgress } from '../lib/store';
import { describeMove } from '../lib/commentary';
import { uciToMove, type Arrow } from '../lib/analysis';
import { nextPuzzle } from './Tactics';

type Status = 'play' | 'wrong' | 'solved' | 'review';

export default function PuzzleTrainer({ theme, startId }: { theme?: string; startId?: string }) {
  const p = useProgress();
  const { back } = useNav();
  const sfx = useSfx();
  const [puzzle, setPuzzle] = useState<Puzzle | undefined>(() => (startId ? puzzleById(startId) : nextPuzzle(getProgress(), theme)));
  const [fen, setFen] = useState(puzzle?.fen ?? '');
  const [k, setK] = useState(0);
  const [status, setStatus] = useState<Status>('play');
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [lastMove, setLastMove] = useState<[string, string] | null>(null);
  const [flash, setFlash] = useState<{ square: string; kind: 'good' | 'bad' } | null>(null);
  const [arrows, setArrows] = useState<Arrow[]>([]);
  const [showThemes, setShowThemes] = useState(false);
  const recorded = useRef(false);
  const hinted = useRef(false);
  const overlay = useOverlay(fen);

  const load = (z: Puzzle | undefined) => {
    setPuzzle(z);
    if (!z) return;
    setFen(z.fen);
    setK(0);
    setStatus('play');
    setArrows([]);
    setShowThemes(false);
    setLastMove(z.lastMove ? [z.lastMove.slice(0, 2), z.lastMove.slice(2, 4)] : null);
    recorded.current = false;
    hinted.current = false;
    const turn = new Chess(z.fen).turn() === 'w' ? 'White' : 'Black';
    setFeed([{ id: nextFeedId(), who: 'coach', text: `${z.title ? z.title + ': ' : ''}${turn} to move. ${z.lastMove ? 'Your opponent just played the highlighted move. What did it allow? ' : ''}Find the best move.` }]);
  };

  useEffect(() => load(puzzle), []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!puzzle) return <div><button className="back" onClick={back}>‹ Back</button><p>No puzzles for this theme yet.</p></div>;
  const orientation = new Chess(puzzle.fen).turn();

  const record = (ok: boolean) => {
    if (recorded.current) return;
    recorded.current = true;
    actions.puzzle(puzzle.id, puzzle.rating, ok, puzzle.themes, hinted.current);
  };

  const onMove = (mv: BoardMove) => {
    if (status !== 'play') return;
    const c = new Chess(fen);
    let m;
    try {
      m = c.move(mv);
    } catch {
      return;
    }
    const expected = puzzle.moves[k];
    const ok = m.lan === expected || c.isCheckmate();
    if (!ok) {
      setFlash({ square: m.to, kind: 'bad' });
      sfx('bad');
      setStatus('wrong');
      record(false);
      const sol = new Chess(fen).move(uciToMove(expected));
      setArrows([{ from: sol.from, to: sol.to, color: ARROW.move }]);
      setFeed((f) => [...f, { id: nextFeedId(), who: 'you', san: m.san, verdict: 'mistake', text: `Not the solution. The key move was ${sol.san}.` }]);
      return;
    }
    setFlash({ square: m.to, kind: 'good' });
    sfx(m.captured ? 'capture' : 'move');
    setFen(c.fen());
    setLastMove([m.from, m.to]);
    setArrows([]);
    setFeed((f) => [...f, { id: nextFeedId(), who: 'you', san: m.san, verdict: 'best', text: describeMove(m, c).join(' ') }]);
    const nk = k + 1;
    if (nk >= puzzle.moves.length || c.isGameOver()) return solved();
    setK(nk);
    setTimeout(() => {
      const reply = c.move(uciToMove(puzzle.moves[nk]));
      sfx(reply.captured ? 'capture' : 'move');
      setFen(c.fen());
      setLastMove([reply.from, reply.to]);
      setK(nk + 1);
      setFeed((f) => [...f, { id: nextFeedId(), who: 'opp', san: reply.san, text: describeMove(reply, c).join(' ') }]);
    }, 450);
  };

  const solved = () => {
    setStatus('solved');
    sfx('good');
    record(true);
    const tips = puzzle.themes.filter((t) => THEME_INFO[t]).map((t) => `${THEME_INFO[t].name}: ${THEME_INFO[t].tip}`);
    setFeed((f) => [...f, { id: nextFeedId(), who: 'coach', text: `✅ Solved! ${puzzle.explain ?? ''} ${tips[0] ?? ''}` }]);
    setShowThemes(true);
  };

  const showSolution = () => {
    setStatus('review');
    const c = new Chess(puzzle.fen);
    let i = 0;
    setFen(puzzle.fen);
    setArrows([]);
    const step = () => {
      if (i >= puzzle.moves.length) {
        setShowThemes(true);
        return;
      }
      const m = c.move(uciToMove(puzzle.moves[i]));
      setFen(c.fen());
      setLastMove([m.from, m.to]);
      setFeed((f) => [...f, { id: nextFeedId(), who: i % 2 === 0 ? 'you' : 'opp', san: m.san, text: describeMove(m, c).join(' ') }]);
      i++;
      setTimeout(step, 900);
    };
    setTimeout(step, 300);
  };

  const retry = () => {
    setFen(puzzle.fen);
    setK(0);
    setStatus('play');
    setArrows([]);
    setLastMove(puzzle.lastMove ? [puzzle.lastMove.slice(0, 2), puzzle.lastMove.slice(2, 4)] : null);
  };

  const next = () => load(nextPuzzle(getProgress(), theme, puzzle.id));

  return (
    <div className="trainer">
      <div className="trainer-head">
        <button className="back" onClick={back}>‹</button>
        <div>
          <div className="eyebrow">⚔️ {theme ? THEME_INFO[theme]?.name : 'Rated puzzles'} · combo ×{p.combo}</div>
          <b>{orientation === 'w' ? '⚪ White' : '⚫ Black'} to move</b>
        </div>
        <div className="pill">{showThemes || status !== 'play' ? puzzle.rating : '????'}</div>
      </div>

      <Board fen={fen} orientation={orientation} interactive={status === 'play'} onMove={onMove} arrows={[...(status === 'play' ? [] : overlay.arrows), ...arrows]} markers={status === 'play' ? [] : overlay.markers} lastMove={lastMove} theme={p.theme} flash={flash} finisher={finisherFor(null, puzzle.id)} />

      {showThemes && (
        <div className="tags">
          {puzzle.themes.filter((t) => THEME_INFO[t]).map((t) => <span key={t} className="pill">{THEME_INFO[t].name}</span>)}
        </div>
      )}

      {status === 'play' && (
        <HintBar
          fen={fen}
          override={puzzle.moves[k]}
          onHint={(_, a) => {
            hinted.current = true;
            setArrows([a]);
          }}
        />
      )}

      {status !== 'play' && (
        <div className={`result card ${status === 'solved' ? 'win' : ''}`}>
          <h3>{status === 'solved' ? (hinted.current ? '✅ Solved with a hint' : '🎉 Solved!') : status === 'wrong' ? '❌ Not quite' : '👀 Solution'}</h3>
          <div className="row gap wrap">
            {status === 'wrong' && <button className="btn" onClick={retry}>↺ Retry</button>}
            {status === 'wrong' && <button className="btn" onClick={showSolution}>👀 Show solution</button>}
            <button className="btn primary" onClick={next}>Next puzzle ›</button>
          </div>
        </div>
      )}

      {status !== 'play' && <OverlayBar notes={overlay.notes} />}
      <CoachFeed items={feed} />
    </div>
  );
}
