// Fighting-game style board effects: impact bursts on captures, call-outs, and checkmate finishers.
import { useMemo, type CSSProperties } from 'react';
import { FINISHERS, type FinisherId } from '../lib/finishers';
import './combat.css';

const pct = (n: number) => `${(n + 0.5) * 12.5}%`;
const rand = (a: number, b: number) => a + Math.random() * (b - a);

export interface Impact {
  id: number;
  x: number;
  y: number;
  power: number; // 1 pawn … 4 queen
  text: string;
  color: string;
}

export function ImpactFx({ fx }: { fx: Impact }) {
  const sparks = useMemo(() => Array.from({ length: 8 + fx.power * 3 }, () => ({ a: rand(0, 360), d: rand(40, 80 + fx.power * 30), s: rand(4, 9) })), [fx]);
  return (
    <div className={`fx-impact p${fx.power}`} style={{ left: pct(fx.x), top: pct(fx.y), ['--c' as string]: fx.color, ['--tx' as string]: fx.x < 2 ? '-22%' : fx.x > 5 ? '-78%' : '-50%' }}>
      <div className="fx-burst" />
      <div className="fx-ring" />
      {sparks.map((s, i) => (
        <i key={i} className="fx-spark" style={{ ['--a' as string]: `${s.a}deg`, ['--d' as string]: `${s.d}px`, width: s.s, height: s.s }} />
      ))}
      {fx.text && <div className="fx-text">{fx.text}</div>}
    </div>
  );
}

export function CallOut({ x, y, text, kind }: { x: number; y: number; text: string; kind: 'check' | 'combo' | 'brilliant' }) {
  // Clamped so long call-outs near the edge stay on the board.
  return <div className={`fx-callout ${kind}`} style={{ left: `clamp(24%, ${pct(x)}, 76%)`, top: `max(19%, ${pct(y)})` }}>{text}</div>;
}

export type ShotKind = 'gun' | 'cannon' | 'beam';

export interface Shot {
  id: number;
  kind: ShotKind;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** Ranged signature attacks: the bishop draws a pistol, the rook fires a cannon, the queen charges a beam. */
export function ShotFx({ fx }: { fx: Shot }) {
  const dx = fx.x2 - fx.x1;
  const dy = fx.y2 - fx.y1;
  const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
  const style = {
    left: pct(fx.x1),
    top: pct(fx.y1),
    transform: `rotate(${ang}deg)`,
    ['--len' as string]: `${Math.hypot(dx, dy) * 12.5}cqw`,
    ['--flip' as string]: Math.abs(ang) > 90 ? -1 : 1,
  } as CSSProperties;
  return (
    <div className={`shot shot-${fx.kind}`} style={style}>
      {fx.kind === 'gun' && (
        <>
          <svg className="gun" viewBox="0 0 64 40">
            <path d="M14 6h46a3 3 0 0 1 3 3v6a2 2 0 0 1-2 2H30l-2 4h-6l-2 17H8l4-21-2-1V9a3 3 0 0 1 4-3z" fill="#1f2937" stroke="#9ca3af" strokeWidth="1.5" />
            <path d="M22 21h6l-1 6h-7" fill="none" stroke="#9ca3af" strokeWidth="1.5" />
            <rect x="16" y="8" width="44" height="2.5" fill="#6b7280" />
          </svg>
          <i className="muzzle" />
          <i className="bullet" />
        </>
      )}
      {fx.kind === 'cannon' && (
        <>
          <i className="barrel" />
          <i className="smoke" />
          <i className="ball" />
        </>
      )}
      {fx.kind === 'beam' && (
        <>
          <i className="charge" />
          <i className="beam" />
        </>
      )}
    </div>
  );
}

export function Announce({ text }: { text: string }) {
  return (
    <div className="fx-announce">
      <span>{text}</span>
    </div>
  );
}

interface FinisherProps {
  id: FinisherId;
  x: number;
  y: number;
  kingImg: string;
  /** true when the side at the bottom of the board got mated */
  defeated: boolean;
}

export function FinisherFx({ id, x, y, kingImg, defeated }: FinisherProps) {
  const f = FINISHERS[id];
  const style = { ['--kx' as string]: pct(x), ['--ky' as string]: pct(y), ['--fc' as string]: f.color } as CSSProperties;
  const parts = useMemo(() => ({
    flames: Array.from({ length: 18 }, () => ({ dx: rand(-60, 60), delay: rand(0.2, 1.4), s: rand(26, 60), dur: rand(0.7, 1.3) })),
    ash: Array.from({ length: 22 }, () => ({ dx: rand(-50, 50), dy: rand(-90, -20), delay: rand(1.2, 1.8) })),
    shards: Array.from({ length: 12 }, (_, i) => {
      const a = (i / 12) * Math.PI * 2;
      const b = ((i + 1) / 12) * Math.PI * 2;
      return {
        clip: `polygon(50% 50%, ${50 + 70 * Math.cos(a)}% ${50 + 70 * Math.sin(a)}%, ${50 + 70 * Math.cos(b)}% ${50 + 70 * Math.sin(b)}%)`,
        tx: Math.cos((a + b) / 2) * rand(90, 170),
        ty: Math.sin((a + b) / 2) * rand(90, 170) + 40,
        r: rand(-300, 300),
      };
    }),
    bubbles: Array.from({ length: 16 }, () => ({ dx: rand(-45, 45), delay: rand(0.2, 1.6), s: rand(8, 22) })),
    debris: Array.from({ length: 16 }, () => ({ a: rand(0, 360), d: rand(60, 160), r: rand(-400, 400) })),
    cracks: Array.from({ length: 7 }, (_, i) => {
      let px = 0, py = 0;
      const ang = (i / 7) * Math.PI * 2 + rand(-0.3, 0.3);
      const pts = ['0,0'];
      for (let k = 1; k <= 5; k++) {
        px = Math.cos(ang) * k * 60 + rand(-14, 14);
        py = Math.sin(ang) * k * 60 + rand(-14, 14);
        pts.push(`${px.toFixed(0)},${py.toFixed(0)}`);
      }
      return pts.join(' ');
    }),
    bolts: Array.from({ length: 3 }, (_, i) => {
      const startX = rand(-120, 120);
      const pts = [`${startX},-900`];
      for (let k = 1; k < 7; k++) pts.push(`${(startX * (1 - k / 7) + rand(-35, 35)).toFixed(0)},${(-900 + k * 128).toFixed(0)}`);
      pts.push('0,0');
      return { pts: pts.join(' '), delay: 0.25 + i * 0.28 };
    }),
  }), []);

  return (
    <div className={`fin fin-${id}`} style={style}>
      <div className="fin-dim" />

      {id === 'inferno' && (
        <div className="fin-at">
          {parts.flames.map((p, i) => <i key={i} className="flame" style={{ ['--dx' as string]: `${p.dx}px`, animationDelay: `${p.delay}s`, animationDuration: `${p.dur}s`, width: p.s, height: p.s * 1.5 }} />)}
          {parts.ash.map((p, i) => <i key={'a' + i} className="ash" style={{ ['--dx' as string]: `${p.dx}px`, ['--dy' as string]: `${p.dy}px`, animationDelay: `${p.delay}s` }} />)}
        </div>
      )}

      {id === 'glacier' && (
        <>
          <div className="frost" />
          <div className="fin-at">
            {parts.shards.map((s, i) => (
              <img key={i} src={kingImg} className="shard" alt="" style={{ clipPath: s.clip, ['--tx' as string]: `${s.tx}px`, ['--ty' as string]: `${s.ty}px`, ['--r' as string]: `${s.r}deg` }} />
            ))}
          </div>
        </>
      )}

      {id === 'thunder' && (
        <>
          <div className="flashes" />
          <svg className="fin-at bolts" viewBox="-200 -900 400 920" preserveAspectRatio="none">
            {parts.bolts.map((b, i) => <polyline key={i} points={b.pts} style={{ animationDelay: `${b.delay}s` }} />)}
          </svg>
          <div className="fin-at"><i className="zap-glow" /></div>
        </>
      )}

      {id === 'vortex' && (
        <div className="fin-at"><i className="vortex" /><i className="vortex v2" /></div>
      )}

      {id === 'blade' && (
        <>
          <div className="fin-at">
            <i className="slash s1" />
            <i className="slash s2" />
            <img src={kingImg} className="half left" alt="" />
            <img src={kingImg} className="half right" alt="" />
          </div>
          <div className="red-flash" />
        </>
      )}

      {id === 'meteor' && (
        <div className="fin-at">
          <i className="meteor" />
          <i className="boom" />
          <i className="crater" />
          {parts.debris.map((d, i) => <i key={i} className="debris" style={{ ['--a' as string]: `${d.a}deg`, ['--d' as string]: `${d.d}px`, ['--r' as string]: `${d.r}deg` }} />)}
        </div>
      )}

      {id === 'venom' && (
        <div className="fin-at">
          <i className="puddle" />
          {parts.bubbles.map((b, i) => <i key={i} className="bubble" style={{ ['--dx' as string]: `${b.dx}px`, animationDelay: `${b.delay}s`, width: b.s, height: b.s }} />)}
        </div>
      )}

      {id === 'quake' && (
        <svg className="fin-at cracks" viewBox="-320 -320 640 640">
          {parts.cracks.map((c, i) => <polyline key={i} points={c} style={{ animationDelay: `${0.2 + i * 0.06}s` }} />)}
        </svg>
      )}

      <div className="fin-title">
        <div className="fin-name">{f.icon} {f.name}</div>
        <div className="fin-sub">{defeated ? 'YOU HAVE BEEN FINISHED' : 'CHECKMATE'}</div>
      </div>
    </div>
  );
}

const PIECE_NAME: Record<string, string> = { Q: 'QUEEN', R: 'ROOK', B: 'BISHOP', N: 'KNIGHT' };

/** Pawn promotion as a summoning: magic circle, light rays, the silhouette flickers pawn ⇄ piece, then a flash reveals it. */
export function EvolveFx({ x, y, from, to, piece }: { x: number; y: number; from: string; to: string; piece: string }) {
  // Promotion squares sit on the edge, so the summoning happens a little toward the center.
  const style = { ['--kx' as string]: `clamp(30%, ${pct(x)}, 70%)`, ['--ky' as string]: `clamp(34%, ${pct(y)}, 66%)` } as CSSProperties;
  const sparks = useMemo(() => Array.from({ length: 18 }, () => ({ a: rand(0, 360), d: rand(50, 140), s: rand(4, 9), delay: rand(1.6, 1.9) })), []);
  return (
    <div className="evo" style={style}>
      <div className="evo-dim" />
      <div className="fin-at">
        <i className="evo-rays" />
        <svg className="evo-circle" viewBox="-100 -100 200 200">
          <circle r="92" />
          <circle r="80" className="thin" />
          <circle r="56" className="thin" />
          <polygon points="0,-80 69,40 -69,40" />
          <polygon points="0,80 69,-40 -69,-40" />
          {Array.from({ length: 12 }, (_, i) => {
            const a = (i / 12) * Math.PI * 2;
            return <circle key={i} cx={Math.cos(a) * 86} cy={Math.sin(a) * 86} r="4" className="rune" />;
          })}
        </svg>
        <div className="evo-sprite">
          <img src={from} className="evo-a" alt="" />
          <img src={to} className="evo-b" alt="" />
        </div>
        {sparks.map((s, i) => (
          <i key={i} className="evo-spark" style={{ ['--a' as string]: `${s.a}deg`, ['--d' as string]: `${s.d}px`, width: s.s, height: s.s, animationDelay: `${s.delay}s` }} />
        ))}
      </div>
      <div className="evo-flash" />
      <div className="evo-title">
        <div className="evo-name">ASCENSION!</div>
        <div className="evo-sub">PAWN ➜ {PIECE_NAME[piece] ?? piece}</div>
      </div>
    </div>
  );
}
