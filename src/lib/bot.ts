// Engine line scoring shared by the trainers.
import type { EngineLine } from './engine';

export const lineScore = (l: EngineLine) => (l.mate !== undefined ? Math.sign(l.mate || -1) * (10000 - Math.abs(l.mate) * 10) : l.cp ?? 0);
