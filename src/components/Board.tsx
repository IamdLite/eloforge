import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Chess, type PieceSymbol, type Square } from 'chess.js';
import { PIECES } from '../assets/pieces';
import { BOARD_THEMES } from '../lib/levels';
import type { Arrow, Marker } from '../lib/analysis';
import { useProgress } from '../lib/store';
import type { FinisherId } from '../lib/finishers';
import { Announce, CallOut, FinisherFx, ImpactFx, type Impact } from './CombatFx';
import { combatSfx } from './ui';

export interface BoardMove {
  from: Square;
  to: Square;
  promotion?: PieceSymbol;
}

interface Props {
  fen: string;
  orientation: 'w' | 'b';
  interactive?: boolean;
  onMove?: (m: BoardMove) => void;
  arrows?: Arrow[];
  markers?: Marker[];
  lastMove?: [string, string] | null;
  theme: string;
  flash?: { square: string; kind: 'good' | 'bad' } | null;
  /** checkmate animation to play when this position is mate */
  finisher?: FinisherId;
  /** big round call-out, replayed whenever `key` changes */
  announce?: { text: string; key: string | number } | null;
}

/** A piece with a stable identity across positions, so it can slide, strike and be knocked out. */
interface Sprite {
  id: number;
  key: string;
  sq: Square;
  /** square it moved from in the latest position change */
  from?: Square;
  anim?: 'dash' | 'strike' | 'instant';
  ko?: { dx: number; dy: number };
}

const VALUE: Record<string, number> = { p: 1, n: 2, b: 2, r: 3, q: 4, k: 4 };
const HIT_TEXT = ['', 'HIT!', 'CRUSH!', 'BRUTAL!', 'DEVASTATING!'];
const HIT_COLOR = ['', '#f59e0b', '#f97316', '#ef4444', '#e11d48'];
let spriteSeq = 0;

function piecesOf(chess: Chess) {
  const out: { sq: Square; key: string }[] = [];
  chess.board().forEach((row) => row.forEach((p) => p && out.push({ sq: p.square, key: p.color + p.type.toUpperCase() })));
  return out;
}

const dist = (a: string, b: string) => Math.abs(a.charCodeAt(0) - b.charCodeAt(0)) + Math.abs(Number(a[1]) - Number(b[1]));

/**
 * Match the pieces of the new position to the previous sprites: unchanged squares keep their sprite,
 * moved pieces reuse the nearest sprite of the same kind (a promoted piece reuses its pawn), and
 * leftover old sprites were captured. Big jumps (new puzzle, undo several moves) just reset.
 */
function diffSprites(prev: Sprite[], next: { sq: Square; key: string }[]) {
  const pool = prev.filter((s) => !s.ko);
  const out: Sprite[] = [];
  const todo: { sq: Square; key: string }[] = [];
  for (const n of next) {
    const i = pool.findIndex((s) => s.sq === n.sq && s.key === n.key);
    if (i >= 0) out.push({ ...pool.splice(i, 1)[0], anim: undefined, from: undefined });
    else todo.push(n);
  }
  if (todo.length > 3) return { sprites: next.map((n) => ({ id: ++spriteSeq, ...n })), moved: [] as Sprite[], dead: [] as Sprite[], reset: true };
  const moved: Sprite[] = [];
  for (const n of todo) {
    const same = pool.filter((s) => s.key === n.key);
    const cands = same.length ? same : pool.filter((s) => s.key === n.key[0] + 'P');
    const best = cands.sort((a, b) => dist(a.sq, n.sq) - dist(b.sq, n.sq))[0];
    if (best) {
      pool.splice(pool.indexOf(best), 1);
      const s: Sprite = { ...best, key: n.key, sq: n.sq, anim: 'dash', from: best.sq };
      moved.push(s);
      out.push(s);
    } else out.push({ id: ++spriteSeq, ...n });
  }
  return { sprites: out, moved, dead: pool, reset: false };
}

const FILES = 'abcdefgh';
const MARK_LABEL: Record<string, string> = { isolated: 'I', doubled: 'D', backward: 'B', passed: 'P' };

function squareXY(sq: string, orientation: 'w' | 'b') {
  const f = FILES.indexOf(sq[0]);
  const r = Number(sq[1]) - 1;
  return orientation === 'w' ? { x: f, y: 7 - r } : { x: 7 - f, y: r };
}

function xyToSquare(x: number, y: number, orientation: 'w' | 'b'): Square | null {
  if (x < 0 || x > 7 || y < 0 || y > 7) return null;
  const f = orientation === 'w' ? x : 7 - x;
  const r = orientation === 'w' ? 7 - y : y;
  return (FILES[f] + (r + 1)) as Square;
}

export default function Board({ fen, orientation, interactive, onMove, arrows = [], markers = [], lastMove, theme, flash, finisher, announce }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const settings = useProgress().settings;
  const fx = settings.fx !== false;
  const [selected, setSelected] = useState<Square | null>(null);
  const [drag, setDrag] = useState<{ from: Square; x: number; y: number; active: boolean } | null>(null);
  const [promo, setPromo] = useState<{ from: Square; to: Square } | null>(null);
  const t = BOARD_THEMES.find((b) => b.id === theme) ?? BOARD_THEMES[0];

  const chess = useMemo(() => {
    try {
      return new Chess(fen);
    } catch {
      return new Chess();
    }
  }, [fen]);

  useEffect(() => {
    setSelected(null);
    setPromo(null);
  }, [fen]);

  const targets = useMemo(() => {
    const from = drag?.from ?? selected;
    if (!from) return new Map<string, boolean>();
    const m = new Map<string, boolean>();
    for (const mv of chess.moves({ square: from, verbose: true })) m.set(mv.to, !!mv.captured);
    return m;
  }, [chess, selected, drag?.from]);

  // ── combat layer ──
  const [sprites, setSprites] = useState<Sprite[]>(() => piecesOf(chess).map((n) => ({ id: ++spriteSeq, ...n })));
  const [impacts, setImpacts] = useState<Impact[]>([]);
  const [callout, setCallout] = useState<{ id: number; sq: Square; text: string; kind: 'check' | 'combo' } | null>(null);
  const [shake, setShake] = useState(0);
  const [mateFx, setMateFx] = useState<string | null>(null);
  const [shownAnnounce, setShownAnnounce] = useState<string | number | null>(null);
  const dropped = useRef<Square | null>(null);
  const seenFen = useRef(fen);
  const timers = useRef<number[]>([]);
  const later = (fn: () => void, ms: number) => timers.current.push(window.setTimeout(fn, ms));
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  useLayoutEffect(() => {
    if (seenFen.current === fen) return;
    seenFen.current = fen;
    const { sprites: next, moved, dead, reset } = diffSprites(sprites, piecesOf(chess));
    const drop = dropped.current;
    dropped.current = null;
    setMateFx(null);
    if (reset || !fx) {
      setSprites(next.map((s) => (reset ? s : { ...s, anim: undefined })));
      setImpacts([]);
      setCallout(null);
    } else {
      const victims = dead.filter((d) => d.key[1] !== 'K');
      const attacker = moved.find((m) => victims.some((v) => v.key[0] !== m.key[0]));
      for (const m of moved) if (m.sq === drop) m.anim = 'instant';
      let power = 0;
      const ko: Sprite[] = victims.map((v) => {
        const p = VALUE[v.key[1].toLowerCase()];
        power = Math.max(power, p);
        const a = attacker?.from ? squareXY(attacker.from, orientation) : { x: 0, y: 0 };
        const b = squareXY(v.sq, orientation);
        const dx = Math.sign(b.x - a.x) || (Math.random() < 0.5 ? -1 : 1);
        const dy = Math.sign(b.y - a.y) || -1;
        return { ...v, anim: undefined, ko: { dx, dy } };
      });
      if (attacker && attacker.anim !== 'instant') attacker.anim = 'strike';
      setSprites([...next, ...ko]);
      if (ko.length) {
        later(() => setSprites((cur) => cur.filter((s) => !ko.some((k) => k.id === s.id))), 1100);
        const at = squareXY(ko[0].sq, orientation);
        const id = ++spriteSeq;
        setImpacts((cur) => [...cur.slice(-2), { id, x: at.x, y: at.y, power, text: HIT_TEXT[power], color: HIT_COLOR[power] }]);
        later(() => setImpacts((cur) => cur.filter((i) => i.id !== id)), 1300);
        setShake(0);
        requestAnimationFrame(() => setShake(power));
        later(() => setShake(0), 600);
        if (settings.sound) combatSfx(power >= 3 ? 'heavy' : 'hit');
      } else if (moved.length && settings.sound) combatSfx('whoosh');
      const mated = chess.isCheckmate();
      const kingSq = chess.inCheck() ? next.find((s) => s.key === chess.turn() + 'K')?.sq : undefined;
      if (kingSq && !mated) setCallout({ id: ++spriteSeq, sq: kingSq, text: ko.length ? 'COMBO!' : 'CHECK!', kind: ko.length ? 'combo' : 'check' });
      else setCallout(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fen]);

  // Hold the finisher until the mating piece has landed.
  const isMate = chess.isCheckmate();
  useEffect(() => {
    if (!isMate || !fx || !finisher) return;
    const t = window.setTimeout(() => {
      setMateFx(fen);
      setShake(0);
      if (settings.sound) combatSfx('finisher');
    }, 380);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMate, fen, fx, finisher]);

  useEffect(() => {
    if (!announce || !fx) return;
    setShownAnnounce(announce.key);
    const t = window.setTimeout(() => setShownAnnounce(null), 1350);
    return () => clearTimeout(t);
  }, [announce?.key, fx]);

  const turn = chess.turn();
  const canMovePiece = (sq: Square) => {
    if (!interactive) return false;
    const p = chess.get(sq);
    return !!p && p.color === turn;
  };

  const tryMove = (from: Square, to: Square) => {
    if (!targets.has(to) && !chess.moves({ square: from, verbose: true }).some((m) => m.to === to)) return false;
    const piece = chess.get(from);
    if (piece?.type === 'p' && (to[1] === '8' || to[1] === '1')) {
      setPromo({ from, to });
      return true;
    }
    setSelected(null);
    onMove?.({ from, to });
    return true;
  };

  const pointToSquare = (clientX: number, clientY: number) => {
    const r = ref.current!.getBoundingClientRect();
    const x = Math.floor(((clientX - r.left) / r.width) * 8);
    const y = Math.floor(((clientY - r.top) / r.height) * 8);
    return xyToSquare(x, y, orientation);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!interactive || promo) return;
    const sq = pointToSquare(e.clientX, e.clientY);
    if (!sq) return;
    if (selected && sq !== selected && tryMove(selected, sq)) return;
    if (canMovePiece(sq)) {
      (e.target as Element).setPointerCapture?.(e.pointerId);
      setSelected(sq);
      setDrag({ from: sq, x: e.clientX, y: e.clientY, active: false });
    } else setSelected(null);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const moved = Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 6;
    setDrag({ ...drag, x: e.clientX, y: e.clientY, active: drag.active || moved });
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (!drag) return;
    const sq = pointToSquare(e.clientX, e.clientY);
    const d = drag;
    setDrag(null);
    if (d.active && sq && sq !== d.from) {
      dropped.current = sq;
      if (!tryMove(d.from, sq)) setSelected(null);
    }
  };

  const rect = ref.current?.getBoundingClientRect();
  const dragStyle = drag?.active && rect
    ? { left: drag.x - rect.left - rect.width / 16, top: drag.y - rect.top - rect.height / 16 }
    : null;

  const checkSq = chess.inCheck() ? chess.board().flat().find((p) => p && p.type === 'k' && p.color === turn)?.square : null;
  const showMate = fx && finisher && mateFx === fen && checkSq;
  const mateXY = showMate ? squareXY(checkSq, orientation) : null;

  return (
    <div
      className={`board${fx ? '' : ' no-fx'}${shake ? ' shake' + shake : ''}`}
      ref={ref}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => setDrag(null)}
      style={{ touchAction: 'none' }}
    >
      <svg viewBox="0 0 800 800" className="board-svg">
        {Array.from({ length: 64 }, (_, i) => {
          const x = i % 8, y = Math.floor(i / 8);
          const sq = xyToSquare(x, y, orientation)!;
          const light = (x + y) % 2 === 0;
          return <rect key={sq} x={x * 100} y={y * 100} width={100} height={100} fill={light ? t.light : t.dark} />;
        })}
        {lastMove?.map((s) => {
          const { x, y } = squareXY(s, orientation);
          return <rect key={'lm' + s} x={x * 100} y={y * 100} width={100} height={100} fill="rgba(250,204,21,0.38)" />;
        })}
        {markers.filter((m) => m.kind === 'kingzone').map((m, i) => {
          const { x, y } = squareXY(m.square, orientation);
          return <rect key={'kz' + i} x={x * 100} y={y * 100} width={100} height={100} fill="rgba(239,68,68,0.22)" />;
        })}
        {checkSq && (() => {
          const { x, y } = squareXY(checkSq, orientation);
          return <circle cx={x * 100 + 50} cy={y * 100 + 50} r={48} fill="url(#check)" />;
        })()}
        {selected && (() => {
          const { x, y } = squareXY(selected, orientation);
          return <rect x={x * 100} y={y * 100} width={100} height={100} fill="rgba(56,189,248,0.45)" />;
        })()}
        {flash && (() => {
          const { x, y } = squareXY(flash.square, orientation);
          return <rect className="flash" x={x * 100} y={y * 100} width={100} height={100} fill={flash.kind === 'good' ? 'rgba(34,197,94,0.6)' : 'rgba(239,68,68,0.6)'} />;
        })()}
        {Array.from({ length: 8 }, (_, i) => {
          const fileLabel = orientation === 'w' ? FILES[i] : FILES[7 - i];
          const rankLabel = orientation === 'w' ? 8 - i : i + 1;
          return (
            <g key={'c' + i} className="coord">
              <text x={i * 100 + 92} y={794} textAnchor="end" fill={(i + 7) % 2 === 0 ? t.dark : t.light}>{fileLabel}</text>
              <text x={5} y={i * 100 + 20} fill={i % 2 === 0 ? t.dark : t.light}>{rankLabel}</text>
            </g>
          );
        })}
        <defs>
          <radialGradient id="check">
            <stop offset="0%" stopColor="rgba(239,68,68,1)" />
            <stop offset="60%" stopColor="rgba(239,68,68,0.5)" />
            <stop offset="100%" stopColor="rgba(239,68,68,0)" />
          </radialGradient>
        </defs>
      </svg>

      {sprites.map((p) => {
        const { x, y } = squareXY(p.sq, orientation);
        const hidden = drag?.active && drag.from === p.sq && !p.ko;
        const cls = ['piece', p.anim, p.ko && 'ko', showMate && p.sq === checkSq && !p.ko && 'kingfx-' + finisher, fx && !p.ko && !showMate && p.sq === checkSq && 'checked'];
        return (
          <img
            key={p.id}
            src={PIECES[p.key]}
            className={cls.filter(Boolean).join(' ')}
            draggable={false}
            alt=""
            style={{
              left: `${x * 12.5}%`,
              top: `${y * 12.5}%`,
              opacity: hidden ? 0.25 : undefined,
              ...(p.ko ? { ['--dx' as string]: p.ko.dx, ['--dy' as string]: p.ko.dy } : {}),
            }}
          />
        );
      })}

      <svg viewBox="0 0 800 800" className="board-overlay">
        <defs>
          {['#22c55e', '#ef4444', '#f59e0b', '#38bdf8', '#f97316', '#a855f7'].map((c) => (
            <marker key={c} id={'ah' + c.slice(1)} markerWidth="4" markerHeight="4" refX="2.2" refY="2" orient="auto">
              <path d="M0,0 L4,2 L0,4 z" fill={c} />
            </marker>
          ))}
        </defs>
        {[...targets.entries()].map(([sq, cap]) => {
          const { x, y } = squareXY(sq, orientation);
          return cap
            ? <circle key={'t' + sq} cx={x * 100 + 50} cy={y * 100 + 50} r={44} fill="none" stroke="rgba(15,23,42,0.35)" strokeWidth={9} />
            : <circle key={'t' + sq} cx={x * 100 + 50} cy={y * 100 + 50} r={15} fill="rgba(15,23,42,0.35)" />;
        })}
        {markers.map((m, i) => {
          const { x, y } = squareXY(m.square, orientation);
          if (m.kind === 'hanging') return <circle key={'m' + i} cx={x * 100 + 50} cy={y * 100 + 50} r={45} fill="none" stroke="#ef4444" strokeWidth={6} strokeDasharray="10 6" />;
          if (m.kind === 'outpost') return <rect key={'m' + i} x={x * 100 + 34} y={y * 100 + 34} width={32} height={32} transform={`rotate(45 ${x * 100 + 50} ${y * 100 + 50})`} fill="rgba(56,189,248,0.75)" stroke="#0c4a6e" strokeWidth={3} />;
          if (m.kind === 'kingzone') return null;
          const color = m.kind === 'passed' ? '#16a34a' : '#f59e0b';
          return (
            <g key={'m' + i}>
              <circle cx={x * 100 + 80} cy={y * 100 + 20} r={17} fill={color} stroke="#0f172a" strokeWidth={3} />
              <text x={x * 100 + 80} y={y * 100 + 27} textAnchor="middle" fontSize={21} fontWeight={800} fill="#fff">{MARK_LABEL[m.kind]}</text>
            </g>
          );
        })}
        {arrows.map((a, i) => {
          const s = squareXY(a.from, orientation), e = squareXY(a.to, orientation);
          const x1 = s.x * 100 + 50, y1 = s.y * 100 + 50, x2 = e.x * 100 + 50, y2 = e.y * 100 + 50;
          const len = Math.hypot(x2 - x1, y2 - y1);
          const sh = 30 / len;
          const base = a.color.startsWith('#') ? a.color : '#ef4444';
          return (
            <line
              key={'a' + i}
              x1={x1} y1={y1}
              x2={x2 - (x2 - x1) * sh} y2={y2 - (y2 - y1) * sh}
              stroke={a.color}
              strokeWidth={a.width ?? 16}
              strokeLinecap="round"
              opacity={0.85}
              markerEnd={`url(#ah${base.slice(1)})`}
            />
          );
        })}
      </svg>

      {fx && (
        <div className="fx-layer">
          {impacts.map((i) => <ImpactFx key={i.id} fx={i} />)}
          {callout && (() => {
            const { x, y } = squareXY(callout.sq, orientation);
            return <CallOut key={callout.id} x={x} y={y} text={callout.text} kind={callout.kind} />;
          })()}
        </div>
      )}
      {showMate && mateXY && (
        <FinisherFx key={fen} id={finisher!} x={mateXY.x} y={mateXY.y} kingImg={PIECES[turn + 'K']} defeated={turn === orientation} />
      )}
      {fx && announce && shownAnnounce === announce.key && <Announce key={announce.key} text={announce.text} />}

      {dragStyle && drag && (
        <img src={PIECES[(chess.get(drag.from)!.color) + chess.get(drag.from)!.type.toUpperCase()]} className="piece dragging" style={dragStyle} alt="" />
      )}

      {promo && (
        <div className="promo" onPointerDown={(e) => e.stopPropagation()}>
          {(['q', 'r', 'b', 'n'] as PieceSymbol[]).map((p) => (
            <button
              key={p}
              onClick={() => {
                const { from, to } = promo;
                setPromo(null);
                setSelected(null);
                onMove?.({ from, to, promotion: p });
              }}
            >
              <img src={PIECES[turn + p.toUpperCase()]} alt={p} />
            </button>
          ))}
          <button className="promo-cancel" onClick={() => setPromo(null)}>✕</button>
        </div>
      )}
    </div>
  );
}

/** Arrow colors used across the app */
export const ARROW = {
  move: '#22c55e',
  threat: '#ef4444',
  idea: '#f59e0b',
  magnus: '#38bdf8',
  hikaru: '#f97316',
  plan: '#a855f7',
};
