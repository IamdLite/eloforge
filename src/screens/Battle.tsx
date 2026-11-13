// Friend battles, peer to peer: the host creates an invite link, the friend opens it, and the two
// browsers connect directly over WebRTC (PeerJS's free broker only introduces them). No accounts,
// no server-side storage: each side keeps its own profile and battle record on the device.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Chess, type Color } from 'chess.js';
import type { DataConnection, Peer } from 'peerjs';
import { useNav } from '../App';
import Board, { type BoardMove } from '../components/Board';
import { useAnnouncer, useSfx } from '../components/ui';
import { actions, getProgress, useProgress, type Fighter } from '../lib/store';
import { detectOpening, finisherFor } from '../lib/finishers';
import { uciToMove } from '../lib/analysis';
import { HealthBars } from './Play';
import { openingById } from '../data/openings';

interface Result {
  winner: Color | null;
  why: string;
}

type Msg =
  | { t: 'hello'; v: 1; me: Fighter; rating: number }
  | { t: 'start'; gid: string; hostColor: Color; clock: number | null }
  | { t: 'move'; gid: string; ply: number; uci: string; left: number }
  | { t: 'resign'; gid: string }
  | { t: 'draw'; gid: string; accept: boolean }
  | { t: 'draw-no'; gid: string }
  | { t: 'flag'; gid: string; loser: Color }
  | { t: 'rematch' }
  | { t: 'emote'; e: string }
  | { t: 'sync'; gid: string; hostColor: Color; clock: number | null; ucis: string[]; clocks: Record<Color, number>; result?: Result }
  | { t: 'busy' }
  | { t: 'bye' };

interface Game {
  gid: string;
  hostColor: Color;
  myColor: Color;
  clock: number | null;
  ucis: string[];
  clocks: Record<Color, number>;
  turnStart: number;
  result?: Result;
}

const AVATARS = ['♞', '♛', '♜', '🐉', '🦁', '🦊', '🐺', '🦅', '🥷', '🧙', '🤖', '👑', '🔥', '⚡', '💀', '🐙'];
const EMOTES = ['🔥', '😱', '😂', '👏', '🫡', '💀', 'GG'];
const CLOCKS: { label: string; ms: number | null }[] = [
  { label: 'No clock', ms: null },
  { label: '5 min', ms: 5 * 60e3 },
  { label: '10 min', ms: 10 * 60e3 },
];
const other = (c: Color): Color => (c === 'w' ? 'b' : 'w');
const rid = (n = 8) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join('');
const fmt = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** Optional self-hosted PeerJS broker, e.g. {"host":"localhost","port":9000,"path":"/","secure":false}. */
function brokerOverride() {
  try {
    return JSON.parse(localStorage.getItem('eloforge-peer-server') ?? 'null') ?? {};
  } catch {
    return {};
  }
}

export function ProfileForm({ onDone, cta = 'Save profile' }: { onDone?: () => void; cta?: string }) {
  const p = useProgress();
  const [name, setName] = useState(p.profile?.name ?? '');
  const [avatar, setAvatar] = useState(p.profile?.avatar ?? AVATARS[0]);
  const ok = name.trim().length >= 2;
  return (
    <form
      className="profile-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ok) return;
        actions.setProfile(name, avatar);
        onDone?.();
      }}
    >
      <label className="field">
        <span>Fighter name</span>
        <input value={name} maxLength={20} placeholder="e.g. KnightRider" onChange={(e) => setName(e.target.value)} autoComplete="nickname" />
      </label>
      <div className="avatar-pick">
        {AVATARS.map((a) => (
          <button type="button" key={a} className={a === avatar ? 'on' : ''} onClick={() => setAvatar(a)} aria-label={`Avatar ${a}`}>{a}</button>
        ))}
      </div>
      <button className="btn primary" disabled={!ok}>{cta}</button>
      <small className="muted">Your profile lives on this device only. Friends see your name and avatar when you battle.</small>
    </form>
  );
}

function parseInvite(text: string): string | null {
  const t = text.trim();
  const m = t.match(/[?&]join=([a-z0-9-]+)/i);
  if (m) return m[1];
  return /^eloforge-[a-z0-9]+$/i.test(t) ? t : null;
}

export default function Battle({ join }: { join?: string }) {
  const p = useProgress();
  const { back } = useNav();
  const sfx = useSfx();
  const announcer = useAnnouncer();
  const me = p.profile;

  const [phase, setPhase] = useState<'lobby' | 'waiting' | 'connecting' | 'game'>(join ? 'connecting' : 'lobby');
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<'ok' | 'lost' | 'left' | null>(null);
  const [invite, setInvite] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [paste, setPaste] = useState('');
  const [colorPref, setColorPref] = useState<'random' | Color>('random');
  const [clockPref, setClockPref] = useState<number | null>(null);
  const [them, setThem] = useState<(Fighter & { rating: number }) | null>(null);
  const [game, setGameState] = useState<Game | null>(null);
  const [drawOffer, setDrawOffer] = useState<'sent' | 'received' | null>(null);
  const [rematch, setRematch] = useState({ me: false, them: false });
  const [bubbles, setBubbles] = useState<{ id: number; who: 'me' | 'them'; e: string }[]>([]);
  const [now, setNow] = useState(Date.now());

  const peer = useRef<Peer | null>(null);
  const conn = useRef<DataConnection | null>(null);
  const isHost = useRef(!join);
  const hostId = useRef(join ?? null);
  const gameRef = useRef<Game | null>(null);
  const themRef = useRef<typeof them>(null);
  const recorded = useRef(new Set<string>());
  const prefs = useRef({ colorPref, clockPref });
  prefs.current = { colorPref, clockPref };

  const setGame = (fn: (g: Game | null) => Game | null) => {
    gameRef.current = fn(gameRef.current);
    setGameState(gameRef.current);
  };
  const send = (m: Msg) => {
    try {
      if (conn.current?.open) void conn.current.send(m);
    } catch {
      /* the close handler reports it */
    }
  };

  const showBubble = (who: 'me' | 'them', e: string) => {
    const id = Date.now() + Math.random();
    setBubbles((b) => [...b.slice(-3), { id, who, e }]);
    setTimeout(() => setBubbles((b) => b.filter((x) => x.id !== id)), 2600);
  };

  // ── game logic ──
  const startGame = (hostColor: Color) => {
    const clock = prefs.current.clockPref;
    const g: Game = { gid: rid(6), hostColor, myColor: hostColor, clock, ucis: [], clocks: { w: clock ?? 0, b: clock ?? 0 }, turnStart: Date.now() };
    setGame(() => g);
    setRematch({ me: false, them: false });
    setDrawOffer(null);
    send({ t: 'start', gid: g.gid, hostColor, clock });
    begin();
  };

  const begin = () => {
    setPhase('game');
    announcer.rearm();
    setTimeout(() => announcer.call('FIGHT!'), 300);
  };

  const finish = (result: Result) => setGame((g) => (g && !g.result ? { ...g, result } : g));

  const applyMove = (g: Game, uci: string, left: number): Game | null => {
    const c = new Chess();
    for (const u of g.ucis) c.move(uciToMove(u));
    const mover = c.turn();
    let m;
    try {
      m = c.move(uciToMove(uci));
    } catch {
      return null;
    }
    sfx(m.captured ? 'capture' : 'move');
    const next: Game = { ...g, ucis: [...g.ucis, uci], clocks: { ...g.clocks, [mover]: left }, turnStart: Date.now() };
    if (c.isCheckmate()) next.result = { winner: mover, why: 'checkmate' };
    else if (c.isStalemate()) next.result = { winner: null, why: 'stalemate' };
    else if (c.isThreefoldRepetition()) next.result = { winner: null, why: 'repetition' };
    else if (c.isInsufficientMaterial()) next.result = { winner: null, why: 'insufficient material' };
    else if (c.isDraw()) next.result = { winner: null, why: 'the 50-move rule' };
    return next;
  };

  const onMsg = (m: Msg, from: DataConnection) => {
    const g = gameRef.current;
    if (m.t !== 'hello' && from !== conn.current) return;
    switch (m.t) {
      case 'hello': {
        const friend = { ...m.me, rating: m.rating };
        const returning = themRef.current?.uid === friend.uid;
        if (isHost.current) {
          // One opponent at a time; a returning friend replaces their own dropped connection.
          if (conn.current?.open && conn.current !== from && !returning) {
            void from.send({ t: 'busy' } satisfies Msg);
            setTimeout(() => from.close(), 500);
            return;
          }
          if (conn.current !== from) conn.current?.close();
          conn.current = from;
          setLink('ok');
        }
        themRef.current = friend;
        setThem(friend);
        if (!isHost.current) return;
        if (g && returning) {
          // The friend reconnected: bring them back to the same position and clocks.
          send({ t: 'sync', gid: g.gid, hostColor: g.hostColor, clock: g.clock, ucis: g.ucis, clocks: g.clocks, result: g.result });
        } else {
          const c = prefs.current.colorPref;
          startGame(c === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : c);
        }
        return;
      }
      case 'start':
        setGame(() => ({ gid: m.gid, hostColor: m.hostColor, myColor: other(m.hostColor), clock: m.clock, ucis: [], clocks: { w: m.clock ?? 0, b: m.clock ?? 0 }, turnStart: Date.now() }));
        setRematch({ me: false, them: false });
        setDrawOffer(null);
        begin();
        return;
      case 'sync':
        setGame(() => ({ gid: m.gid, hostColor: m.hostColor, myColor: other(m.hostColor), clock: m.clock, ucis: m.ucis, clocks: m.clocks, turnStart: Date.now(), result: m.result }));
        setPhase('game');
        return;
      case 'move':
        if (!g || g.gid !== m.gid || m.ply !== g.ucis.length || g.result) return;
        setGame((cur) => (cur ? applyMove(cur, m.uci, m.left) ?? cur : cur));
        setDrawOffer((d) => (d === 'sent' ? null : d));
        return;
      case 'resign':
        if (g?.gid === m.gid) finish({ winner: g.myColor, why: 'resignation' });
        return;
      case 'draw':
        if (g?.gid !== m.gid || g.result) return;
        if (m.accept) {
          finish({ winner: null, why: 'agreement' });
          setDrawOffer(null);
        } else setDrawOffer('received');
        return;
      case 'draw-no':
        setDrawOffer(null);
        showBubble('them', '🙅 No draw');
        return;
      case 'flag':
        if (g?.gid === m.gid) finish({ winner: other(m.loser), why: 'time' });
        return;
      case 'rematch':
        setRematch((r) => ({ ...r, them: true }));
        return;
      case 'emote':
        showBubble('them', m.e.slice(0, 8));
        sfx('good');
        return;
      case 'busy':
        setError('Your friend is already in another battle.');
        return;
      case 'bye':
        setLink('left');
        return;
    }
  };

  const attach = (c: DataConnection) => {
    c.on('open', () => {
      if (!isHost.current) {
        conn.current?.close();
        conn.current = c;
        setLink('ok');
      }
      setError(null);
      const prof = getProgress().profile!;
      void c.send({ t: 'hello', v: 1, me: prof, rating: Math.round(getProgress().puzzleRating) } satisfies Msg);
    });
    c.on('data', (d) => onMsg(d as Msg, c));
    c.on('close', () => {
      if (conn.current === c) {
        conn.current = null;
        setLink((l) => (l === 'left' ? l : 'lost'));
      }
    });
    c.on('error', () => conn.current === c && setLink('lost'));
  };

  const makePeer = async (id?: string) => {
    const { Peer } = await import('peerjs');
    const opts = { debug: 0, ...brokerOverride() };
    const pr = id ? new Peer(id, opts) : new Peer(opts);
    peer.current = pr;
    pr.on('disconnected', () => !pr.destroyed && pr.reconnect());
    pr.on('error', (e: { type?: string }) => {
      if (e.type === 'peer-unavailable') setError('That invite is no longer open. Ask your friend to send a new link (they need to keep EloForge open).');
      else if (e.type === 'unavailable-id') void host();
      else if (e.type === 'network' || e.type === 'server-error' || e.type === 'socket-error') setError('Could not reach the connection broker. Check your internet connection and try again.');
      else if (e.type === 'browser-incompatible') setError('This browser cannot do peer-to-peer connections.');
      else setError(`Connection problem (${e.type ?? 'unknown'}).`);
    });
    return pr;
  };

  async function host() {
    setError(null);
    peer.current?.destroy();
    const id = `eloforge-${rid(10)}`;
    const pr = await makePeer(id);
    pr.on('open', () => {
      hostId.current = id;
      setInvite(`${location.origin}${location.pathname}?join=${id}`);
      setPhase('waiting');
    });
    pr.on('connection', (c) => attach(c));
  }

  async function connect(id: string) {
    setError(null);
    setPhase((ph) => (ph === 'game' ? ph : 'connecting'));
    isHost.current = false;
    hostId.current = id;
    if (!peer.current || peer.current.destroyed) {
      const pr = await makePeer();
      pr.on('open', () => attach(pr.connect(id, { reliable: true })));
    } else attach(peer.current.connect(id, { reliable: true }));
  }

  useEffect(() => {
    if (join && me) void connect(join);
    return () => {
      send({ t: 'bye' });
      conn.current?.close();
      peer.current?.destroy();
    };
  }, [!!me]); // eslint-disable-line react-hooks/exhaustive-deps

  // Both want a rematch: the host starts it with colors swapped.
  useEffect(() => {
    if (isHost.current && rematch.me && rematch.them && gameRef.current) startGame(other(gameRef.current.hostColor));
  }, [rematch.me, rematch.them]); // eslint-disable-line react-hooks/exhaustive-deps

  // Clocks.
  const ticking = !!game?.clock && !game.result && game.ucis.length >= 2;
  useEffect(() => {
    if (!ticking) return;
    const t = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(t);
  }, [ticking]);

  const chess = useMemo(() => {
    const c = new Chess();
    for (const u of game?.ucis ?? []) c.move(uciToMove(u));
    return c;
  }, [game?.ucis]);
  const turn = chess.turn();
  const left = (c: Color) => {
    if (!game?.clock) return 0;
    return game.clocks[c] - (ticking && turn === c ? now - game.turnStart : 0);
  };

  useEffect(() => {
    if (!game || !ticking) return;
    if (left(game.myColor) <= 0 && turn === game.myColor) {
      send({ t: 'flag', gid: game.gid, loser: game.myColor });
      finish({ winner: other(game.myColor), why: 'time' });
    } else if (left(other(game.myColor)) <= -4000 && turn !== game.myColor) {
      // Their flag message never came (maybe they dropped): claim the win.
      send({ t: 'flag', gid: game.gid, loser: other(game.myColor) });
      finish({ winner: game.myColor, why: 'time' });
    }
  }, [now]); // eslint-disable-line react-hooks/exhaustive-deps

  // Record the result once.
  useEffect(() => {
    const g = game;
    if (!g?.result || recorded.current.has(g.gid) || !them) return;
    recorded.current.add(g.gid);
    const r = g.result.winner === null ? 'draw' : g.result.winner === g.myColor ? 'win' : 'loss';
    actions.battle({ uid: them.uid, name: them.name, avatar: them.avatar }, r);
    if (g.result.why !== 'checkmate') sfx(r === 'win' ? 'good' : 'bad');
  }, [game?.result]); // eslint-disable-line react-hooks/exhaustive-deps

  const onMove = (mv: BoardMove) => {
    const g = gameRef.current;
    if (!g || g.result || turn !== g.myColor || link !== 'ok') return;
    const c = new Chess(chess.fen());
    let m;
    try {
      m = c.move(mv);
    } catch {
      return;
    }
    const uci = m.from + m.to + (m.promotion ?? '');
    const remaining = g.clock && g.ucis.length >= 2 ? Math.max(0, g.clocks[g.myColor] - (Date.now() - g.turnStart)) : g.clocks[g.myColor];
    const next = applyMove(g, uci, remaining);
    if (!next) return;
    setGame(() => next);
    send({ t: 'move', gid: g.gid, ply: g.ucis.length, uci, left: remaining });
    if (drawOffer === 'received') setDrawOffer(null);
  };

  const resign = () => {
    const g = gameRef.current;
    if (!g || g.result || !confirm('Resign this battle?')) return;
    send({ t: 'resign', gid: g.gid });
    finish({ winner: other(g.myColor), why: 'resignation' });
  };

  const emote = (e: string) => {
    send({ t: 'emote', e });
    showBubble('me', e);
  };

  const copy = async () => {
    if (!invite) return;
    try {
      await navigator.clipboard.writeText(invite);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      prompt('Copy this link:', invite);
    }
  };
  const share = async () => {
    if (!invite) return;
    const text = `${me?.avatar} ${me?.name} challenges you to a chess battle on EloForge! Tap to accept:`;
    if (navigator.share) {
      try {
        await navigator.share({ title: 'EloForge battle', text, url: invite });
      } catch {
        /* cancelled */
      }
    } else void copy();
  };

  // ── screens ──
  if (!me) {
    return (
      <div>
        <button className="back" onClick={back}>‹ Back</button>
        <div className="card battle-hero">
          <h1>⚔️ Create your fighter</h1>
          <p className="muted">{join ? 'A friend challenged you! Pick a name and avatar, then the battle starts.' : 'Pick a name and avatar to challenge friends.'}</p>
          <ProfileForm cta={join ? '⚔️ Accept the challenge' : 'Create profile'} />
        </div>
      </div>
    );
  }

  if (phase !== 'game' || !game) {
    return (
      <div>
        <button className="back" onClick={back}>‹ Back</button>
        <div className="card battle-hero">
          <div className="fighter-card big"><span className="avatar">{me.avatar}</span><b>{me.name}</b></div>
          {phase === 'lobby' && (
            <>
              <h1>Battle a friend</h1>
              <p className="muted">Create an invite link and send it to a friend. Your browsers connect directly; the game, the combat moves and the finishers play on both screens.</p>
              <label className="label">Your color</label>
              <div className="seg">
                {(['random', 'w', 'b'] as const).map((c) => (
                  <button key={c} className={colorPref === c ? 'on' : ''} onClick={() => setColorPref(c)}>{c === 'random' ? '🎲 Random' : c === 'w' ? '♔ White' : '♚ Black'}</button>
                ))}
              </div>
              <label className="label">Clock</label>
              <div className="seg">
                {CLOCKS.map((c) => (
                  <button key={c.label} className={clockPref === c.ms ? 'on' : ''} onClick={() => setClockPref(c.ms)}>{c.label}</button>
                ))}
              </div>
              <button className="btn primary block big" onClick={() => void host()}>⚔️ Create invite link</button>
              <div className="or">or join with a link</div>
              <form className="row gap" onSubmit={(e) => { e.preventDefault(); const id = parseInvite(paste); if (id) void connect(id); else setError('That does not look like an EloForge invite link.'); }}>
                <input className="grow" value={paste} placeholder="Paste an invite link" onChange={(e) => setPaste(e.target.value)} />
                <button className="btn">Join</button>
              </form>
            </>
          )}
          {phase === 'waiting' && invite && (
            <>
              <h1>Waiting for your friend…</h1>
              <p className="muted">Send this link. Keep this screen open: the battle starts as soon as they tap it.</p>
              <div className="invite-box"><code>{invite}</code></div>
              <div className="row gap">
                <button className="btn primary" onClick={() => void share()}>📤 Share</button>
                <button className="btn" onClick={() => void copy()}>{copied ? '✅ Copied' : '📋 Copy link'}</button>
              </div>
              <div className="pulse-dots"><i /><i /><i /></div>
              <button className="btn ghost" onClick={() => { peer.current?.destroy(); setPhase('lobby'); setInvite(null); }}>Cancel</button>
            </>
          )}
          {phase === 'connecting' && (
            <>
              <h1>Joining the battle…</h1>
              <p className="muted">Connecting directly to your friend's device.</p>
              {!error && <div className="pulse-dots"><i /><i /><i /></div>}
              {error && hostId.current && <button className="btn primary" onClick={() => void connect(hostId.current!)}>↻ Try again</button>}
              <button className="btn ghost" onClick={() => setPhase('lobby')}>Create my own invite instead</button>
            </>
          )}
          {error && <p className="error-note">⚠️ {error}</p>}
        </div>
        <BattleRecord />
      </div>
    );
  }

  const myColor = game.myColor;
  const myTurn = turn === myColor && !game.result;
  const sans = chess.history();
  const opening = detectOpening(sans);
  const lastUci = game.ucis[game.ucis.length - 1];
  const result = game.result;
  const outcome = result ? (result.winner === null ? 'draw' : result.winner === myColor ? 'win' : 'loss') : null;
  const friendName = them?.name ?? 'Friend';
  const card = (who: 'me' | 'them') => {
    const f = who === 'me' ? me : them;
    const c = who === 'me' ? myColor : other(myColor);
    const active = turn === c && !result;
    return (
      <div className={`fighter-card${active ? ' active' : ''}`}>
        <span className="avatar">{f?.avatar ?? '❔'}</span>
        <div className="grow">
          <b>{f?.name ?? '…'}</b>
          <small className="muted">{c === 'w' ? 'White' : 'Black'}{who === 'them' && them ? ` · ${them.rating}` : ''}{who === 'them' && link !== 'ok' ? ' · 📡 offline' : ''}</small>
        </div>
        {game.clock && <span className={`clock${active ? ' on' : ''}${left(c) < 20e3 ? ' low' : ''}`}>{fmt(left(c))}</span>}
        {bubbles.filter((b) => b.who === who).map((b) => <span key={b.id} className="emote-bubble">{b.e}</span>)}
      </div>
    );
  };

  return (
    <div className="trainer battle">
      <div className="trainer-head">
        <button className="back" onClick={back}>‹</button>
        <div>
          <div className="eyebrow">⚔️ Friend battle{opening ? ` · ${openingById(opening)?.name}` : ''}</div>
          <b>{result ? (outcome === 'win' ? '🏆 Victory!' : outcome === 'loss' ? '💀 Defeat' : '🤝 Draw') : myTurn ? 'Your move' : `${friendName} is thinking…`}</b>
        </div>
      </div>

      {card('them')}
      {p.settings.fx !== false && <HealthBars chess={chess} user={myColor} them={friendName.toUpperCase()} me={me.name.toUpperCase()} />}
      <Board
        fen={chess.fen()}
        orientation={myColor}
        interactive={myTurn && link === 'ok'}
        onMove={onMove}
        lastMove={lastUci ? [lastUci.slice(0, 2), lastUci.slice(2, 4)] : null}
        theme={p.theme}
        finisher={finisherFor(opening, game.gid)}
        announce={announcer.announce}
      />
      {card('me')}

      <div className="movelist" ref={(el) => el && (el.scrollLeft = el.scrollWidth)}>
        {sans.length ? sans.map((x, i) => (i % 2 === 0 ? `${i / 2 + 1}.${x}` : x)).join(' ') : 'The battle begins. White moves first.'}
      </div>

      {link !== 'ok' && !result && (
        <div className="prompt subtle">
          <b>{link === 'left' ? `${friendName} left the battle.` : '📡 Connection lost.'}</b>
          <span>{isHost.current ? 'Keep this screen open: when your friend reopens the invite link, the game continues.' : 'Reconnect to continue where you left off.'}</span>
          {!isHost.current && hostId.current && <button className="btn small" onClick={() => void connect(hostId.current!)}>↻ Reconnect</button>}
        </div>
      )}
      {drawOffer === 'received' && !result && (
        <div className="prompt">
          <b>🤝 {friendName} offers a draw</b>
          <div className="row gap">
            <button className="btn small primary" onClick={() => { send({ t: 'draw', gid: game.gid, accept: true }); finish({ winner: null, why: 'agreement' }); setDrawOffer(null); }}>Accept</button>
            <button className="btn small" onClick={() => { send({ t: 'draw-no', gid: game.gid }); setDrawOffer(null); }}>Decline</button>
          </div>
        </div>
      )}

      {!result && (
        <div className="dock">
          <div className="emotes">
            {EMOTES.map((e) => <button key={e} className="chip" onClick={() => emote(e)} disabled={link !== 'ok'}>{e}</button>)}
          </div>
          <button className="chip" disabled={drawOffer !== null || link !== 'ok' || game.ucis.length < 2} onClick={() => { send({ t: 'draw', gid: game.gid, accept: false }); setDrawOffer('sent'); }}>
            {drawOffer === 'sent' ? '🤝 Offer sent' : '🤝 Draw?'}
          </button>
          <button className="chip danger" onClick={resign}>🏳️ Resign</button>
        </div>
      )}

      {result && (
        <div className={`result card ${outcome === 'win' ? 'win' : ''}`}>
          <h3>{outcome === 'win' ? `🏆 You beat ${friendName}` : outcome === 'loss' ? `💀 ${friendName} wins` : '🤝 Draw'} by {result.why}</h3>
          {them && p.friends?.[them.uid] && (
            <p>Head to head: {p.friends[them.uid].w}W · {p.friends[them.uid].d}D · {p.friends[them.uid].l}L</p>
          )}
          <div className="emotes">{EMOTES.map((e) => <button key={e} className="chip" onClick={() => emote(e)} disabled={link !== 'ok'}>{e}</button>)}</div>
          <div className="row gap wrap">
            <button className="btn primary" disabled={rematch.me || link !== 'ok'} onClick={() => { setRematch((r) => ({ ...r, me: true })); send({ t: 'rematch' }); }}>
              {rematch.me ? (rematch.them ? 'Starting…' : 'Waiting for friend…') : rematch.them ? `⚔️ ${friendName} wants a rematch!` : '↺ Rematch (swap colors)'}
            </button>
            <button className="btn" onClick={back}>Leave</button>
          </div>
        </div>
      )}
    </div>
  );
}

export function BattleRecord() {
  const p = useProgress();
  const friends = Object.values(p.friends ?? {}).sort((a, b) => b.last - a.last);
  if (!p.battles?.played) return null;
  const b = p.battles;
  return (
    <section className="card battle-record">
      <h3>⚔️ Battle record</h3>
      <p className="muted">{b.played} battles · {b.won} won · {b.drawn} drawn · {b.lost} lost</p>
      {friends.map((f) => (
        <div key={f.uid} className="friend-row">
          <span className="avatar">{f.avatar}</span>
          <b className="grow">{f.name}</b>
          <small className="muted">{f.w}W {f.d}D {f.l}L</small>
        </div>
      ))}
    </section>
  );
}
