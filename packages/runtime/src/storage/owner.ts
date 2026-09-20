import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { RuntimeError } from '../errors.ts';

/** A separate SQLite transaction holds the OS lock for the owner's lifetime.
 * The JSON record is diagnostic only: neither PID reuse nor stale files grant ownership.
 * Keep this connection separate from the project's short commit transactions.
 */
export function acquireOwner(root: string): { close(): void; instanceId: string } {
  const database = new DatabaseSync(join(root, 'owner.sqlite'), { timeout: 0 });
  const instanceId = randomUUID();
  const record = { instanceId, pid: process.pid, startedAt: new Date().toISOString(), transport: null };
  try {
    database.exec('PRAGMA journal_mode = DELETE; BEGIN EXCLUSIVE');
  } catch (error) {
    database.close();
    const sqliteError = error as { errcode?: number; code?: string };
    if (sqliteError.errcode === 5 || sqliteError.errcode === 6) {
      throw new RuntimeError('busy', 'The project is open in another runtime. Close that runtime and retry.', { root });
    }
    throw error;
  }
  try {
    writeFileSync(join(root, 'owner.json'), JSON.stringify({ ...record, state: 'active' }, null, 2));
  } catch (error) {
    database.close();
    throw error;
  }
  let closed = false;
  return {
    instanceId,
    close() {
      if (closed) return;
      closed = true;
      try {
        writeFileSync(join(root, 'owner.json'), JSON.stringify({ ...record, state: 'closed' }, null, 2));
      } finally {
        database.close();
      }
    },
  };
}
