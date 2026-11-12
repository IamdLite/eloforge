// Fighting-game announcer: short shouted lines through the browser's speech synthesis.
import { getProgress } from './store';

let voice: SpeechSynthesisVoice | null | undefined;

function pickVoice() {
  if (voice !== undefined || typeof speechSynthesis === 'undefined') return voice ?? null;
  const all = speechSynthesis.getVoices().filter((v) => v.lang.startsWith('en'));
  if (!all.length) return null; // voices load asynchronously; try again next time
  const deep = /male|daniel|fred|alex|george|arthur|david|guy|ryan|thomas/i;
  voice = all.find((v) => deep.test(v.name) && !/female/i.test(v.name)) ?? all[0];
  return voice;
}

if (typeof speechSynthesis !== 'undefined') speechSynthesis.addEventListener?.('voiceschanged', () => (voice = undefined));

let last = { text: '', at: 0 };

/** Shout a line, e.g. "Finish it!". Respects the sound and announcer settings; drops rapid repeats. */
export function shout(text: string, opts: { delay?: number; interrupt?: boolean } = {}) {
  const s = getProgress().settings;
  if (!s.sound || s.voice === false || typeof speechSynthesis === 'undefined') return;
  const now = Date.now();
  if (text === last.text && now - last.at < 2500) return;
  last = { text, at: now };
  const go = () => {
    if (opts.interrupt) speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const v = pickVoice();
    if (v) u.voice = v;
    u.pitch = 0.2;
    u.rate = 0.82;
    u.volume = 1;
    speechSynthesis.speak(u);
  };
  if (opts.delay) setTimeout(go, opts.delay);
  else go();
}
