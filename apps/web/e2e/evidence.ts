import { resolve } from 'node:path';

/** Evidence belongs to this checkout by default, including on Windows. */
export const evidencePath = (path: string) => resolve(process.env.OEY_EVIDENCE_DIR ?? '.tmp/evidence', path);
