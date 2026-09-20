import { ProjectRuntime } from '../../src/index.ts';
import { ProjectStore } from '../../src/storage/project-store.ts';
import { join } from 'node:path';

const [root, mode, documentId] = process.argv.slice(2) as [string, string, string];
try {
  const runtime = ProjectRuntime.open(root);
  if (mode === 'uncommitted') {
    const state = runtime.readDocument(documentId);
    state.revision += 1;
    state.nodes.title!.geometry.x = 999;
    const store = new ProjectStore(join(root, 'project.sqlite'));
    store.transaction(() => {
      store.saveDocument({ document: state, undo: [], redo: [] });
      process.exit(23); // Exit between the first write and COMMIT.
    });
  }
  if (mode === 'hold') {
    runtime.submit(runtime.makeCommand(documentId, [{ type: 'geometry.update', nodeId: 'title', geometry: { x: 55 } }]));
    process.stdout.write('ready\n');
    // The live owner must stay reachable so its SQLite connection keeps the lock.
    setInterval(() => { void runtime.root; }, 1000);
    setTimeout(() => { (globalThis as unknown as { gc?: () => void }).gc?.(); }, 100);
  } else {
    process.stdout.write(JSON.stringify({ ok: true }));
    runtime.close();
  }
} catch (error) {
  process.stdout.write(JSON.stringify({ code: (error as { code?: string }).code, message: String(error) }));
  process.exitCode = 1;
}
