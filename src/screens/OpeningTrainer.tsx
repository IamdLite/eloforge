import { useEffect, useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import { useNav } from '../App';
import { finisherFor } from '../lib/finishers';
import Board, { ARROW, type BoardMove } from '../components/Board';
import { CoachFeed, HintBar, OverlayBar, nextFeedId, useAnnouncer, useOverlay, useSfx, type FeedItem } from '../components/ui';
import { openingById } from '../data/openings';
import { buildTree, lineId, type TreeNode } from '../lib/tree';
import { actions, MASTERED, useProgress } from '../lib/store';
import { classify, describeMove } from '../lib/commentary';
import { engine, winPct, type EngineLine } from '../lib/engine';
import { NAME, formatLine, hangingPieces, pvToSan, uciToMove, type Arrow } from '../lib/analysis';
import { lineScore, naturalMove } from '../lib/bot';
import { shout } from '../lib/announcer';

/** After the book: the game is played out to checkmate against a natural opponent. */
interface Fight {
  fens: string[];
  sans: string[];
  last: [string, string] | null;
  result?: { text: string; won: boolean };
}

interface OffBook {
  fen: string;
  san: string;
  lastMove: [string, string];
  answered?: boolean;
}

export default function OpeningTrainer({ id, mode, line }: { id: string; mode: 'learn' | 'drill'; line?: number }) {
  const op = openingById(id)!;
  const { root, paths } = useMemo(() => buildTree(op), [op]);
  const p = useProgress();
  const { go, back } = useNav();
  const sfx = useSfx();
  const side = op.side;

  const pickLine = () => {
    if (line !== undefined) return line;
    const now = Date.now();
    const scored = paths.map((l) => {
      const s = p.lines[lineId(op.id, l.index)];
      const lvl = s?.lvl ?? 0;
      const dueBonus = s && s.due <= now ? -10 : 0;
      return { i: l.index, key: (s ? lvl : -1) * 10 + dueBonus + Math.random() };
    });
    scored.sort((a, b) => a.key - b.key);
    return scored[0].i;
  };

  const [target, setTarget] = useState<number>(pickLine);
  const [path, setPath] = useState<TreeNode[]>([]);
  const [clean, setClean] = useState(true);
  const [mistake, setMistake] = useState<TreeNode | null>(null);
  const [feed, setFeed] = useState<FeedItem[]>(() => [{ id: nextFeedId(), who: 'coach', text: `${op.name}: ${op.summary}` }]);
  const [done, setDone] = useState<null | 'line' | 'surprise'>(null);
  const [surprises, setSurprises] = useState(mode === 'drill');
  const [offBook, setOffBook] = useState<OffBook | null>(null);
  const [flash, setFlash] = useState<{ square: string; kind: 'good' | 'bad' } | null>(null);
  const [hintArrow, setHintArrow] = useState<Arrow | null>(null);
  const [peeked, setPeeked] = useState(false);
  const surpriseUsed = useRef(false);
  const busy = useRef(false);
  const [fight, setFight] = useState<Fight | null>(null);
  const [fightPre, setFightPre] = useState<EngineLine[] | null>(null);
  const [fightArrows, setFightArrows] = useState<Arrow[]>([]);
  const [thinking, setThinking] = useState(false);
  const [celebrate, setCelebrate] = useState<{ square: string; text: string; key: number } | null>(null);
  const announcer = useAnnouncer();
  const fightId = useRef(0);
  const oppElo = Math.max(800, Math.min(2100, Math.round(p.puzzleRating - 100)));

  const node = path.length ? path[path.length - 1] : root;
  const fen = fight ? fight.fens[fight.fens.length - 1] : offBook?.fen ?? node.fen;
  const tline = paths[target];
  const expected: TreeNode | undefined = tline.nodes[path.length];
  const userTurn = new Chess(fen).turn() === side;
  const lastMove: [string, string] | null = fight ? fight.last : offBook ? offBook.lastMove : node.uci ? [node.uci.slice(0, 2), node.uci.slice(2, 4)] : null;
  const overlay = useOverlay(fen);

  const push = (it: Omit<FeedItem, 'id'>) => setFeed((f) => [...f, { ...it, id: nextFeedId() }]);

  const commentFor = (n: TreeNode, parentFen: string) => {
    if (n.comment) return n.comment;
    const c = new Chess(parentFen);
    const m = c.move(n.san);
    return describeMove(m, c).join(' ');
  };

  const playNode = (n: TreeNode, who: 'you' | 'opp') => {
    const parentFen = node.fen;
    sfx(n.san.includes('x') ? 'capture' : 'move');
    push({ who, san: n.san, verdict: 'book', text: commentFor(n, parentFen) });
    setPath((pp) => [...pp, n]);
    setMistake(null);
    setHintArrow(null);
    setPeeked(false);
  };

  /** Pick a line through `child`, preferring the current target, else the least-mastered one. */
  const retarget = (child: TreeNode) => {
    if (child.lines.includes(target)) return;
    const best = [...child.lines].sort((a, b) => (p.lines[lineId(op.id, a)]?.lvl ?? 0) - (p.lines[lineId(op.id, b)]?.lvl ?? 0))[0];
    setTarget(best);
  };

  // Line complete?
  useEffect(() => {
    if (done || offBook) return;
    if (path.length > 0 && path.length >= tline.nodes.length) {
      setDone('line');
      if (mode === 'drill') {
        actions.line(lineId(op.id, target), clean);
        sfx(clean ? 'good' : 'bad');
        push({ who: 'coach', text: clean ? '✅ Clean run! Your mastery of this line went up.' : '🔁 Line finished with mistakes. It comes back sooner for review.' });
      } else actions.xp(5);
      const last = path[path.length - 1];
      startFight(last.fen, last.uci ? [last.uci.slice(0, 2), last.uci.slice(2, 4)] : null);
    }
  }, [path.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Opponent's move.
  useEffect(() => {
    if (done || userTurn || offBook || busy.current) return;
    if (path.length >= tline.nodes.length) return;
    busy.current = true;
    const t = setTimeout(async () => {
      try {
        const want = surprises && mode === 'drill' && !surpriseUsed.current && path.length >= 3 && Math.random() < 0.3;
        if (want && (await playSurprise())) return;
        let next: TreeNode | undefined = expected;
        if (mode === 'drill' && node.children.length > 1) {
          // Branch the way a real opponent would: favour lines you know least.
          const weights = node.children.map((c) => {
            const lvl = Math.min(...c.lines.map((l) => p.lines[lineId(op.id, l)]?.lvl ?? 0));
            return { c, w: 1 / (1 + lvl * 1.5) };
          });
          let r = Math.random() * weights.reduce((s, x) => s + x.w, 0);
          for (const x of weights) {
            r -= x.w;
            if (r <= 0) { next = x.c; break; }
          }
          if (next) retarget(next);
        }
        if (next) playNode(next, 'opp');
      } finally {
        busy.current = false;
      }
    }, 650);
    return () => {
      clearTimeout(t);
      busy.current = false;
    };
  }, [path.length, userTurn, done, offBook]); // eslint-disable-line react-hooks/exhaustive-deps

  async function playSurprise(): Promise<boolean> {
    const lines = await engine.analyse(node.fen, { depth: 10, multipv: 6 }, 'surprise');
    const book = new Set(node.children.map((c) => c.uci));
    const top = lineScore(lines[0]);
    const cands = lines.filter((l) => !book.has(l.uci) && top - lineScore(l) <= 70);
    if (!cands.length) return false;
    const pick = cands[Math.floor(Math.random() * cands.length)];
    const c = new Chess(node.fen);
    const m = c.move(uciToMove(pick.uci));
    surpriseUsed.current = true;
    sfx('move');
    push({ who: 'opp', san: m.san, text: `😮 Surprise! ${m.san} is not in your repertoire. ${describeMove(m, c).join(' ')}` });
    push({ who: 'coach', text: 'Off-book now. Use principles: develop, fight for the center, keep your king safe, and check what the move threatens. Find a good reply.' });
    setOffBook({ fen: c.fen(), san: m.san, lastMove: [m.from, m.to] });
    return true;
  }

  async function answerOffBook(mv: BoardMove) {
    if (!offBook) return;
    const before = offBook.fen;
    const c = new Chess(before);
    let m;
    try {
      m = c.move(mv);
    } catch {
      return;
    }
    sfx(m.captured ? 'capture' : 'move');
    setOffBook({ fen: c.fen(), san: m.san, lastMove: [m.from, m.to], answered: true });
    push({ who: 'coach', text: 'Evaluating your move…' });
    const [bestLines, afterLines] = await Promise.all([
      engine.analyse(before, { depth: 13, multipv: 2 }),
      engine.analyse(c.fen(), { depth: 13 }),
    ]);
    const bestCp = lineScore(bestLines[0]);
    const playedCp = -lineScore(afterLines[0]);
    const v = classify(bestCp, playedCp);
    const good = winPct(bestCp) - winPct(playedCp) < 8;
    const bestSan = pvToSan(before, bestLines[0].pv, 1)[0];
    const extra = good ? ' You handled the surprise well.' : ` Better was ${bestSan}: ${formatLine(before, pvToSan(before, bestLines[0].pv, 5))}.`;
    setFeed((f) => [...f.filter((x) => x.text !== 'Evaluating your move…'), { id: nextFeedId(), who: 'you', san: m.san, verdict: v, text: describeMove(m, c).join(' ') + extra }]);
    if (!good) setHintArrow({ from: bestLines[0].uci.slice(0, 2) as never, to: bestLines[0].uci.slice(2, 4) as never, color: ARROW.move });
    sfx(good ? 'good' : 'bad');
    actions.xp(good ? 15 : 4);
    setDone('surprise');
    startFight(c.fen(), [m.from, m.to]);
  }

  const onMove = (mv: BoardMove) => {
    if (fight) return void fightMove(mv);
    if (done) return;
    if (offBook) {
      if (!offBook.answered) void answerOffBook(mv);
      return;
    }
    const c = new Chess(node.fen);
    let m;
    try {
      m = c.move(mv);
    } catch {
      return;
    }
    const child = node.children.find((ch) => ch.uci === m.lan);
    if (child) {
      setFlash({ square: m.to, kind: 'good' });
      if (child !== expected) retarget(child);
      playNode(child, 'you');
      return;
    }
    setFlash({ square: m.to, kind: 'bad' });
    sfx('bad');
    if (!expected) return;
    if (mode === 'drill') {
      setClean(false);
      setMistake(expected);
      push({ who: 'coach', verdict: 'mistake', san: m.san, text: `Not your repertoire move. The book move is ${expected.san}: ${commentFor(expected, node.fen)} Play it to continue.` });
      // Tell the learner whether their idea was at least playable.
      void engine.analyse(node.fen, { depth: 12, multipv: 1 }).then(async (bl) => {
        const after = await engine.analyse(c.fen(), { depth: 12 });
        const drop = winPct(lineScore(bl[0])) - winPct(-lineScore(after[0]));
        push({ who: 'coach', text: drop < 6 ? `(${m.san} is playable according to the engine, but stick to the repertoire to master it.)` : `(${m.san} is a real mistake: it costs about ${Math.round(drop)}% winning chances.)` });
      });
    } else {
      push({ who: 'coach', text: `Follow the green arrow: play ${expected.san}.` });
    }
  };

  // ───── Fight to checkmate ─────
  function startFight(from: string, last: [string, string] | null) {
    const c = new Chess(from);
    if (c.isGameOver()) return;
    fightId.current++;
    const id = fightId.current;
    setTimeout(() => {
      if (id !== fightId.current) return;
      setFight({ fens: [from], sans: [], last });
      setFightArrows([]);
      setHintArrow(null);
      announcer.rearm();
      announcer.call('FIGHT!');
      push({ who: 'coach', text: `⚔️ The book ends here. Now play it out to checkmate. Your opponent (~${oppElo}) plays natural moves for this position, and sometimes something unexpected.` });
    }, 1100);
  }

  const endFight = (c: Chess) => {
    if (!c.isGameOver()) return undefined;
    if (c.isCheckmate()) {
      const won = c.turn() !== side;
      if (won) actions.xp(25);
      return { text: won ? '🏆 Checkmate! You converted the opening.' : '💀 You got checkmated.', won };
    }
    return { text: '🤝 Draw' + (c.isStalemate() ? ' by stalemate' : c.isThreefoldRepetition() ? ' by repetition' : ''), won: false };
  };

  // Learner's turn: analyse for grading, hints, and "FINISH IT!"
  useEffect(() => {
    if (!fight || fight.result || !userTurn) return;
    let live = true;
    setFightPre(null);
    engine.analyse(fen, { depth: 12, multipv: 2 }, 'fight-pre').then((ls) => {
      if (!live) return;
      setFightPre(ls);
      announcer.report(ls[0].mate);
      if (mode === 'learn') {
        const b = ls[0].uci;
        setFightArrows([{ from: b.slice(0, 2) as never, to: b.slice(2, 4) as never, color: ARROW.move }]);
      }
    }).catch(() => {});
    return () => {
      live = false;
    };
  }, [fen, !!fight, fight?.result, userTurn]); // eslint-disable-line react-hooks/exhaustive-deps

  // Opponent's turn: a natural move, sometimes a surprise.
  useEffect(() => {
    if (!fight || fight.result || userTurn) return;
    const id = fightId.current;
    setThinking(true);
    const t = setTimeout(async () => {
      try {
        const nm = await naturalMove(fen, oppElo);
        if (id !== fightId.current) return;
        const c = new Chess(fen);
        const m = c.move(uciToMove(nm.uci));
        sfx(m.captured ? 'capture' : 'move');
        const notes = describeMove(m, c);
        if (nm.unexpected) {
          const usual = new Chess(fen).move(uciToMove(nm.unexpected.usual)).san;
          notes.unshift(`😮 Unexpected! The natural move was ${usual}. Ask what ${m.san} allows.`);
        }
        const danger = hangingPieces(c).filter((h) => h.color === side).map((h) => `${NAME[c.get(h.square)!.type]} on ${h.square}`);
        if (danger.length) notes.push(`⚠️ Your ${danger.join(' and ')} ${danger.length > 1 ? 'are' : 'is'} under attack.`);
        push({ who: 'opp', san: m.san, text: notes.join(' ') });
        setFight((f) => f && { ...f, fens: [...f.fens, c.fen()], sans: [...f.sans, m.san], last: [m.from, m.to], result: endFight(c) });
      } catch {
        /* superseded */
      } finally {
        if (id === fightId.current) setThinking(false);
      }
    }, 450);
    return () => clearTimeout(t);
  }, [fen, !!fight, fight?.result, userTurn]); // eslint-disable-line react-hooks/exhaustive-deps

  async function fightMove(mv: BoardMove) {
    if (!fight || fight.result || thinking) return;
    const before = fen;
    const c = new Chess(before);
    let m;
    try {
      m = c.move(mv);
    } catch {
      return;
    }
    const id = fightId.current;
    const pre = fightPre;
    sfx(m.captured ? 'capture' : 'move');
    setFightArrows([]);
    setHintArrow(null);
    const result = endFight(c);
    setFight((f) => f && { ...f, fens: [...f.fens, c.fen()], sans: [...f.sans, m.san], last: [m.from, m.to], result });
    const notes = describeMove(m, c);
    if (result || !pre) {
      push({ who: 'you', san: m.san, text: notes.join(' ') });
      return;
    }
    const after = await engine.analyse(c.fen(), { depth: 11 }, 'fight-post').catch(() => null);
    if (!after || id !== fightId.current) return;
    const bestCp = lineScore(pre[0]);
    const playedCp = -lineScore(after[0]);
    const onlyMove = pre.length > 1 && winPct(bestCp) - winPct(lineScore(pre[1])) > 15 && m.lan === pre[0].uci;
    const v = m.lan === pre[0].uci ? (onlyMove ? 'brilliant' : 'best') : classify(bestCp, playedCp);
    let text = notes.join(' ');
    if (v === 'brilliant') setCelebrate({ square: m.to, text: 'BRILLIANT!!', key: Date.now() });
    if (['mistake', 'blunder'].includes(v)) {
      const bestSan = pvToSan(before, pre[0].pv, 1)[0];
      text += ` Better was ${bestSan} (${formatLine(before, pvToSan(before, pre[0].pv, 4))}). Tap Undo to try again.`;
      setFightArrows([{ from: pre[0].uci.slice(0, 2) as never, to: pre[0].uci.slice(2, 4) as never, color: ARROW.move }]);
      if (v === 'blunder') shout('Blunder!');
    }
    push({ who: 'you', san: m.san, verdict: v, text });
  }

  const undoFight = () => {
    if (!fight || thinking) return;
    fightId.current++;
    setFight((f) => {
      if (!f) return f;
      const n = new Chess(f.fens[f.fens.length - 1]).turn() === side ? 2 : 1;
      const keep = Math.max(1, f.fens.length - n);
      const fens = f.fens.slice(0, keep);
      return { fens, sans: f.sans.slice(0, keep - 1), last: null };
    });
    setFightArrows([]);
    setThinking(false);
  };

  const restart = (newLine?: number) => {
    fightId.current++;
    setFight(null);
    setFightArrows([]);
    setThinking(false);
    setPath([]);
    setClean(true);
    setMistake(null);
    setDone(null);
    setOffBook(null);
    setHintArrow(null);
    surpriseUsed.current = false;
    setTarget(newLine ?? pickLine());
    setFeed([{ id: nextFeedId(), who: 'coach', text: `${op.name}: ${op.summary}` }]);
  };

  const undo = () => {
    if (!path.length || offBook) return;
    // Step back to the previous position where it's the learner's turn.
    const n = new Chess(path.length >= 2 ? path[path.length - 2].fen : root.fen).turn() === side ? 2 : 1;
    setPath((pp) => pp.slice(0, Math.max(0, pp.length - n)));
    setDone(null);
  };

  const peek = () => {
    if (!expected) return;
    setPeeked(true);
    setClean(false);
  };

  // Arrows to draw.
  const arrows: Arrow[] = [...overlay.arrows];
  if (!offBook && userTurn && expected && !done) {
    if (mode === 'learn' || mistake || peeked) {
      arrows.push({ from: expected.uci.slice(0, 2) as never, to: expected.uci.slice(2, 4) as never, color: ARROW.move });
      if (mode === 'learn') expected.arrows.forEach(([a, b]) => arrows.push({ from: a, to: b, color: ARROW.idea, width: 10 }));
    }
  }
  if (mode === 'learn' && !userTurn && node.arrows.length) node.arrows.forEach(([a, b]) => arrows.push({ from: a, to: b, color: ARROW.idea, width: 10 }));
  if (fight) arrows.push(...fightArrows);
  if (hintArrow) arrows.push(hintArrow);

  const lvl = p.lines[lineId(op.id, target)]?.lvl ?? 0;
  const sans = [...path.map((n) => n.san), ...(offBook ? [offBook.san] : []), ...(fight?.sans ?? [])];
  const moves = sans.map((x, i) => (i % 2 === 0 ? `${i / 2 + 1}.${x}` : x)).join(' ');
  const fighting = !!fight && !fight.result;
  const showResult = done && !fighting;

  return (
    <div className="trainer">
      <div className="trainer-head">
        <button className="back" onClick={back}>‹</button>
        <div>
          <div className="eyebrow">{mode === 'learn' ? '🎓 Learn' : '🧠 Drill'} · {op.name}</div>
          <b>{fight ? (fight.result ? fight.result.text : thinking ? '⚔️ Opponent is thinking…' : '⚔️ Fight to checkmate') : <>{tline.trap && '⚠️ '}{tline.name}</>}</b>
        </div>
        <div className="dots">{Array.from({ length: MASTERED }, (_, i) => <span key={i} className={`dot ${i < lvl ? 'on' : ''}`} />)}</div>
      </div>

      <Board
        fen={fen}
        orientation={side}
        interactive={fight ? fighting && userTurn && !thinking : !done && userTurn}
        onMove={onMove}
        arrows={arrows}
        markers={overlay.markers}
        lastMove={lastMove}
        theme={p.theme}
        flash={fight ? null : flash}
        finisher={finisherFor(op.id)}
        announce={announcer.announce}
        celebrate={celebrate}
      />

      <div className="movelist" ref={(el) => el && (el.scrollLeft = el.scrollWidth)}>{moves || 'Starting position'}</div>

      {!done && userTurn && !offBook && expected && mode === 'learn' && (
        <div className="prompt">
          <b>Your move: {expected.san}</b>
          <span>{commentFor(expected, node.fen)}</span>
        </div>
      )}
      {!done && userTurn && !offBook && mode === 'drill' && !mistake && (
        <div className="prompt subtle">
          <b>Your move: play the repertoire move from memory.</b>
          {!peeked && <button className="btn small ghost" onClick={peek}>Peek (breaks the clean run)</button>}
        </div>
      )}
      {fighting && userTurn && mode === 'learn' && fightPre && (
        <div className="prompt subtle">
          <b>Follow the green arrow: {pvToSan(fen, fightPre[0].pv, 1)[0]}</b>
          <span>Plan: {formatLine(fen, pvToSan(fen, fightPre[0].pv, 4))}</span>
        </div>
      )}

      <div className="dock">
        {((offBook && !offBook.answered) || fighting) && (
          <HintBar fen={fen} disabled={!userTurn || thinking} onHint={(_, a) => { setHintArrow(a); setClean(false); }} />
        )}
        {fighting && <button className="chip" onClick={undoFight} disabled={thinking || fight!.fens.length < 2}>↶ Undo</button>}
        {fighting && <button className="chip" onClick={() => { fightId.current++; setFight((f) => f && { ...f, result: { text: '⏭ Fight skipped', won: false } }); }}>⏭ Skip fight</button>}
        {!fight && mode === 'learn' && <button className="chip" onClick={undo} disabled={!path.length}>‹ Back</button>}
        <button className="chip" onClick={() => restart(target)}>↺ Restart</button>
        <select className="select" value={target} onChange={(e) => restart(Number(e.target.value))}>
          {paths.map((l) => <option key={l.index} value={l.index}>{l.trap ? '⚠️ ' : ''}{l.name}</option>)}
        </select>
        <OverlayBar notes={overlay.notes}>
          {mode === 'drill' && (
            <label className="toggle">
              <input type="checkbox" checked={surprises} onChange={(e) => setSurprises(e.target.checked)} /> Surprise moves in the book
            </label>
          )}
        </OverlayBar>
      </div>

      {showResult && (
        <div className={`result card ${fight?.result?.won || (done === 'line' && (clean || mode === 'learn')) ? 'win' : ''}`}>
          {fight?.result && fight.result.text !== '⏭ Fight skipped' && <h3>{fight.result.text}</h3>}
          {done === 'line' && mode === 'drill' && (
            <p>{clean ? `✅ Clean book run. Mastery ${Math.min(lvl, MASTERED)}/${MASTERED}; the line comes back for review later.` : '🔁 The book part had mistakes. Repeat it until you can play it without help.'}</p>
          )}
          {done === 'line' && mode === 'learn' && <p>🎓 Line learned. Now drill it from memory: 3 clean runs, spread over days, mark it mastered.</p>}
          {done === 'surprise' && <p>😮 You handled an off-book surprise. That's where club games are won.</p>}
          <div className="row gap wrap">
            {mode === 'learn' && done === 'line' && <button className="btn primary" onClick={() => go({ name: 'opening-train', id, mode: 'drill', line: target })}>🧠 Drill this line</button>}
            {mode === 'drill' && <button className="btn primary" onClick={() => restart()}>Next line ›</button>}
            <button className="btn" onClick={() => restart(target)}>↺ Again</button>
          </div>
        </div>
      )}

      <CoachFeed items={feed} />
    </div>
  );
}
