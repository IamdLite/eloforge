import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { RewardLayer } from './components/ui';
import { dayKey, useProgress } from './lib/store';
import { TIERS } from './lib/levels';
import Home from './screens/Home';
import Openings, { OpeningDetail } from './screens/Openings';
import OpeningTrainer from './screens/OpeningTrainer';
import Tactics from './screens/Tactics';
import PuzzleTrainer from './screens/PuzzleTrainer';
import Endgames from './screens/Endgames';
import EndgameTrainer from './screens/EndgameTrainer';
import Play from './screens/Play';
import Profile from './screens/Profile';

export type Route =
  | { name: 'home' }
  | { name: 'openings' }
  | { name: 'opening'; id: string }
  | { name: 'opening-train'; id: string; mode: 'learn' | 'drill'; line?: number }
  | { name: 'tactics' }
  | { name: 'puzzle'; theme?: string; id?: string }
  | { name: 'endgames' }
  | { name: 'endgame'; id: string }
  | { name: 'play'; fen?: string; side?: 'w' | 'b' }
  | { name: 'profile' };

const NavCtx = createContext<{ go: (r: Route) => void; back: () => void }>({ go: () => {}, back: () => {} });
export const useNav = () => useContext(NavCtx);

const TABS: { name: Route['name']; icon: string; label: string }[] = [
  { name: 'home', icon: '🏠', label: 'Home' },
  { name: 'openings', icon: '📖', label: 'Openings' },
  { name: 'tactics', icon: '⚔️', label: 'Tactics' },
  { name: 'endgames', icon: '🏁', label: 'Endgames' },
  { name: 'play', icon: '🤖', label: 'Play' },
];

const tabOf = (r: Route): Route['name'] =>
  r.name.startsWith('opening') ? 'openings' : r.name === 'puzzle' ? 'tactics' : r.name === 'endgame' ? 'endgames' : r.name;

export default function App() {
  const [stack, setStack] = useState<Route[]>([{ name: 'home' }]);
  const route = stack[stack.length - 1];
  const p = useProgress();

  const go = useCallback((r: Route) => {
    const isTab = TABS.some((t) => t.name === r.name) && !('fen' in r && r.fen);
    setStack((s) => (isTab ? [r] : [...s, r]));
    history.pushState(null, '');
    window.scrollTo(0, 0);
  }, []);
  const back = useCallback(() => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)), []);

  useEffect(() => {
    // Android back button / swipe-back pops our in-app stack.
    const onPop = () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : [{ name: 'home' }]));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const tier = TIERS[Math.min(p.tier, TIERS.length - 1)];

  return (
    <NavCtx.Provider value={{ go, back }}>
      <header className="topbar">
        <button className="brand" onClick={() => go({ name: 'home' })}>
          <img src="/icons/icon.svg" alt="" /> <span>EloForge</span>
        </button>
        <div className="topstats">
          <span className={`stat streak ${p.streak.lastDay === dayKey() ? 'lit' : 'dim'}`} title="Daily streak">
            🔥 {p.streak.count}
          </span>
          <span className="stat" title="Training rating">📈 {Math.round(p.puzzleRating)}</span>
          <button className="stat tier-chip" style={{ borderColor: tier.color }} onClick={() => go({ name: 'profile' })} title="Your tier">
            {p.tier >= TIERS.length ? '👑' : tier.icon} {p.xp} XP
          </button>
        </div>
      </header>

      <main className="screen" key={stack.length + route.name}>
        {route.name === 'home' && <Home />}
        {route.name === 'openings' && <Openings />}
        {route.name === 'opening' && <OpeningDetail id={route.id} />}
        {route.name === 'opening-train' && <OpeningTrainer key={route.id + route.mode + (route.line ?? '')} id={route.id} mode={route.mode} line={route.line} />}
        {route.name === 'tactics' && <Tactics />}
        {route.name === 'puzzle' && <PuzzleTrainer theme={route.theme} startId={route.id} />}
        {route.name === 'endgames' && <Endgames />}
        {route.name === 'endgame' && <EndgameTrainer key={route.id} id={route.id} />}
        {route.name === 'play' && <Play key={route.fen ?? 'new'} startFen={route.fen} startSide={route.side} />}
        {route.name === 'profile' && <Profile />}
      </main>

      <nav className="tabbar">
        {TABS.map((t) => (
          <button key={t.name} className={tabOf(route) === t.name ? 'active' : ''} onClick={() => go({ name: t.name } as Route)}>
            <span className="tab-icon">{t.icon}</span>
            <span className="tab-label">{t.label}</span>
          </button>
        ))}
      </nav>
      <RewardLayer />
    </NavCtx.Provider>
  );
}
