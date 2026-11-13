import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { shout } from '../lib/announcer';
import { Chess } from 'chess.js';
import { computeOverlay, type Arrow, type Marker, type OverlayOptions } from '../lib/analysis';
import { actions, getProgress, useProgress } from '../lib/store';
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
let master: AudioNode | null = null;
/** Everything goes through one compressor so stacked effects punch without clipping. */
function out(): AudioNode {
  if (!master && audio) {
    const c = audio.createDynamicsCompressor();
    c.threshold.value = -14;
    c.ratio.value = 6;
    c.connect(audio.destination);
    master = c;
  }
  return master ?? audio!.destination;
}

function tone(freq: number, start: number, dur: number, gain = 0.06, type: OscillatorType = 'sine') {
  if (!audio) return;
  const o = audio.createOscillator();
  const g = audio.createGain();
  o.frequency.value = freq;
  o.type = type;
  g.gain.setValueAtTime(gain, audio.currentTime + start);
  g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + start + dur);
  o.connect(g).connect(out());
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

function noise(start: number, dur: number, gain: number, from: number, to: number, type: BiquadFilterType = 'lowpass') {
  if (!audio) return;
  const len = Math.ceil(audio.sampleRate * dur);
  const buf = audio.createBuffer(1, len, audio.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = audio.createBufferSource();
  src.buffer = buf;
  const f = audio.createBiquadFilter();
  f.type = type;
  const t0 = audio.currentTime + start;
  f.frequency.setValueAtTime(from, t0);
  f.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  const g = audio.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f).connect(g).connect(out());
  src.start(t0);
}

/** Noise that swells in instead of decaying: wind, rumble, a charging spell. */
function swell(start: number, dur: number, gain: number, from: number, to: number, type: BiquadFilterType = 'bandpass') {
  if (!audio) return;
  const len = Math.ceil(audio.sampleRate * dur);
  const buf = audio.createBuffer(1, len, audio.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = audio.createBufferSource();
  src.buffer = buf;
  const f = audio.createBiquadFilter();
  f.type = type;
  f.Q.value = 2;
  const t0 = audio.currentTime + start;
  f.frequency.setValueAtTime(from, t0);
  f.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  const g = audio.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + dur * 0.8);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f).connect(g).connect(out());
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
  o.connect(g).connect(out());
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
  o.connect(g).connect(out());
  o.start(t0);
  o.stop(t0 + dur);
}

/** A struck metal bell or gong: inharmonic partials with long tails. */
function bell(freq: number, start: number, dur: number, gain: number) {
  [1, 2.76, 5.4, 8.93].forEach((r, i) => tone(freq * r, start, dur / (1 + i * 0.6), gain / (1 + i * 1.4)));
}

/** Short brass-like stab (stacked detuned saws). */
function stab(freqs: number[], start: number, dur: number, gain: number) {
  freqs.forEach((f) => { tone(f, start, dur, gain, 'sawtooth'); tone(f * 1.006, start, dur, gain * 0.7, 'square'); });
}

export type CombatSound =
  | 'whoosh' | 'hit' | 'heavy' | 'finisher' | 'shot' | 'boom' | 'zap' | 'brilliant' | 'evolve'
  | 'punch' | 'salto' | 'slam' | 'ko' | 'check' | 'combo' | 'gong' | 'cheer' | 'blunder';

export type FinisherSound = 'inferno' | 'glacier' | 'thunder' | 'vortex' | 'blade' | 'meteor' | 'venom' | 'quake';

/** Punchy fighting-game sounds built from filtered noise and pitch-dropping thuds. */
export function combatSfx(kind: CombatSound) {
  ensureAudio();
  if (kind === 'whoosh') noise(0, 0.18, 0.05, 3000, 300);
  // pawn headbutt: a quick lunge and a dry knock
  else if (kind === 'punch') { noise(0, 0.1, 0.05, 4000, 800); thud(260, 0.2, 0.09, 0.22); noise(0.2, 0.06, 0.12, 5000, 900); }
  // knight salto: three spins through the air, then the landing
  else if (kind === 'salto') { [0, 0.11, 0.22].forEach((t, i) => noise(t, 0.12, 0.05 + i * 0.015, 5000 - i * 900, 500, 'bandpass')); thud(110, 0.42, 0.3, 0.3); }
  // king slam: wind-up and a ground-shaking stomp
  else if (kind === 'slam') { sweep(90, 300, 0, 0.35, 0.03, 'triangle'); thud(70, 0.38, 0.7, 0.4); noise(0.38, 0.5, 0.18, 1200, 60); }
  else if (kind === 'hit') { noise(0.12, 0.12, 0.16, 2500, 200); thud(160, 0.12, 0.18, 0.18); }
  else if (kind === 'ko') { sweep(1400, 220, 0.05, 0.6, 0.035, 'sine'); thud(60, 0.62, 0.25, 0.14); }
  else if (kind === 'shot') { noise(0, 0.08, 0.35, 9000, 1500); thud(320, 0, 0.08, 0.2); noise(0.07, 0.3, 0.05, 2500, 200); [0.4, 0.55].forEach((t) => tone(3200, t, 0.05, 0.015, 'square')); }
  else if (kind === 'boom') { noise(0, 0.7, 0.32, 1400, 50); thud(95, 0, 0.6, 0.35); }
  else if (kind === 'zap') { sweep(180, 1600, 0, 0.35, 0.04, 'sine'); sweep(2400, 300, 0.36, 0.22, 0.05); }
  else if (kind === 'check') { stab([392, 466], 0, 0.22, 0.03); stab([523, 622], 0.12, 0.35, 0.03); }
  else if (kind === 'combo') { stab([523, 659, 784], 0, 0.14, 0.025); stab([659, 784, 1047], 0.13, 0.4, 0.03); noise(0.13, 0.2, 0.06, 6000, 1500); }
  else if (kind === 'gong') { thud(80, 0, 0.5, 0.25); bell(110, 0, 3, 0.12); swell(0, 1.2, 0.04, 400, 3000); }
  else if (kind === 'blunder') { [311, 294, 277, 233].forEach((f, i) => tone(f, i * 0.2, i === 3 ? 0.7 : 0.22, 0.04, 'triangle')); }
  else if (kind === 'cheer') { swell(0, 1.4, 0.05, 900, 1800); [523, 659, 784, 1047].forEach((f, i) => stab([f], 0.1 + i * 0.1, 0.3, 0.02)); }
  else if (kind === 'brilliant') { noise(0, 0.3, 0.05, 3000, 400); [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.15 + i * 0.08, 0.3, 0.06)); bell(1568, 0.6, 1.2, 0.03); }
  else if (kind === 'evolve') {
    // Summoning: a rising charge under a spinning arpeggio, the burst of light, then the reveal fanfare.
    sweep(160, 1400, 0, 1.6, 0.035, 'sine');
    sweep(240, 2100, 0.1, 1.5, 0.02, 'triangle');
    swell(0, 1.6, 0.06, 300, 6000);
    [392, 523, 659, 784, 523, 659, 784, 1047, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.1 + i * 0.12, 0.16, 0.025, 'triangle'));
    noise(1.62, 0.5, 0.14, 9000, 600);
    thud(130, 1.62, 0.5, 0.25);
    stab([523, 659, 784], 1.7, 0.3, 0.025);
    stab([587, 740, 880], 1.95, 0.25, 0.025);
    stab([784, 988, 1175, 1568], 2.15, 0.9, 0.03);
    bell(2093, 2.2, 1.4, 0.03);
  }
  else if (kind === 'heavy') { noise(0.12, 0.35, 0.22, 4000, 120); thud(120, 0.12, 0.4, 0.28); thud(70, 0.2, 0.5, 0.2); }
  else finisherSfx('quake');
}

/** Each checkmate finisher gets its own sound, all landing the title slam at 1.7 s. */
export function finisherSfx(id: FinisherSound) {
  ensureAudio();
  // the stage goes dark
  sweep(55, 40, 0, 1.6, 0.06, 'sawtooth');
  if (id === 'inferno') { swell(0, 1.4, 0.16, 200, 1200, 'lowpass'); [0.2, 0.45, 0.7, 0.95].forEach((t) => noise(t, 0.25, 0.08, 3000, 300)); thud(70, 0.3, 1, 0.3); }
  else if (id === 'glacier') { [2637, 3136, 3520, 4186, 2794, 3729].forEach((f, i) => bell(f, 0.1 + i * 0.13, 0.7, 0.025)); noise(0.9, 0.4, 0.2, 8000, 2000, 'highpass'); thud(90, 0.95, 0.3, 0.25); }
  else if (id === 'thunder') { swell(0, 0.45, 0.08, 500, 5000); noise(0.45, 0.12, 0.45, 12000, 3000); thud(60, 0.5, 1.2, 0.4); noise(0.55, 1.1, 0.25, 900, 40); noise(1.05, 0.1, 0.25, 10000, 2000); }
  else if (id === 'vortex') { sweep(800, 60, 0, 1.6, 0.05, 'sine'); swell(0, 1.5, 0.12, 2000, 150); [0, 0.25, 0.5, 0.75, 1].forEach((t) => sweep(600, 200, t, 0.25, 0.02, 'triangle')); }
  else if (id === 'blade') { [0.15, 0.45, 0.75].forEach((t, i) => { noise(t, 0.15, 0.12, 8000, 1500, 'highpass'); bell(1800 + i * 300, t + 0.12, 0.6, 0.03); }); thud(140, 1, 0.3, 0.25); }
  else if (id === 'meteor') { sweep(2000, 120, 0, 1, 0.04, 'sawtooth'); swell(0, 1, 0.12, 4000, 300); noise(1, 0.9, 0.45, 1500, 40); thud(50, 1, 1.2, 0.45); }
  else if (id === 'venom') { [0.1, 0.35, 0.6, 0.85, 1.05].forEach((t, i) => sweep(300 + i * 40, 900 + i * 60, t, 0.2, 0.025, 'sine')); swell(0.2, 1.2, 0.08, 800, 2500); noise(0, 1.3, 0.04, 6000, 3000, 'highpass'); }
  else { swell(0, 1.2, 0.2, 60, 200, 'lowpass'); [0.2, 0.5, 0.8, 1.1].forEach((t) => thud(55, t, 0.35, 0.3)); noise(0.1, 1.4, 0.15, 500, 40); }
  // the title slams in
  thud(90, 1.7, 1.2, 0.35);
  noise(1.7, 0.6, 0.18, 3000, 100);
  bell(73, 1.7, 3, 0.1);
  [392, 311, 233, 196].forEach((f, i) => tone(f, 2.1 + i * 0.12, 0.5, 0.05, 'triangle'));
}

/** The sad trombone and the announcer's verdict after a blunder. */
export function blunderSting() {
  if (getProgress().settings.sound) combatSfx('blunder');
  shout('Blunder!', { delay: 300 });
}

export function useSfx() {
  const p = useProgress();
  return (k: 'move' | 'capture' | 'good' | 'bad') => p.settings.sound && sfx(k);
}
