import { useNav } from '../App';
import { ENDGAMES } from '../data/endgames';
import { TIERS } from '../lib/levels';
import { useProgress } from '../lib/store';
import { tierLocked } from './Openings';

const GOAL_LABEL = { mate: '♚ Checkmate', win: '🏆 Win', draw: '🛡️ Hold the draw' };

export default function Endgames() {
  const p = useProgress();
  const { go } = useNav();
  return (
    <div>
      <h1 className="page-title">Endgames</h1>
      <p className="muted page-sub">Learn the technique, then prove it against full-strength Stockfish. Win the won positions and hold the drawn ones.</p>
      {TIERS.map((t) => {
        const list = ENDGAMES.filter((e) => e.tier === t.id);
        if (!list.length) return null;
        const locked = tierLocked(p, t.id);
        return (
          <section key={t.id} className={`tier-section ${locked ? 'locked' : ''}`}>
            <h2 className="tier-head" style={{ color: t.color }}>
              {t.icon} {t.name} <span className="muted">{t.range[0]}–{t.range[1]}</span>
              {locked && <span className="pill">🔒 Reach {TIERS[t.id - 1].name}</span>}
            </h2>
            <div className="grid">
              {list.map((e) => {
                const rec = p.endgames[e.id];
                return (
                  <button key={e.id} className="op-card card" disabled={locked} onClick={() => go({ name: 'endgame', id: e.id })}>
                    <div className="op-top">
                      <span className="pill small">{GOAL_LABEL[e.goal]}</span>
                      {rec && <span>{rec.clean ? '⭐' : '✓'}</span>}
                    </div>
                    <b>{e.title}</b>
                    <small className="muted">{e.technique}</small>
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
