import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { shout } from '../lib/announcer';
import { Chess } from 'chess.js';
import { computeOverlay, type Arrow, type Marker, type OverlayOptions } from '../lib/analysis';
import { actions, useProgress } from '../lib/store';
import { PERSONAS, personaHint, type Persona, type PersonaHint } from '../lib/personas';
import { VERDICT_LABEL, type Verdict } from '../lib/commentary';
import { formatScore } from '../lib/engine';
import { ARROW } from './Board';

export function ProgressBar({ value, max, color }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className="pbar">
      <div className="pbar-fill" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

export function EvalBar({ cp, orientation }: { cp: number | null; orientation: 'w' | 'b' }) {
  const v = cp ?? 0;
  const clamped = Math.max(-800, Math.min(800, Math.abs(v) >= 9000 ? Math.sign(v) * 800 : v));
  const whitePct = 50 + (clamped / 800) * 50;
  return (
    <div className={`evalbar ${orientation === 'b' ? 'flip' : ''}`} title="Engine evaluation">
      <div className="evalbar-white" style={{ height: `${whitePct}%` }} />
      <span className="evalbar-label" style={{ color: v >= 0 ? '#0f172a' : '#e2e8f0' }}>{cp === null ? '…' : formatScore(v)}</span>
    </div>
  );
}

/** Overlay markers/arrows for the current position, from the user's overlay settings. */
export function useOverlay(fen: string): { markers: Marker[]; arrows: Arrow[]; notes: Marker[] } {
  const p = useProgress();
  const o = p.settings.overlays;
  return useMemo(() => {
    try {
      const { markers, arrows } = computeOverlay(fen, o);
      const notes = markers.filter((m) => m.kind !== 'kingzone');
      return { markers, arrows, notes };
    } catch {
      return { markers: [], arrows: [], notes: [] };
    }
  }, [fen, o]);
}

const OVERLAY_LABELS: [keyof OverlayOptions, string, string][] = [
  ['hanging', '🎯', 'Threats'],
  ['pawns', '♟', 'Pawns'],
  ['outposts', '◆', 'Outposts'],
  ['king', '👑', 'King safety'],
];

/** One "🔍 Tools" chip; tap to open overlay toggles (plus any extra controls) and the "why" notes. */
export function OverlayBar({ notes, children }: { notes: Marker[]; children?: ReactNode }) {
  const p = useProgress();
  const [open, setOpen] = useState(false);
  const active = OVERLAY_LABELS.filter(([k]) => p.settings.overlays[k]).length;
  return (
    <>
      <button className={`chip${open ? ' on' : ''}`} onClick={() => setOpen(!open)}>
        🔍 Tools{active ? ` · ${active}` : ''}{notes.length ? ` · ${notes.length} notes` : ''}
      </button>
      {open && (
        <div className="dock-panel">
          <div className="chips">
            {OVERLAY_LABELS.map(([k, icon, label]) => (
              <button key={k} className={`chip ${p.settings.overlays[k] ? 'on' : ''}`} onClick={() => actions.setOverlay(k, !p.settings.overlays[k])}>
                <span>{icon}</span> {label}
              </button>
            ))}
          </div>
          {children && <div className="chips">{children}</div>}
          {notes.length > 0 && (
            <ul className="notes">
              {notes.slice(0, 6).map((n, i) => (
                <li key={i} className={`note note-${n.kind}`}>
                  <b>{n.square}</b> {n.note}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </>
  );
}

export interface FeedItem {
  id: number;
  who: 'you' | 'opp' | 'coach' | 'magnus' | 'hikaru';
  san?: string;
  verdict?: Verdict;
  text: string;
}

function FeedLine({ it }: { it: FeedItem }) {
  return (
    <>
      {it.san && <span className="feed-san">{it.san}</span>}
      {it.verdict && <span className={`verdict ${VERDICT_LABEL[it.verdict].cls}`}>{VERDICT_LABEL[it.verdict].icon} {VERDICT_LABEL[it.verdict].label}</span>}
      <span className="feed-text">{it.text}</span>
    </>
  );
}

/**
 * Live commentary, tucked into a floating bubble: new comments pop up briefly as a speech bubble,
 * and tapping the bubble opens the full feed.
 */
export function CoachFeed({ items, title = 'Live commentary' }: { items: FeedItem[]; title?: string }) {
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(0);
  const [toast, setToast] = useState<FeedItem | null>(null);
  const shown = useRef<number | undefined>(undefined);
  const body = useRef<HTMLDivElement>(null);
  const last = items[items.length - 1];

  useEffect(() => {
    if (!last || last.id === shown.current) return;
    shown.current = last.id;
    if (open) return;
    setToast(last);
    const t = setTimeout(() => setToast(null), Math.min(9000, 3500 + last.text.length * 35));
    return () => clearTimeout(t);
  }, [last, open]);
  useEffect(() => {
    if (!open) return;
    setSeen(items.length);
    setToast(null);
    body.current?.scrollTo({ top: body.current.scrollHeight });
  }, [open, items.length]);

  const unread = Math.max(0, items.length - seen);
  return (
    <>
      {toast && !open && (
        <button className={`coach-toast who-${toast.who}`} onClick={() => setOpen(true)}>
          <FeedLine it={toast} />
        </button>
      )}
      <button className={`coach-fab${unread ? ' has-unread' : ''}`} onClick={() => setOpen(!open)} aria-label={title}>
        🎙️{unread > 0 && <span className="badge">{unread}</span>}
      </button>
      {open && (
        <div className="sheet-bg" onClick={() => setOpen(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-head">
              <b>🎙️ {title}</b>
              <button className="btn small ghost" onClick={() => setOpen(false)}>✕</button>
            </div>
            <div className="feed-body" ref={body}>
              {items.length === 0 && <div className="feed-empty">Commentary appears here as moves are played.</div>}
              {items.map((it) => (
                <div key={it.id} className={`feed-item who-${it.who}`}>
                  <FeedLine it={it} />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export type BoardAnnounce = { text: string; key: string | number } | null;

/** Big board call-outs. `report(mate)` shouts "FINISH IT!" once a short forced mate appears, and re-arms if it is lost. */
export function useAnnouncer() {
  const armed = useRef(true);
  const [announce, setAnnounce] = useState<BoardAnnounce>(null);
  const report = (mate: number | undefined, maxMoves = 3) => {
    if (mate !== undefined && mate > 0 && mate <= maxMoves) {
      if (armed.current) {
        armed.current = false;
        setAnnounce({ text: 'FINISH IT!', key: Date.now() });
      }
    } else armed.current = true;
  };
  const call = (text: string) => setAnnounce({ text, key: Date.now() });
  return { announce, report, call, rearm: () => (armed.current = true) };
}

let feedId = 1;
export const nextFeedId = () => feedId++;

/** "What would Magnus / Hikaru do?" buttons + result card. */
export function HintBar({ fen, disabled, onHint, override }: {
  fen: string;
  disabled?: boolean;
  onHint?: (h: PersonaHint, arrow: Arrow) => void;
  /** Force the hinted move (e.g., the puzzle solution) but keep the persona's explanation */
  override?: string;
}) {
  const [hint, setHint] = useState<PersonaHint | null>(null);
  const [loading, setLoading] = useState<Persona | null>(null);
  useEffect(() => setHint(null), [fen]);

  const ask = async (p: Persona) => {
    setLoading(p);
    try {
      let h = await personaHint(fen, p);
      if (h && override && h.uci !== override) {
        const c = new Chess(fen);
        const mv = c.move({ from: override.slice(0, 2), to: override.slice(2, 4), promotion: override[4] || undefined });
        h = { ...h, uci: override, san: mv.san, line: '', why: ['There is a forcing idea here. Calculate it to the end.'], onlyMove: true };
      }
      if (h) {
        setHint(h);
        onHint?.(h, { from: h.uci.slice(0, 2) as never, to: h.uci.slice(2, 4) as never, color: p === 'magnus' ? ARROW.magnus : ARROW.hikaru });
      }
    } catch {
      /* superseded */
    }
    setLoading(null);
  };

  return (
    <>
      {(['magnus', 'hikaru'] as Persona[]).map((p) => (
        <button key={p} className={`chip hint-chip hint-${p}`} disabled={disabled || !!loading} onClick={() => ask(p)} title={`What would ${PERSONAS[p].name} do? ${PERSONAS[p].tag}`}>
          {PERSONAS[p].avatar} {loading === p ? 'Thinking…' : PERSONAS[p].name}?
        </button>
      ))}
      {hint && (
        <div className={`hint-card dock-panel hint-${hint.persona}`}>
          <div className="hint-head">
            {PERSONAS[hint.persona].avatar} <b>{PERSONAS[hint.persona].name}-inspired idea:</b> <span className="hint-move">{hint.san}</span>
            <button className="hint-close" onClick={() => setHint(null)} aria-label="Close">✕</button>
          </div>
          <ul>{hint.why.slice(0, 3).map((w, i) => <li key={i}>{w}</li>)}</ul>
          {hint.line && <div className="hint-line">Line: {hint.line}</div>}
          <div className="hint-principle">💡 {hint.principle}</div>
        </div>
      )}
    </>
  );
}

/** Confetti burst (pure CSS). */
export function Confetti() {
  const pieces = useMemo(
    () => Array.from({ length: 90 }, (_, i) => ({
      left: Math.random() * 100,
      delay: Math.random() * 0.6,
      dur: 1.8 + Math.random() * 1.6,
      color: ['#f59e0b', '#22c55e', '#38bdf8', '#f43f5e', '#a855f7', '#facc15'][i % 6],
      rot: Math.random() * 360,
      size: 6 + Math.random() * 8,
    })),
    [],
  );
  return (
    <div className="confetti">
      {pieces.map((p, i) => (
        <i key={i} style={{ left: `${p.left}%`, animationDelay: `${p.delay}s`, animationDuration: `${p.dur}s`, background: p.color, transform: `rotate(${p.rot}deg)`, width: p.size, height: p.size * 0.5 }} />
      ))}
    </div>
  );
}

/** Shows queued rewards: big modal for promotions/badges, toast for streak updates. */
export function RewardLayer() {
  const p = useProgress();
  const r = p.rewards[0];
  useEffect(() => {
    if (r?.kind === 'streak' && !r.xp) {
      const t = setTimeout(() => actions.popReward(), 2600);
      return () => clearTimeout(t);
    }
  }, [r]);
  useEffect(() => {
    if (r && p.settings.sound) chime(r.kind === 'tier' ? 3 : 1);
    if (r?.kind === 'tier') shout('Level up!', { delay: 400 });
  }, [r, p.settings.sound]);
  if (!r) return null;
  if (r.kind === 'streak' && !r.xp) {
    return (
      <div className="toast" onClick={() => actions.popReward()}>
        <span className="toast-icon">{r.icon}</span>
        <div><b>{r.title}</b><small>{r.subtitle}</small></div>
      </div>
    );
  }
  return (
    <div className="modal-bg" onClick={() => actions.popReward()}>
      <Confetti />
      <div className={`modal reward reward-${r.kind}`} onClick={(e) => e.stopPropagation()}>
        <div className="reward-icon">{r.icon}</div>
        <h2>{r.title}</h2>
        <p>{r.subtitle}</p>
        {r.xp ? <div className="reward-xp">+{r.xp} XP</div> : null}
        {r.theme && <div className="reward-theme">🎨 New board theme unlocked! Equip it in Profile.</div>}
        <button className="btn primary" onClick={() => actions.popReward()}>Awesome!</button>
      </div>
    </div>
  );
}

let audio: AudioContext | null = null;
function tone(freq: number, start: number, dur: number, gain = 0.06) {
  if (!audio) return;
  const o = audio.createOscillator();
  const g = audio.createGain();
  o.frequency.value = freq;
  o.type = 'sine';
  g.gain.setValueAtTime(gain, audio.currentTime + start);
  g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + start + dur);
  o.connect(g).connect(audio.destination);
  o.start(audio.currentTime + start);
  o.stop(audio.currentTime + start + dur);
}

function ensureAudio() {
  try {
    audio ??= new AudioContext();
    if (audio.state === 'suspended') void audio.resume();
  } catch {
    audio = null;
  }
}

export function chime(level = 1) {
  ensureAudio();
  const notes = level >= 3 ? [523, 659, 784, 1047] : [659, 988];
  notes.forEach((f, i) => tone(f, i * 0.11, 0.35));
}

export function sfx(kind: 'move' | 'capture' | 'good' | 'bad') {
  ensureAudio();
  if (kind === 'move') tone(330, 0, 0.07, 0.05);
  else if (kind === 'capture') { tone(220, 0, 0.09, 0.07); tone(180, 0.04, 0.09, 0.05); }
  else if (kind === 'good') { tone(784, 0, 0.12); tone(1047, 0.08, 0.18); }
  else { tone(196, 0, 0.25, 0.07); }
}

function noise(start: number, dur: number, gain: number, from: number, to: number) {
  if (!audio) return;
  const len = Math.ceil(audio.sampleRate * dur);
  const buf = audio.createBuffer(1, len, audio.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = audio.createBufferSource();
  src.buffer = buf;
  const f = audio.createBiquadFilter();
  f.type = 'lowpass';
  const t0 = audio.currentTime + start;
  f.frequency.setValueAtTime(from, t0);
  f.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  const g = audio.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f).connect(g).connect(audio.destination);
  src.start(t0);
}

function thud(freq: number, start: number, dur: number, gain: number) {
  if (!audio) return;
  const o = audio.createOscillator();
  const g = audio.createGain();
  const t0 = audio.currentTime + start;
  o.frequency.setValueAtTime(freq, t0);
  o.frequency.exponentialRampToValueAtTime(freq / 4, t0 + dur);
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(audio.destination);
  o.start(t0);
  o.stop(t0 + dur);
}

function sweep(from: number, to: number, start: number, dur: number, gain: number, type: OscillatorType = 'sawtooth') {
  if (!audio) return;
  const o = audio.createOscillator();
  const g = audio.createGain();
  const t0 = audio.currentTime + start;
  o.type = type;
  o.frequency.setValueAtTime(from, t0);
  o.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(audio.destination);
  o.start(t0);
  o.stop(t0 + dur);
}

export type CombatSound = 'whoosh' | 'hit' | 'heavy' | 'finisher' | 'shot' | 'boom' | 'zap' | 'brilliant' | 'evolve';

/** Punchy fighting-game sounds built from filtered noise and pitch-dropping thuds. */
export function combatSfx(kind: CombatSound) {
  ensureAudio();
  if (kind === 'whoosh') noise(0, 0.18, 0.05, 3000, 300);
  else if (kind === 'hit') { noise(0.12, 0.12, 0.16, 2500, 200); thud(160, 0.12, 0.18, 0.18); }
  else if (kind === 'shot') { noise(0, 0.08, 0.35, 9000, 1500); thud(320, 0, 0.08, 0.2); noise(0.07, 0.3, 0.05, 2500, 200); }
  else if (kind === 'boom') { noise(0, 0.7, 0.32, 1400, 50); thud(95, 0, 0.6, 0.35); }
  else if (kind === 'zap') { sweep(180, 1600, 0, 0.35, 0.04, 'sine'); sweep(2400, 300, 0.36, 0.22, 0.05); }
  else if (kind === 'brilliant') { noise(0, 0.3, 0.05, 3000, 400); [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.15 + i * 0.08, 0.3, 0.06)); }
  else if (kind === 'evolve') {
    sweep(160, 1400, 0, 1.6, 0.035, 'sine');
    sweep(240, 2100, 0.1, 1.5, 0.02, 'triangle');
    noise(1.62, 0.5, 0.12, 9000, 600);
    [784, 988, 1175, 1568].forEach((f, i) => tone(f, 1.65 + i * 0.07, 0.45, 0.06));
  }
  else if (kind === 'heavy') { noise(0.12, 0.35, 0.22, 4000, 120); thud(120, 0.12, 0.4, 0.28); thud(70, 0.2, 0.5, 0.2); }
  else {
    noise(0, 1.4, 0.12, 6000, 80);
    thud(90, 0.05, 1.2, 0.3);
    thud(55, 0.8, 1.2, 0.3);
    [392, 311, 233, 196].forEach((f, i) => tone(f, 1.7 + i * 0.12, 0.5, 0.06));
  }
}

export function useSfx() {
  const p = useProgress();
  return (k: 'move' | 'capture' | 'good' | 'bad') => p.settings.sound && sfx(k);
}
