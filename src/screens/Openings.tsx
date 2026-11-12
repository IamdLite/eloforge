import { useNav } from '../App';
import { ProgressBar } from '../components/ui';
import { OPENINGS, openingById } from '../data/openings';
import { TIERS } from '../lib/levels';
import { MASTERED, useProgress, type Progress } from '../lib/store';
import { buildTree, lineId, type OpeningDef } from '../lib/tree';

export function openingMastery(p: Progress, o: OpeningDef) {
  const paths = buildTree(o).paths;
  const mastered = paths.filter((l) => (p.lines[lineId(o.id, l.index)]?.lvl ?? 0) >= MASTERED).length;
  const started = paths.filter((l) => p.lines[lineId(o.id, l.index)]).length;
  return { mastered, started, total: paths.length };
}

export const tierLocked = (p: Progress, tier: number) => tier > p.tier + 1;

export default function Openings() {
  const p = useProgress();
  const { go } = useNav();
  return (
    <div>
      <h1 className="page-title">Openings</h1>
      <p className="muted page-sub">Learn each line with live commentary, then drill it from memory until it's mastered. Drills branch on your opponent's choices, including traps and surprise moves.</p>
      {TIERS.map((t) => {
        const ops = OPENINGS.filter((o) => o.tier === t.id);
        if (!ops.length) return null;
        const locked = tierLocked(p, t.id);
        return (
          <section key={t.id} className={`tier-section ${locked ? 'locked' : ''}`}>
            <h2 className="tier-head" style={{ color: t.color }}>
              {t.icon} {t.name} <span className="muted">{t.range[0]}–{t.range[1]}</span>
              {t.id === p.tier + 1 && <span className="pill">Stretch</span>}
              {locked && <span className="pill">🔒 Reach {TIERS[t.id - 1].name}</span>}
            </h2>
            <div className="grid">
              {ops.map((o) => {
                const m = openingMastery(p, o);
                return (
                  <button key={o.id} className="op-card card" disabled={locked} onClick={() => go({ name: 'opening', id: o.id })}>
                    <div className="op-top">
                      <span className={`side side-${o.side}`}>{o.side === 'w' ? 'White' : 'Black'}</span>
                      <span className="muted small">{o.eco}</span>
                    </div>
                    <b>{o.name}</b>
                    <small className="muted">{o.lines.length} lines · {o.lines.filter((l) => l.trap).length} traps</small>
                    <ProgressBar value={m.mastered} max={m.total} color={t.color} />
                    <small>{m.mastered === m.total ? '🏆 Mastered' : `${m.mastered}/${m.total} mastered`}</small>
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

export function OpeningDetail({ id }: { id: string }) {
  const p = useProgress();
  const { go, back } = useNav();
  const o = openingById(id);
  if (!o) return <div>Unknown opening</div>;
  const { paths } = buildTree(o);
  const m = openingMastery(p, o);
  const t = TIERS[o.tier];
  return (
    <div>
      <button className="back" onClick={back}>‹ Back</button>
      <div className="card op-hero" style={{ borderColor: t.color }}>
        <div className="op-top">
          <span className={`side side-${o.side}`}>You play {o.side === 'w' ? 'White' : 'Black'}</span>
          <span className="pill" style={{ background: t.color }}>{t.icon} {t.name}</span>
        </div>
        <h1>{o.name}</h1>
        <p>{o.summary}</p>
        <ul className="ideas">{o.ideas.map((i) => <li key={i}>{i}</li>)}</ul>
        {o.inspiredBy && <p className="inspired">⭐ {o.inspiredBy}</p>}
        <ProgressBar value={m.mastered} max={m.total} color={t.color} />
        <small className="muted">{m.mastered}/{m.total} lines mastered (3 clean repetitions each, spaced over days)</small>
        <div className="row gap">
          <button className="btn" onClick={() => go({ name: 'opening-train', id, mode: 'learn' })}>🎓 Learn</button>
          <button className="btn primary" onClick={() => go({ name: 'opening-train', id, mode: 'drill' })}>🧠 Drill from memory</button>
        </div>
      </div>

      <h2 className="section-title">Lines</h2>
      <div className="lines">
        {paths.map((l) => {
          const s = p.lines[lineId(o.id, l.index)];
          const lvl = s?.lvl ?? 0;
          const due = s && s.due <= Date.now() && lvl < 4;
          return (
            <div key={l.index} className="line-row card">
              <div className="line-info">
                <b>{l.trap && '⚠️ '}{l.name}</b>
                <small className="muted">{l.nodes.slice(0, 8).map((n, i) => (i % 2 === 0 ? `${i / 2 + 1}.${n.san}` : n.san)).join(' ')}{l.nodes.length > 8 ? ' …' : ''}</small>
                <div className="dots">
                  {Array.from({ length: MASTERED }, (_, i) => <span key={i} className={`dot ${i < lvl ? 'on' : ''}`} />)}
                  {due && <span className="pill small">due</span>}
                </div>
              </div>
              <div className="line-actions">
                <button className="btn small" onClick={() => go({ name: 'opening-train', id, mode: 'learn', line: l.index })}>Learn</button>
                <button className="btn small primary" onClick={() => go({ name: 'opening-train', id, mode: 'drill', line: l.index })}>Drill</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
