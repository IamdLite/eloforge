import { useNav } from '../App';
import { ProgressBar } from '../components/ui';
import { TIERS } from '../lib/levels';
import { dayKey, examStatus, useProgress } from '../lib/store';
import { OPENINGS } from '../data/openings';
import { buildTree, lineId } from '../lib/tree';

const DAILY_GOAL = 60;

export default function Home() {
  const p = useProgress();
  const { go } = useNav();
  const done = p.tier >= TIERS.length;
  const tier = TIERS[Math.min(p.tier, TIERS.length - 1)];
  const ex = examStatus(p);
  const today = p.activity[dayKey()] ?? 0;
  const practicedToday = p.streak.lastDay === dayKey();

  const due = OPENINGS.filter((o) => o.tier <= p.tier + 1).flatMap((o) =>
    buildTree(o).paths
      .map((l) => ({ o, l, s: p.lines[lineId(o.id, l.index)] }))
      .filter((x) => x.s && x.s.due <= Date.now()),
  );

  const week = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    const k = dayKey(d);
    return { k, xp: p.activity[k] ?? 0, label: d.toLocaleDateString(undefined, { weekday: 'narrow' }) };
  });

  return (
    <div className="home">
      <section className="hero card" style={{ ['--tier' as string]: tier.color }}>
        <div className="hero-top">
          <div className="tier-badge" style={{ background: tier.color }}>{done ? '👑' : tier.icon}</div>
          <div>
            <div className="eyebrow">{done ? 'Journey complete' : `Tier ${p.tier + 1} of ${TIERS.length}`}</div>
            <h1>{done ? '2000 Club' : `${tier.name} · ${tier.range[0]}–${tier.range[1]}`}</h1>
            <p className="muted">{done ? 'You passed every exam. Keep your streak alive and play rated games!' : tier.focus}</p>
          </div>
        </div>
        {!done && (
          <div className="exam">
            <div className="exam-title">Promotion exam → {TIERS[p.tier + 1]?.name ?? '2000 Club'}</div>
            <ExamRow icon="⚔️" label="Training rating" have={ex.puzzle.have} need={ex.puzzle.need} ok={ex.puzzle.ok} onClick={() => go({ name: 'tactics' })} rating />
            <ExamRow icon="📖" label="Opening lines mastered" have={ex.openings.have} need={ex.openings.need} ok={ex.openings.ok} onClick={() => go({ name: 'openings' })} />
            <ExamRow icon="🏁" label="Endgames cleared" have={ex.endgames.have} need={ex.endgames.need} ok={ex.endgames.ok} onClick={() => go({ name: 'endgames' })} />
          </div>
        )}
        <Ladder current={p.tier} />
      </section>

      <section className="card streak-card">
        <div className="streak-main">
          <div className={`flame ${practicedToday ? 'lit' : ''}`}>🔥</div>
          <div>
            <div className="big">{p.streak.count} day{p.streak.count === 1 ? '' : 's'}</div>
            <div className="muted">{practicedToday ? 'Streak secured for today ✓' : p.streak.count ? 'Train today to keep your streak!' : 'Start a streak today'}</div>
          </div>
          <div className="freezes" title="Streak freezes protect a missed day. Earn one every 7 days.">🧊 ×{p.streak.freezes}</div>
        </div>
        <div className="week">
          {week.map((d) => (
            <div key={d.k} className={`day ${d.xp ? 'on' : ''} ${d.k === dayKey() ? 'today' : ''}`}>
              <div className="dot">{d.xp ? '✓' : ''}</div>
              <small>{d.label}</small>
            </div>
          ))}
        </div>
        <div className="goal">
          <span>Daily goal</span>
          <ProgressBar value={today} max={DAILY_GOAL} color="#f59e0b" />
          <span className="muted">{Math.min(today, DAILY_GOAL)}/{DAILY_GOAL} XP</span>
        </div>
      </section>

      <section className="quick">
        {due.length > 0 && (
          <button className="quick-card accent" onClick={() => go({ name: 'opening-train', id: due[0].o.id, mode: 'drill', line: due[0].l.index })}>
            <span className="q-icon">🔁</span>
            <b>{due.length} line{due.length > 1 ? 's' : ''} waiting for you</b>
            <small>Next stage or weekly review: play it out to mate</small>
          </button>
        )}
        <button className="quick-card" onClick={() => go({ name: 'puzzle' })}>
          <span className="q-icon">⚔️</span>
          <b>Next puzzle</b>
          <small>Combo ×{p.combo} · best ×{p.bestCombo}</small>
        </button>
        <button className="quick-card" onClick={() => go({ name: 'battle' })}>
          <span className="q-icon">🤜</span>
          <b>Battle a friend</b>
          <small>Send a link, fight live</small>
        </button>
        <button className="quick-card" onClick={() => go({ name: 'openings' })}>
          <span className="q-icon">📖</span>
          <b>Learn an opening</b>
          <small>Main lines, traps & surprises</small>
        </button>
        <button className="quick-card" onClick={() => go({ name: 'endgames' })}>
          <span className="q-icon">🏁</span>
          <b>Endgame lab</b>
          <small>Beat Stockfish in won positions</small>
        </button>
        <button className="quick-card" onClick={() => go({ name: 'play' })}>
          <span className="q-icon">🤖</span>
          <b>Sparring game</b>
          <small>Live coach, arrows & hints</small>
        </button>
      </section>
    </div>
  );
}

function ExamRow({ icon, label, have, need, ok, onClick, rating }: { icon: string; label: string; have: number; need: number; ok: boolean; onClick: () => void; rating?: boolean }) {
  const base = rating ? Math.max(0, need - 300) : 0;
  return (
    <button className={`exam-row ${ok ? 'ok' : ''}`} onClick={onClick}>
      <span className="exam-icon">{ok ? '✅' : icon}</span>
      <span className="exam-label">{label}</span>
      <ProgressBar value={have - base} max={need - base} color={ok ? '#22c55e' : undefined} />
      <span className="exam-num">{have}/{need}</span>
    </button>
  );
}

function Ladder({ current }: { current: number }) {
  return (
    <div className="ladder">
      {TIERS.map((t) => (
        <div key={t.id} className={`rung ${t.id < current ? 'done' : t.id === current ? 'now' : ''}`} style={{ ['--c' as string]: t.color }}>
          <span>{t.icon}</span>
          <small>{t.range[0]}</small>
        </div>
      ))}
      <div className={`rung ${current >= TIERS.length ? 'now' : ''}`} style={{ ['--c' as string]: '#f59e0b' }}>
        <span>👑</span>
        <small>2000+</small>
      </div>
    </div>
  );
}
