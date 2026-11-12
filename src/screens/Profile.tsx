import { useEffect, useMemo, useState } from 'react';
import { Chess } from 'chess.js';
import { BADGES, BOARD_THEMES, TIERS } from '../lib/levels';
import { actions, useProgress } from '../lib/store';
import Board from '../components/Board';
import { FINISHERS, type FinisherId } from '../lib/finishers';

/** Short demo positions: White plays `san`, showing a signature attack, a brilliant flourish or a finisher. */
interface Demo {
  label: string;
  icon: string;
  desc: string;
  fen: string;
  san: string;
  finisher?: FinisherId;
  celebrate?: boolean;
}

const ATTACK_DEMOS: Demo[] = [
  { label: 'Pawn', icon: '♙', desc: 'Headbutt', fen: '4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1', san: 'exd5' },
  { label: 'Knight', icon: '♘', desc: 'Somersault stomp', fen: '4k3/8/8/3r4/8/4N3/8/4K3 w - - 0 1', san: 'Nxd5' },
  { label: 'Bishop', icon: '♗', desc: 'Draws a pistol', fen: '4k3/8/6r1/8/8/8/8/1B2K3 w - - 0 1', san: 'Bxg6' },
  { label: 'Rook', icon: '♖', desc: 'Cannon blast', fen: '4k3/b7/8/8/8/8/8/R3K3 w - - 0 1', san: 'Rxa7' },
  { label: 'Queen', icon: '♕', desc: 'Charged beam', fen: '3k4/8/8/7n/8/8/8/3QK3 w - - 0 1', san: 'Qxh5' },
  { label: 'King', icon: '♔', desc: 'Ground-pound', fen: '4k3/8/8/8/8/8/3n4/4K3 w - - 0 1', san: 'Kxd2' },
  { label: 'Brilliant!!', icon: '🤸', desc: 'Knight triple salto', fen: '4k3/8/8/8/8/8/8/1N2K3 w - - 0 1', san: 'Nc3', celebrate: true },
  { label: 'Brilliant!!', icon: '🎯', desc: 'Bishop fires in the air', fen: '4k3/8/8/8/8/8/8/1B2K3 w - - 0 1', san: 'Be4', celebrate: true },
];

const MATE_PRE = '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1';
const FINISHER_DEMOS: Demo[] = (Object.keys(FINISHERS) as FinisherId[]).map((id) => ({
  label: FINISHERS[id].name,
  icon: FINISHERS[id].icon,
  desc: FINISHERS[id].tagline,
  fen: MATE_PRE,
  san: 'Rd8#',
  finisher: id,
}));

/** Plays one demo move on a mini board so each combat animation can be previewed. */
function CombatGallery({ theme }: { theme: string }) {
  const [pick, setPick] = useState<{ demo: Demo; n: number } | null>(null);
  const [fen, setFen] = useState('');
  const after = useMemo(() => {
    if (!pick) return null;
    const c = new Chess(pick.demo.fen);
    const m = c.move(pick.demo.san);
    return { fen: c.fen(), from: m.from, to: m.to };
  }, [pick]);
  useEffect(() => {
    if (!pick || !after) return;
    setFen(pick.demo.fen);
    const t = window.setTimeout(() => setFen(after.fen), 450);
    return () => clearTimeout(t);
  }, [pick, after]);
  const chips = (demos: Demo[]) => (
    <div className="finishers">
      {demos.map((d) => (
        <button
          key={d.label + d.desc}
          className={`finisher-chip${pick?.demo === d ? ' on' : ''}`}
          style={{ ['--fc' as string]: d.finisher ? FINISHERS[d.finisher].color : '#facc15' }}
          onClick={() => setPick({ demo: d, n: (pick?.n ?? 0) + 1 })}
        >
          <span>{d.icon}</span>
          <b>{d.label}</b>
          <small>{d.desc}</small>
        </button>
      ))}
    </div>
  );
  const stage = (demos: Demo[]) =>
    pick && after && demos.includes(pick.demo) && fen && (
      <div className="finisher-stage">
        <Board
          key={pick.n}
          fen={fen}
          orientation="w"
          theme={theme}
          finisher={pick.demo.finisher}
          lastMove={fen === after.fen ? [after.from, after.to] : null}
          celebrate={pick.demo.celebrate && fen === after.fen ? { square: after.to, text: 'BRILLIANT!!', key: pick.n } : null}
        />
      </div>
    );
  return (
    <>
      <h2 className="section-title">Signature attacks</h2>
      <p className="muted small">Every piece fights in its own style, and brilliant moves get a victory flourish. Tap one to watch it.</p>
      {chips(ATTACK_DEMOS)}
      {stage(ATTACK_DEMOS)}
      <h2 className="section-title">Finisher gallery</h2>
      <p className="muted small">Every opening family ends with its own checkmate finisher. Tap one to preview it.</p>
      {chips(FINISHER_DEMOS)}
      {stage(FINISHER_DEMOS)}
    </>
  );
}

interface InstallEvent extends Event {
  prompt: () => Promise<void>;
}

export default function Profile() {
  const p = useProgress();
  const [install, setInstall] = useState<InstallEvent | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    const h = (e: Event) => {
      e.preventDefault();
      setInstall(e as InstallEvent);
    };
    window.addEventListener('beforeinstallprompt', h);
    return () => window.removeEventListener('beforeinstallprompt', h);
  }, []);

  const solved = Object.values(p.puzzles).filter((x) => x.ok > 0).length;
  const linesMastered = Object.values(p.lines).filter((x) => x.lvl >= 3).length;
  const tier = TIERS[Math.min(p.tier, TIERS.length - 1)];

  return (
    <div>
      <h1 className="page-title">Profile</h1>
      <div className="card stats">
        <div><b>{Math.round(p.puzzleRating)}</b><small>Training rating</small></div>
        <div><b>{p.xp}</b><small>XP</small></div>
        <div><b>{p.streak.best}</b><small>Best streak</small></div>
        <div><b>{solved}</b><small>Puzzles solved</small></div>
        <div><b>{linesMastered}</b><small>Lines mastered</small></div>
        <div><b>{p.games.won}/{p.games.played}</b><small>Bot games won</small></div>
      </div>
      <p className="muted small center">Current title: <b style={{ color: tier.color }}>{p.tier > 0 ? TIERS[p.tier - 1].reward.title : 'Newcomer'}</b></p>

      <h2 className="section-title">Badges</h2>
      <div className="badges">
        {BADGES.map((b) => (
          <div key={b.id} className={`badge ${p.badges[b.id] ? 'earned' : ''}`} title={b.desc}>
            <span>{b.icon}</span>
            <b>{b.name}</b>
            <small>{b.desc}</small>
          </div>
        ))}
      </div>

      <h2 className="section-title">Board themes</h2>
      <div className="themes">
        {BOARD_THEMES.map((t) => {
          const owned = p.themes.includes(t.id);
          return (
            <button key={t.id} className={`theme ${p.theme === t.id ? 'on' : ''}`} disabled={!owned} onClick={() => actions.setTheme(t.id)}>
              <div className="swatch">
                {[0, 1, 2, 3].map((i) => <i key={i} style={{ background: (i === 0 || i === 3) ? t.light : t.dark }} />)}
              </div>
              <b>{t.name}</b>
              <small>{owned ? (p.theme === t.id ? 'Equipped' : 'Tap to equip') : `🔒 ${t.unlock}`}</small>
            </button>
          );
        })}
      </div>

      <CombatGallery theme={p.theme} />

      <h2 className="section-title">Settings</h2>
      <div className="card settings">
        <label className="toggle"><input type="checkbox" checked={p.settings.sound} onChange={(e) => actions.setSetting('sound', e.target.checked)} /> Sound effects</label>
        <label className="toggle"><input type="checkbox" checked={p.settings.fx !== false} onChange={(e) => actions.setSetting('fx', e.target.checked)} /> Combat animations (piece strikes, knockouts, finishers)</label>
        {install && <button className="btn" onClick={() => install.prompt()}>📲 Install app</button>}
        {!install && <p className="muted small">To install: open the browser menu and choose "Add to Home screen". EloForge works offline once installed.</p>}
        {!confirmReset
          ? <button className="btn small danger" onClick={() => setConfirmReset(true)}>Reset all progress</button>
          : (
            <div className="row gap">
              <span className="small">Erase XP, streak, ratings and mastery?</span>
              <button className="btn small danger" onClick={() => { actions.reset(); setConfirmReset(false); }}>Yes, erase</button>
              <button className="btn small" onClick={() => setConfirmReset(false)}>Cancel</button>
            </div>
          )}
      </div>

      <p className="muted small center credits">
        Engine: Stockfish 18 (GPLv3) via stockfish.js · Pieces: Colin M.L. Burnett (GPL) · Hints are inspired by the publicly known styles of Magnus Carlsen and Hikaru Nakamura and are not affiliated with them.
      </p>
    </div>
  );
}
