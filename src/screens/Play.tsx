import { useEffect, useRef, useState } from 'react';
import { Chess, type Color, type Move } from 'chess.js';
import Board, { ARROW, type BoardMove } from '../components/Board';
import { CoachFeed, EvalBar, HintBar, OverlayBar, nextFeedId, useAnnouncer, useOverlay, useSfx, type FeedItem } from '../components/ui';
import { shout } from '../lib/announcer';
import { actions, useProgress } from '../lib/store';
import { classify, describeMove, VERDICT_LABEL, type Verdict } from '../lib/commentary';
import { engine, whiteCp, winPct, type EngineLine } from '../lib/engine';
import { NAME, formatLine, hangingPieces, pvToSan, uciToMove, type Arrow } from '../lib/analysis';
import { START_FEN } from '../lib/tree';
import { detectOpening, finisherFor } from '../lib/finishers';

const MATERIAL: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const material = (c: Chess, color: Color) => c.board().flat().reduce((n, x) => n + (x && x.color === color ? MATERIAL[x.type] : 0), 0);

/** Fighting-game health bars: each side's material out of the starting 39. */
function HealthBars({ chess, user, elo }: { chess: Chess; user: Color; elo: number }) {
  const bar = (color: Color, name: string, right: boolean) => {
    const hp = Math.min(100, (material(chess, color) / 39) * 100);
    return (
      <div className={`hp${right ? ' right' : ''}`}>
        <span className="hp-name">{name}</span>
        <div className="hp-track">
          <div className="hp-lag" style={{ width: `${hp}%` }} />
          <div className={`hp-fill${hp < 30 ? ' low' : ''}`} style={{ width: `${hp}%` }} />
        </div>
      </div>
    );
  };
  return (
    <div className="hpbars">
      {bar(user, 'YOU', false)}
      <span className="hp-vs">VS</span>
      {bar(user === 'w' ? 'b' : 'w', `BOT ${elo}`, true)}
    </div>
  );
}

const BOT_LEVELS = [800, 1000, 1200, 1400, 1600, 1800, 2000, 2200];
const lineScore = (l: EngineLine) => (l.mate !== undefined ? Math.sign(l.mate || -1) * (10000 - Math.abs(l.mate) * 10) : l.cp ?? 0);

interface Ply {
  san: string;
  color: Color;
  verdict?: Verdict;
  drop?: number;
}

/** Bot move: real Elo limiting from 1320 up, a "club player" emulation below that. */
async function botMove(fen: string, elo: number): Promise<string> {
  if (elo >= 1320) {
    const ls = await engine.analyse(fen, { elo, depth: 14, movetime: 500 }, 'bot');
    return ls[0].uci;
  }
  const blunder = elo <= 800 ? 0.2 : elo <= 1000 ? 0.12 : 0.06;
  const c = new Chess(fen);
  if (Math.random() < blunder) {
    const ms = c.moves({ verbose: true });
    return ms[Math.floor(Math.random() * ms.length)].lan;
  }
  const ls = await engine.analyse(fen, { skill: 0, depth: elo <= 800 ? 2 : elo <= 1000 ? 4 : 6, multipv: 4 }, 'bot');
  const w = [0.55, 0.25, 0.12, 0.08];
  let r = Math.random();
  for (let i = 0; i < ls.length; i++) {
    r -= w[i];
    if (r <= 0) return ls[i].uci;
  }
  return ls[0].uci;
}

export default function Play({ startFen, startSide, opening }: { startFen?: string; startSide?: 'w' | 'b'; opening?: string }) {
  const p = useProgress();
  const sfx = useSfx();
  const suggested = BOT_LEVELS.reduce((a, b) => (Math.abs(b - (p.puzzleRating + 100)) < Math.abs(a - (p.puzzleRating + 100)) ? b : a));
  const [elo, setElo] = useState(suggested);
  const [side, setSide] = useState<'w' | 'b' | 'r'>(startSide ?? 'w');
  const [coach, setCoach] = useState(true);
  const [showEval, setShowEval] = useState(true);
  const [started, setStarted] = useState(false);

  const [user, setUser] = useState<Color>('w');
  const [fens, setFens] = useState<string[]>([startFen ?? START_FEN]);
  const [plies, setPlies] = useState<Ply[]>([]);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [thinking, setThinking] = useState(false);
  const [pre, setPre] = useState<EngineLine[] | null>(null);
  const [evalCp, setEvalCp] = useState<number | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [arrows, setArrows] = useState<Arrow[]>([]);
  const [lastMove, setLastMove] = useState<[string, string] | null>(null);
  const [takebacks, setTakebacks] = useState(0);
  const gameId = useRef(0);

  const [round, setRound] = useState(0);
  const announcer = useAnnouncer();
  const [celebrate, setCelebrate] = useState<{ square: string; text: string; key: number } | null>(null);
  const fen = fens[fens.length - 1];
  const chess = new Chess(fen);
  const finisher = finisherFor(opening ?? (startFen ? null : detectOpening(plies.map((x) => x.san))), String(round));
  const overlay = useOverlay(fen);
  const push = (it: Omit<FeedItem, 'id'>) => setFeed((f) => [...f, { ...it, id: nextFeedId() }]);

  const start = () => {
    const u: Color = side === 'r' ? (Math.random() < 0.5 ? 'w' : 'b') : side;
    gameId.current++;
    setRound((r) => r + 1);
    announcer.rearm();
    announcer.call('FIGHT!');
    setUser(u);
    setFens([startFen ?? START_FEN]);
    setPlies([]);
    setResult(null);
    setArrows([]);
    setLastMove(null);
    setTakebacks(0);
    setStarted(true);
    setFeed([{ id: nextFeedId(), who: 'coach', text: `New game vs the ${elo} bot. You play ${u === 'w' ? 'White' : 'Black'}. ${coach ? 'I\'ll comment on every move and grade yours.' : 'Coach is off: commentary only after the game.'} Toggle the overlays to see weak pawns, threats and outposts.` }]);
  };

  // Engine pre-analysis on the learner's turn (for grading, eval and hints).
  useEffect(() => {
    if (!started || result) return;
    const c = new Chess(fen);
    if (c.turn() !== user || c.isGameOver()) return;
    let live = true;
    setPre(null);
    engine.analyse(fen, { depth: 13, multipv: 3 }, 'coach-pre').then((ls) => {
      if (!live) return;
      setPre(ls);
      setEvalCp(whiteCp(ls[0], fen));
      announcer.report(ls[0].mate);
    }).catch(() => {});
    return () => {
      live = false;
    };
  }, [fen, started, user, result]);

  // Bot's turn.
  useEffect(() => {
    if (!started || result) return;
    const c = new Chess(fen);
    if (c.turn() === user || c.isGameOver()) return;
    const g = gameId.current;
    setThinking(true);
    const t = setTimeout(async () => {
      const uci = await botMove(fen, elo).catch(() => null);
      if (g !== gameId.current || !uci) return setThinking(false);
      const m = c.move(uciToMove(uci));
      sfx(m.captured ? 'capture' : 'move');
      setThinking(false);
      setFens((f) => [...f, c.fen()]);
      setPlies((pl) => [...pl, { san: m.san, color: m.color }]);
      setLastMove([m.from, m.to]);
      setArrows([]);
      const notes = describeMove(m, c);
      const danger = hangingPieces(c).filter((h) => h.color === user).map((h) => `${NAME[c.get(h.square)!.type]} on ${h.square}`);
      if (danger.length) notes.push(`⚠️ Watch out: your ${danger.join(' and ')} ${danger.length > 1 ? 'are' : 'is'} under attack.`);
      push({ who: 'opp', san: m.san, text: notes.join(' ') });
      checkEnd(c);
    }, 350);
    return () => clearTimeout(t);
  }, [fen, started, user, result]); // eslint-disable-line react-hooks/exhaustive-deps

  const checkEnd = (c: Chess) => {
    if (!c.isGameOver()) return;
    let res: string;
    let won = false;
    if (c.isCheckmate()) {
      won = c.turn() !== user;
      res = won ? '🏆 You won by checkmate!' : '💀 Checkmated.';
    } else res = '🤝 Draw' + (c.isStalemate() ? ' by stalemate' : c.isThreefoldRepetition() ? ' by repetition' : c.isInsufficientMaterial() ? ' (insufficient material)' : '');
    finish(res, won);
  };

  const finish = (res: string, won: boolean) => {
    setResult(res);
    actions.game(won, elo);
    sfx(won ? 'good' : 'bad');
  };

  const onMove = async (mv: BoardMove) => {
    if (!started || result || thinking) return;
    const c = new Chess(fen);
    let m: Move;
    try {
      m = c.move(mv);
    } catch {
      return;
    }
    const g = gameId.current;
    const before = fen;
    sfx(m.captured ? 'capture' : 'move');
    setFens((f) => [...f, c.fen()]);
    setLastMove([m.from, m.to]);
    setArrows([]);
    const idx = plies.length;
    setPlies((pl) => [...pl, { san: m.san, color: m.color }]);
    const notes = describeMove(m, c);
    if (c.isGameOver()) {
      push({ who: 'you', san: m.san, text: notes.join(' ') });
      return checkEnd(c);
    }
    if (coach && !pre) setThinking(true);
    const preLines = coach ? pre ?? (await engine.analyse(before, { depth: 12, multipv: 3 }, 'coach-pre').catch(() => null)) : null;
    if (g !== gameId.current) return;
    if (!coach || !preLines) {
      setThinking(false);
      push({ who: 'you', san: m.san, text: notes.join(' ') });
      return;
    }
    // Grade the move (runs before the bot thinks, since the engine queue is serialized).
    setThinking(true);
    const after = await engine.analyse(c.fen(), { depth: 12 }, 'coach-post');
    if (g !== gameId.current) return;
    const bestCp = lineScore(preLines[0]);
    const playedCp = -lineScore(after[0]);
    const onlyMove = preLines.length > 1 && winPct(bestCp) - winPct(lineScore(preLines[1])) > 15 && m.lan === preLines[0].uci;
    const sac = !!notes.find((n) => n.startsWith('Careful')) && m.lan === preLines[0].uci;
    const v = m.lan === preLines[0].uci ? (onlyMove || sac ? 'brilliant' : 'best') : classify(bestCp, playedCp, false, false);
    const drop = Math.max(0, winPct(bestCp) - winPct(playedCp));
    setPlies((pl) => pl.map((x, i) => (i === idx ? { ...x, verdict: v, drop } : x)));
    if (v === 'brilliant') setCelebrate({ square: m.to, text: 'BRILLIANT!!', key: Date.now() });
    else if (v === 'blunder') shout('Blunder!');
    setEvalCp(whiteCp(after[0], c.fen()));
    let text = notes.join(' ');
    if (['inaccuracy', 'mistake', 'blunder'].includes(v)) {
      const bestSan = pvToSan(before, preLines[0].pv, 1)[0];
      const refute = pvToSan(c.fen(), after[0].pv, 3);
      text += ` Better was ${bestSan} (${formatLine(before, pvToSan(before, preLines[0].pv, 4))}).`;
      if (refute.length && v !== 'inaccuracy') text += ` Now the threat is ${refute[0]}.`;
      setArrows([{ from: preLines[0].uci.slice(0, 2) as never, to: preLines[0].uci.slice(2, 4) as never, color: ARROW.move }, { from: after[0].uci.slice(0, 2) as never, to: after[0].uci.slice(2, 4) as never, color: ARROW.threat }]);
    }
    push({ who: 'you', san: m.san, verdict: v, text });
    setThinking(false);
  };

  const takeback = () => {
    if (thinking || fens.length < 2) return;
    const n = new Chess(fen).turn() === user ? 2 : 1;
    if (fens.length - n < 1) return;
    gameId.current++;
    setFens((f) => f.slice(0, -n));
    setPlies((pl) => pl.slice(0, -n));
    setResult(null);
    setArrows([]);
    setLastMove(null);
    setTakebacks((t) => t + 1);
    push({ who: 'coach', text: 'Move taken back. Try to find a better idea!' });
  };

  const resign = () => {
    gameId.current++;
    setThinking(false);
    finish('🏳️ You resigned.', false);
  };

  const mine = plies.filter((x) => x.color === user && x.drop !== undefined);
  const accuracy = mine.length ? Math.round(mine.reduce((s, x) => s + Math.max(0, Math.min(100, 103.17 * Math.exp(-0.04354 * x.drop!) - 3.17)), 0) / mine.length) : null;
  const counts = (['brilliant', 'best', 'good', 'inaccuracy', 'mistake', 'blunder'] as Verdict[]).map((v) => [v, mine.filter((x) => x.verdict === v).length] as const);

  if (!started) {
    return (
      <div>
        <h1 className="page-title">Sparring</h1>
        <p className="muted page-sub">Play the bot with a live coach. Every move is explained and graded, and arrows show better ideas and threats. Stuck? Ask what Magnus or Hikaru would do.</p>
        <div className="card setup">
          <label className="label">Bot strength</label>
          <div className="seg wrap">
            {BOT_LEVELS.map((l) => <button key={l} className={elo === l ? 'on' : ''} onClick={() => setElo(l)}>{l}</button>)}
          </div>
          <label className="label">Your color</label>
          <div className="seg">
            {(['w', 'r', 'b'] as const).map((s) => <button key={s} className={side === s ? 'on' : ''} onClick={() => setSide(s)}>{s === 'w' ? '⚪ White' : s === 'b' ? '⚫ Black' : '🎲 Random'}</button>)}
          </div>
          <label className="toggle"><input type="checkbox" checked={coach} onChange={(e) => setCoach(e.target.checked)} /> Live coach (grades your moves, allows takebacks)</label>
          <label className="toggle"><input type="checkbox" checked={showEval} onChange={(e) => setShowEval(e.target.checked)} /> Show evaluation bar</label>
          {startFen && <p className="muted small">Starting from your opening position.</p>}
          <button className="btn primary block big" onClick={start}>▶ Start game</button>
        </div>
        <p className="muted small center">Record: {p.games.won} wins / {p.games.played} games</p>
      </div>
    );
  }

  const myTurn = chess.turn() === user && !result;
  return (
    <div className="trainer">
      <div className="trainer-head">
        <div>
          <div className="eyebrow">🤖 Bot {elo} · you play {user === 'w' ? 'White' : 'Black'}</div>
          <b>{result ?? (thinking ? (myTurn ? 'Coach is analysing…' : 'Bot is thinking…') : myTurn ? 'Your move' : '…')}</b>
        </div>
        {accuracy !== null && <div className="pill">🎯 {accuracy}%</div>}
      </div>

      {p.settings.fx !== false && <HealthBars chess={chess} user={user} elo={elo} />}
      <div className="board-row">
        {showEval && <EvalBar cp={evalCp} orientation={user} />}
        <Board fen={fen} orientation={user} interactive={myTurn && !thinking} onMove={onMove} arrows={[...overlay.arrows, ...arrows]} markers={overlay.markers} lastMove={lastMove} theme={p.theme} finisher={finisher} announce={announcer.announce} celebrate={celebrate} />
      </div>

      <div className="movelist plies" ref={(el) => el && (el.scrollLeft = el.scrollWidth)}>
        {plies.length === 0 && 'Game start'}
        {plies.map((x, i) => (
          <span key={i} className={x.verdict ? VERDICT_LABEL[x.verdict].cls : ''}>
            {(i + (fens[0].split(' ')[1] === 'b' ? 1 : 0)) % 2 === 0 ? `${Math.floor(i / 2) + 1}.` : ''}{x.san}{x.verdict && ['inaccuracy', 'mistake', 'blunder', 'brilliant'].includes(x.verdict) ? VERDICT_LABEL[x.verdict].icon : ''}{' '}
          </span>
        ))}
      </div>

      <div className="dock">
        {!result && <HintBar fen={fen} disabled={!myTurn || thinking} onHint={(_, a) => setArrows([a])} />}
        {coach && !result && <button className="chip" onClick={takeback} disabled={thinking || fens.length < 2}>↶ Undo</button>}
        <OverlayBar notes={overlay.notes}>
          <label className="toggle"><input type="checkbox" checked={showEval} onChange={(e) => setShowEval(e.target.checked)} /> Eval bar</label>
        </OverlayBar>
        {!result && <button className="chip danger" onClick={resign}>🏳️ Resign</button>}
      </div>

      {result && (
        <div className={`result card ${result.startsWith('🏆') ? 'win' : ''}`}>
          <h3>{result}</h3>
          {accuracy !== null && <p>Accuracy {accuracy}% · takebacks {takebacks}</p>}
          <div className="verdict-counts">
            {counts.map(([v, n]) => <span key={v} className={`verdict ${VERDICT_LABEL[v].cls}`}>{VERDICT_LABEL[v].icon} {n}</span>)}
          </div>
          <div className="row gap wrap">
            <button className="btn primary" onClick={start}>↺ Rematch</button>
            <button className="btn" onClick={() => setStarted(false)}>⚙️ New setup</button>
          </div>
        </div>
      )}

      <CoachFeed items={feed} />
    </div>
  );
}
