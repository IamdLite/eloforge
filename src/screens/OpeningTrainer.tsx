import { useEffect, useMemo, useState } from 'react';
import { Chess } from 'chess.js';
import { useNav } from '../App';
import { finisherFor } from '../lib/finishers';
import Board, { ARROW, type BoardMove } from '../components/Board';
import { CoachFeed, HintBar, OverlayBar, nextFeedId, blunderSting, useAnnouncer, useOverlay, useSfx, type FeedItem } from '../components/ui';
import { openingById } from '../data/openings';
import { START_FEN, buildTree, lineId, type LinePath, type OpeningDef } from '../lib/tree';
import { EXAM_MISTAKES, MASTERED, actions, getProgress, useProgress } from '../lib/store';
import { engine, winPct } from '../lib/engine';
import { lineScore } from '../lib/bot';
import { allPaths, buildScript, pathKey, useContinuations, type Cont } from '../lib/continuation';
import type { Arrow } from '../lib/analysis';

/**
 * Every line is played all the way to checkmate, in three stages:
 *  1. guided: arrows and explanations for every move; each run takes the next variation of natural replies, in order
 *  2. from memory: the same game again, no help
 *  3. final exam: a random variation (or combination of them); mate with at most EXAM_MISTAKES mistakes masters the line
 */
type Stage = 1 | 2 | 3;
const STAGES: Record<Stage, { icon: string; name: string }> = {
  1: { icon: '🎓', name: 'Guided' },
  2: { icon: '🧠', name: 'From memory' },
  3: { icon: '🏆', name: 'Final exam' },
};

interface Run {
  n: number;
  target: number;
  stage: Stage;
  choices: number[];
}

const nextStage = (lvl: number): Stage => (lvl <= 0 ? 1 : lvl === 1 ? 2 : 3);

function plan(op: OpeningDef, paths: LinePath[], conts: Record<string, Cont | null> | null, mode: 'learn' | 'drill', want: Partial<Run> & { n: number }): Run {
  const p = getProgress();
  const stat = (i: number) => p.lines[lineId(op.id, i)];
  let target = want.target;
  if (target === undefined) {
    // The least advanced line first; lines waiting for their next stage or review get priority.
    const now = Date.now();
    const scored = paths.map((l) => {
      const s = stat(l.index);
      return { i: l.index, key: (s?.lvl ?? -1) * 10 + (s && s.due <= now && s.lvl < MASTERED ? -10 : 0) + Math.random() };
    });
    target = scored.sort((a, b) => a.key - b.key)[0].i;
  }
  const s = stat(target);
  const stage = want.stage ?? (mode === 'learn' ? 1 : nextStage(s?.lvl ?? 0));
  const all = allPaths(conts?.[target]);
  let choices = want.choices;
  if (!choices) {
    // Guided games walk through the variations in order; only the exam picks one at random.
    if (stage === 1) choices = all[(all.findIndex((c) => s?.path && pathKey(c) === pathKey(s.path)) + 1) % all.length];
    else if (stage === 2) choices = s?.path && all.some((c) => pathKey(c) === pathKey(s.path!)) ? s.path : all[0];
    else choices = all[Math.floor(Math.random() * all.length)];
  }
  return { n: want.n, target, stage, choices };
}

export default function OpeningTrainer({ id, mode, line }: { id: string; mode: 'learn' | 'drill'; line?: number }) {
  const op = openingById(id)!;
  const { paths } = useMemo(() => buildTree(op), [op]);
  const conts = useContinuations(op.id);
  const [run, setRun] = useState<Run | null>(null);
  useEffect(() => {
    if (conts !== undefined && !run) setRun(plan(op, paths, conts, mode, { n: 1, target: line }));
  }, [conts]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!run || conts === undefined) {
    return (
      <div className="trainer">
        <div className="trainer-head"><div><div className="eyebrow">{op.name}</div><b>Loading the lines…</b></div></div>
      </div>
    );
  }
  return (
    <Session
      key={run.n}
      op={op}
      paths={paths}
      cont={conts?.[run.target] ?? null}
      run={run}
      begin={(want) => setRun(plan(op, paths, conts, mode, { ...want, n: run.n + 1 }))}
    />
  );
}

function Session({ op, paths, cont, run, begin }: {
  op: OpeningDef;
  paths: LinePath[];
  cont: Cont | null;
  run: Run;
  begin: (want: Partial<Run>) => void;
}) {
  const p = useProgress();
  const { back } = useNav();
  const sfx = useSfx();
  const side = op.side;
  const { target, stage, choices } = run;
  const tline = paths[target];
  const script = useMemo(() => buildScript(tline, cont, choices), [tline, cont, choices]);
  const variations = allPaths(cont).length;
  const variation = allPaths(cont).findIndex((c) => pathKey(c) === pathKey(choices)) + 1;
  const bookLen = tline.nodes.length;

  const [ply, setPly] = useState(0);
  const [mistakes, setMistakes] = useState(0);
  const passed = stage === 3 ? mistakes <= EXAM_MISTAKES : mistakes === 0;
  const [showMove, setShowMove] = useState(false);
  const [done, setDone] = useState(false);
  const [finalAlt, setFinalAlt] = useState<{ fen: string; last: [string, string]; san: string } | null>(null);
  const [flash, setFlash] = useState<{ square: string; kind: 'good' | 'bad' } | null>(null);
  const [hintArrow, setHintArrow] = useState<Arrow | null>(null);
  const announcer = useAnnouncer();
  const [feed, setFeed] = useState<FeedItem[]>(() => [{
    id: nextFeedId(),
    who: 'coach',
    text: stage === 1
      ? `${op.name}: ${op.summary} Follow the arrows through the opening and on to checkmate.`
      : stage === 2
        ? 'Stage 2: replay the game you were guided through, from memory. Same opponent moves, no arrows.'
        : `Final exam: your opponent picks a random variation${variations > 1 ? ` (${variations} possible)` : ''}. Play it to mate with at most ${EXAM_MISTAKES} mistakes to master the line.`,
  }]);

  const fen = finalAlt?.fen ?? (ply ? script[ply - 1].fen : START_FEN);
  const lastMove: [string, string] | null = finalAlt?.last ?? (ply ? [script[ply - 1].from, script[ply - 1].to] : null);
  const userTurn = new Chess(fen).turn() === side;
  const expected = done ? undefined : script[ply];
  const inBook = ply < bookLen;
  const overlay = useOverlay(fen);
  const lvl = p.lines[lineId(op.id, target)]?.lvl ?? 0;

  const push = (it: Omit<FeedItem, 'id'>) => setFeed((f) => [...f, { ...it, id: nextFeedId() }]);

  const advance = (who: 'you' | 'opp') => {
    const s = script[ply];
    sfx(s.san.includes('x') ? 'capture' : 'move');
    let text = s.comment;
    if (who === 'opp' && s.alts?.length) {
      text = stage === 1
        ? `${text} (A natural alternative here is ${s.alts.join(' or ')}; the final exam may throw it at you.)`
        : `${text} (Variation: not ${s.alts.join(' or ')} this time.)`;
    }
    push({ who, san: s.san, verdict: s.book ? 'book' : who === 'you' ? 'best' : undefined, text });
    setPly(ply + 1);
    setShowMove(false);
    setHintArrow(null);
  };

  // The opponent replies from the script.
  useEffect(() => {
    if (done || userTurn || ply >= script.length) return;
    const t = setTimeout(() => advance('opp'), inBook ? 650 : 550);
    return () => clearTimeout(t);
  }, [ply, done]); // eslint-disable-line react-hooks/exhaustive-deps

  // Out of the book: the fight to checkmate starts. Near the end, the announcer calls for the kill.
  useEffect(() => {
    if (ply === bookLen && bookLen < script.length) {
      announcer.rearm();
      announcer.call('FIGHT!');
      push({ who: 'coach', text: `⚔️ The book ends here. Now convert it: play on to checkmate against natural replies${stage === 1 ? '. Keep following the arrows.' : ', from memory.'}` });
    }
    if (!inBook && userTurn && !done) announcer.report(Math.ceil((script.length - ply) / 2));
  }, [ply]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reached the end of the script: record the stage.
  useEffect(() => {
    if (done || !script.length || ply < script.length) return;
    setDone(true);
    actions.stage(lineId(op.id, target), stage, mistakes, choices, pathKey(choices));
    sfx(passed ? 'good' : 'bad');
  }, [ply]); // eslint-disable-line react-hooks/exhaustive-deps

  const onMove = (mv: BoardMove) => {
    if (done || !userTurn || !expected) return;
    const c = new Chess(fen);
    let m;
    try {
      m = c.move(mv);
    } catch {
      return;
    }
    if (m.lan === expected.uci) {
      setFlash({ square: m.to, kind: 'good' });
      advance('you');
      return;
    }
    // Any checkmate counts on the final move.
    if (ply === script.length - 1 && c.isCheckmate()) {
      setFlash({ square: m.to, kind: 'good' });
      sfx('capture');
      push({ who: 'you', san: m.san, verdict: 'best', text: `Checkmate! (The trained finish was ${expected.san}, but mate is mate.)` });
      setFinalAlt({ fen: c.fen(), last: [m.from, m.to], san: m.san });
      setPly(ply + 1);
      return;
    }
    setFlash({ square: m.to, kind: 'bad' });
    sfx('bad');
    if (stage === 1) {
      push({ who: 'coach', text: `Follow the green arrow: play ${expected.san}.` });
      return;
    }
    setMistakes((x) => x + 1);
    setShowMove(true);
    const what = expected.book ? 'repertoire move' : 'winning plan';
    push({
      who: 'coach',
      verdict: 'mistake',
      san: m.san,
      text: `Not the ${what} you trained. It was ${expected.san}: ${expected.comment} Play it to continue.${stage === 3 ? (mistakes < EXAM_MISTAKES ? ` Mistake ${mistakes + 1} of ${EXAM_MISTAKES} allowed.` : mistakes === EXAM_MISTAKES ? ` That's more than ${EXAM_MISTAKES} mistakes: finish the game to learn it, then try again.` : '') : ''}`,
    });
    if (!expected.book && !mistakes && c.moves().length) {
      // Was it at least a reasonable idea?
      void Promise.all([engine.analyse(fen, { depth: 11 }), engine.analyse(c.fen(), { depth: 11 })]).then(([bl, al]) => {
        const drop = winPct(lineScore(bl[0])) - winPct(-lineScore(al[0]));
        if (drop > 25) blunderSting();
        push({ who: 'coach', text: drop < 6 ? `(${m.san} is playable too, but replay the trained move to master the line.)` : `(${m.san} would cost about ${Math.round(drop)}% winning chances.)` });
      }).catch(() => {});
    }
  };

  const stepBack = () => {
    // Back to the previous position where it's your move.
    const to = Math.max(0, ply - (userTurn ? 2 : 1));
    setPly(to);
    setShowMove(false);
  };

  const peek = () => {
    setShowMove(true);
    if (stage > 1) setMistakes((x) => x + 1);
  };

  const arrows: Arrow[] = [...overlay.arrows];
  if (userTurn && expected && (stage === 1 || showMove)) {
    arrows.push({ from: expected.from, to: expected.to, color: ARROW.move });
    if (stage === 1) expected.arrows.forEach(([a, b]) => arrows.push({ from: a, to: b, color: ARROW.idea, width: 10 }));
  }
  if (stage === 1 && !userTurn && ply > 0) script[ply - 1].arrows.forEach(([a, b]) => arrows.push({ from: a, to: b, color: ARROW.idea, width: 10 }));
  if (hintArrow) arrows.push(hintArrow);

  const sans = [...script.slice(0, ply - (finalAlt ? 1 : 0)).map((s) => s.san), ...(finalAlt ? [finalAlt.san] : [])];
  const moves = sans.map((x, i) => (i % 2 === 0 ? `${i / 2 + 1}.${x}` : x)).join(' ');
  const mated = new Chess(fen).isCheckmate();
  const learnerMoves = Math.ceil((script.length - (side === 'w' ? 0 : 1)) / 2);
  const myMovesPlayed = Math.ceil((ply - (side === 'w' ? 0 : 1)) / 2);
  const unlocked = Math.min(3, lvl + 1) as Stage;

  return (
    <div className="trainer">
      <div className="trainer-head">
        <button className="back" onClick={back}>‹</button>
        <div>
          <div className="eyebrow">{STAGES[stage].icon} Stage {stage}: {STAGES[stage].name} · {op.name}</div>
          <b>{inBook ? <>{tline.trap && '⚠️ '}{tline.name}</> : done ? (mated ? '🏆 Checkmate!' : '🏁 Line complete') : '⚔️ Convert to checkmate'}</b>
          <small className="muted stage-meta">
            {' '}move {Math.max(0, Math.min(myMovesPlayed, learnerMoves))}/{learnerMoves}
            {variations > 1 && ` · variation ${variation}/${variations}`}
            {stage === 2 && ` · ${mistakes ? `${mistakes} mistake${mistakes > 1 ? 's' : ''}` : 'clean'}`}
            {stage === 3 && ` · ${mistakes}/${EXAM_MISTAKES} mistakes`}
          </small>
        </div>
        <div className="dots">{Array.from({ length: MASTERED }, (_, i) => <span key={i} className={`dot ${i < lvl ? 'on' : ''}`} />)}</div>
      </div>

      <Board
        fen={fen}
        orientation={side}
        interactive={!done && userTurn}
        onMove={onMove}
        arrows={arrows}
        markers={overlay.markers}
        lastMove={lastMove}
        theme={p.theme}
        flash={flash}
        finisher={finisherFor(op.id)}
        announce={announcer.announce}
      />

      <div className="movelist" ref={(el) => el && (el.scrollLeft = el.scrollWidth)}>{moves || 'Starting position'}</div>

      {!done && userTurn && expected && stage === 1 && (
        <div className="prompt">
          <b>Your move: {expected.san}</b>
          <span>{expected.comment}</span>
        </div>
      )}
      {!done && userTurn && expected && stage > 1 && (
        <div className="prompt subtle">
          <b>{showMove ? `Play ${expected.san} to continue.` : inBook ? 'Your move: the repertoire move, from memory.' : 'Your move: the winning plan, from memory.'}</b>
          {!showMove && <button className="btn small ghost" onClick={peek}>Peek (counts as a mistake)</button>}
        </div>
      )}

      <div className="dock">
        {!done && (
          <HintBar
            fen={fen}
            disabled={!userTurn || !expected}
            override={expected?.uci}
            onHint={(_, a) => {
              setHintArrow(a);
              if (stage > 1) setMistakes((x) => x + 1);
            }}
          />
        )}
        {stage === 1 && !done && <button className="chip" onClick={stepBack} disabled={ply < 2}>‹ Back</button>}
        <button className="chip" onClick={() => begin({ target, stage, choices: stage === 3 ? undefined : choices })}>↺ Restart</button>
        <select className="select" value={stage} onChange={(e) => begin({ target, stage: Number(e.target.value) as Stage })}>
          {([1, 2, 3] as Stage[]).map((s) => <option key={s} value={s} disabled={s > unlocked}>{STAGES[s].icon} Stage {s}{s > unlocked ? ' 🔒' : ''}</option>)}
        </select>
        <select className="select" value={target} onChange={(e) => begin({ target: Number(e.target.value) })}>
          {paths.map((l) => <option key={l.index} value={l.index}>{l.trap ? '⚠️ ' : ''}{l.name}</option>)}
        </select>
        <OverlayBar notes={overlay.notes} />
      </div>

      {done && (
        <div className={`result card ${passed ? 'win' : ''}`}>
          {stage === 1 && (
            <>
              <h3>🎓 Guided game complete</h3>
              <p>{variation < variations
                ? `Your opponent can also answer differently: variation ${variation + 1} of ${variations} is next. Or go to stage 2 and replay this exact game from memory.`
                : 'Stage 2: replay this exact game from memory, with the same replies and no arrows.'}</p>
            </>
          )}
          {stage === 2 && (mistakes === 0
            ? <><h3>🧠 Replayed from memory!</h3><p>Final stage: your opponent picks a random variation. Play it to mate with at most {EXAM_MISTAKES} mistakes to master the line.</p></>
            : <><h3>🔁 {mistakes} mistake{mistakes > 1 ? 's' : ''}</h3><p>Stage 2 needs a clean replay. Go again, or walk through it guided once more.</p></>)}
          {stage === 3 && (passed
            ? <><h3>🏆 Line mastered!</h3><p>{mistakes ? `Checkmate with ${mistakes} mistake${mistakes > 1 ? 's' : ''} (${EXAM_MISTAKES} allowed).` : 'A perfect game from the opening to checkmate.'} It comes back for a quick review in a week.</p></>
            : <><h3>❌ {mistakes} mistakes: not yet</h3><p>The exam allows {EXAM_MISTAKES} mistakes. Study this variation guided, or retry the exam with a new random variation.</p></>)}
          <div className="row gap wrap">
            {stage === 1 && variation < variations && <button className="btn primary" onClick={() => begin({ target, stage: 1 })}>🎓 Variation {variation + 1}/{variations} ›</button>}
            {stage === 1 && <button className={`btn ${variation < variations ? '' : 'primary'}`} onClick={() => begin({ target, stage: 2, choices })}>🧠 Stage 2 ›</button>}
            {stage === 2 && mistakes === 0 && <button className="btn primary" onClick={() => begin({ target, stage: 3 })}>🏆 Final exam ›</button>}
            {stage === 2 && mistakes > 0 && <button className="btn primary" onClick={() => begin({ target, stage: 2, choices })}>↺ Replay</button>}
            {stage === 3 && passed && <button className="btn primary" onClick={() => begin({ stage: undefined, target: undefined })}>Next line ›</button>}
            {stage === 3 && !passed && <button className="btn primary" onClick={() => begin({ target, stage: 3 })}>↺ Retry exam</button>}
            {stage > 1 && !passed && <button className="btn" onClick={() => begin({ target, stage: 1, choices })}>🎓 Guided</button>}
            {stage === 1 && <button className="btn" onClick={() => begin({ target, stage: 1, choices })}>↺ Again</button>}
          </div>
        </div>
      )}

      <CoachFeed items={feed} />
    </div>
  );
}
