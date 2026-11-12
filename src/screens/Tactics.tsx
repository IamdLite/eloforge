import { useNav } from '../App';
import { PUZZLES, THEME_INFO, type Puzzle } from '../data/puzzles';
import { TIERS, tierForRating } from '../lib/levels';
import { useProgress, type Progress } from '../lib/store';

/** Next puzzle: unseen, close to the learner's rating (slightly above to stretch), optional theme. */
export function nextPuzzle(p: Progress, theme?: string, exclude?: string): Puzzle | undefined {
  const r = p.puzzleRating;
  const pool = PUZZLES.filter((z) => (!theme || z.themes.includes(theme)) && z.id !== exclude);
  const unseen = pool.filter((z) => !p.puzzles[z.id]);
  const near = unseen.filter((z) => z.rating >= r - 200 && z.rating <= r + 250);
  const src = near.length ? near : unseen.length ? unseen : pool.filter((z) => (p.puzzles[z.id]?.fail ?? 0) > 0);
  if (!src.length) return pool[Math.floor(Math.random() * pool.length)];
  const sorted = [...src].sort((a, b) => Math.abs(a.rating - (r + 50)) - Math.abs(b.rating - (r + 50)));
  return sorted[Math.floor(Math.random() * Math.min(5, sorted.length))];
}

export default function Tactics() {
  const p = useProgress();
  const { go } = useNav();
  const solved = Object.values(p.puzzles).filter((x) => x.ok > 0).length;
  const counts = new Map<string, number>();
  PUZZLES.forEach((z) => z.themes.forEach((t) => counts.set(t, (counts.get(t) ?? 0) + 1)));
  const themes = [...counts.entries()].filter(([t]) => THEME_INFO[t]).sort((a, b) => b[1] - a[1]);
  const rt = tierForRating(p.puzzleRating);
  const bands = TIERS.map((t) => ({ t, n: PUZZLES.filter((z) => z.rating >= t.range[0] - (t.id === 0 ? 300 : 0) && z.rating < (t.id === TIERS.length - 1 ? 9999 : t.range[1])).length }));

  return (
    <div>
      <h1 className="page-title">Tactics</h1>
      <div className="card rating-card">
        <div>
          <div className="eyebrow">Training rating</div>
          <div className="huge">{Math.round(p.puzzleRating)}</div>
          <small className="muted">{TIERS[rt].icon} {TIERS[rt].name} level · {solved} solved</small>
        </div>
        <div className="combo">
          <div className="eyebrow">Combo</div>
          <div className="huge">×{p.combo}</div>
          <small className="muted">best ×{p.bestCombo}</small>
        </div>
      </div>
      <button className="btn primary block big" onClick={() => go({ name: 'puzzle' })}>⚔️ Start rated puzzles</button>
      <p className="muted small center">Puzzles adapt to your rating. Solve without hints to raise it. The streak combo multiplies XP.</p>

      <h2 className="section-title">Train a theme</h2>
      <div className="theme-grid">
        {themes.map(([t, n]) => (
          <button key={t} className="theme-card card" onClick={() => go({ name: 'puzzle', theme: t })}>
            <b>{THEME_INFO[t].name}</b>
            <small className="muted">{n} puzzles</small>
            <small>{THEME_INFO[t].tip}</small>
          </button>
        ))}
      </div>

      <h2 className="section-title">Puzzles by level</h2>
      <div className="bands">
        {bands.map(({ t, n }) => (
          <div key={t.id} className="band" style={{ borderColor: t.color }}>
            <span>{t.icon} {t.name}</span>
            <small className="muted">{t.range[0]}–{t.range[1]}</small>
            <b>{n}</b>
          </div>
        ))}
      </div>
    </div>
  );
}
