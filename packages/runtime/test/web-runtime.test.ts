import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import test from 'node:test';
import { ProjectRuntime } from '../src/index.ts';

function project(t: { after(fn: () => void): void }) {
  const parent = realpathSync(tmpdir());
  const directory = mkdtempSync(join(parent, 'oey-web-'));
  t.after(() => { const target = resolve(directory); assert.ok(target.startsWith(parent + sep)); rmSync(target, { recursive: true, force: true }); });
  const runtime = ProjectRuntime.create(directory);
  const document = runtime.createDocument({ kind: 'web', documentId: 'site', name: 'Site' });
  return { directory, runtime, document };
}

test('Web tree edits validate roots, cycles and ancestor locks', t => {
  const { runtime, document } = project(t);
  const root = document.pages[0]!.rootId;
  const box = { id: 'box', parentId: root, tag: 'section', children: [], style: {}, layout: { mode: 'flex' as const } };
  const leaf = { id: 'leaf', parentId: 'box', tag: 'p', children: [], style: {}, layout: { mode: 'flow' as const }, text: 'Hello' };
  try {
    runtime.submit(runtime.makeCommand('site', [{ type: 'web.node.insert', node: box }]));
    runtime.submit(runtime.makeCommand('site', [{ type: 'web.node.insert', node: leaf }]));
    assert.throws(() => runtime.submit(runtime.makeCommand('site', [{ type: 'web.node.remove', nodeId: root }])), { code: 'invalid' });
    assert.throws(() => runtime.submit(runtime.makeCommand('site', [{ type: 'web.node.reparent', nodeId: 'box', parentId: 'leaf' }])), { code: 'invalid' });
    runtime.submit(runtime.makeCommand('site', [{ type: 'web.node.update', nodeId: 'box', flags: { locked: true } }]));
    assert.throws(() => runtime.submit(runtime.makeCommand('site', [{ type: 'web.node.update', nodeId: 'leaf', text: 'blocked' }])), { code: 'locked' });
    runtime.submit(runtime.makeCommand('site', [{ type: 'web.node.update', nodeId: 'box', flags: { locked: false } }]));
    runtime.submit(runtime.makeCommand('site', [{ type: 'web.node.update', nodeId: 'leaf', text: 'unlocked' }]));
    assert.equal(runtime.readWebDocument('site').nodes.leaf!.text, 'unlocked');
  } finally { runtime.close(); }
});

test('Web stale edits merge independent properties and reject same property conflicts', t => {
  const { runtime, document } = project(t);
  const rootId = document.pages[0]!.rootId;
  try {
    runtime.submit(runtime.makeCommand('site', [{ type: 'web.style.update', nodeId: rootId, style: { color: 'black' } }]));
    const old = runtime.readWebDocument('site');
    const staleWidth = runtime.makeCommand('site', [{ type: 'web.style.update', nodeId: rootId, style: { width: '100%' } }]);
    const staleColor = runtime.makeCommand('site', [{ type: 'web.style.update', nodeId: rootId, style: { color: 'red' } }]);
    runtime.submit(runtime.makeCommand('site', [{ type: 'web.style.update', nodeId: rootId, style: { color: 'blue' } }]));
    runtime.submit(staleWidth);
    assert.throws(() => runtime.submit(staleColor), { code: 'conflict' });
    assert.equal(runtime.readWebDocument('site').nodes[rootId]!.style.width, '100%');
    assert.equal(old.revision + 2, runtime.readWebDocument('site').revision);
  } finally { runtime.close(); }
});

test('Web stale subtree deletion protects descendant edits and same-batch new parents work', t => {
  const { runtime, document } = project(t);
  const rootId = document.pages[0]!.rootId;
  const box = { id: 'box', parentId: rootId, tag: 'section', children: [], style: {}, layout: { mode: 'flow' as const } };
  const leaf = { id: 'leaf', parentId: 'box', tag: 'p', children: [], style: {}, layout: { mode: 'flow' as const }, text: 'before' };
  try {
    runtime.submit(runtime.makeCommand('site', [
      { type: 'web.node.insert', node: box },
      { type: 'web.node.insert', node: leaf },
    ]));
    const staleRemove = runtime.makeCommand('site', [{ type: 'web.node.remove', nodeId: 'box' }]);
    runtime.submit(runtime.makeCommand('site', [{ type: 'web.node.update', nodeId: 'leaf', text: 'after' }]));
    assert.throws(() => runtime.submit(staleRemove), { code: 'conflict' });

    const staleBase = runtime.readWebDocument('site').revision;
    runtime.submit(runtime.makeCommand('site', [{ type: 'web.style.update', nodeId: rootId, style: { color: 'navy' } }]));
    const createNested = runtime.makeCommand('site', [
      { type: 'web.node.insert', node: { id: 'new-parent', parentId: rootId, tag: 'div', children: [], style: {}, layout: { mode: 'flex' as const } } },
      { type: 'web.node.insert', node: { id: 'new-child', parentId: 'new-parent', tag: 'span', children: [], style: {}, layout: { mode: 'flow' as const } } },
      { type: 'web.node.remove', nodeId: 'new-parent' },
    ], { baseRevision: staleBase });
    runtime.submit(createNested);
    assert.equal(runtime.readWebDocument('site').nodes['new-parent'], undefined);
    assert.equal(runtime.readWebDocument('site').nodes['new-child'], undefined);
  } finally { runtime.close(); }
});

test('source edits conflict on stale module content and history survives reopen', t => {
  const { directory, runtime } = project(t);
  const first = { id: 'hero', path: 'hero.tsx', language: 'tsx' as const, source: 'export function Hero() { return null }' };
  try {
    runtime.submit(runtime.makeCommand('site', [{ type: 'source.update', module: first }]));
    const stale = runtime.makeCommand('site', [{ type: 'source.update', module: { ...first, source: 'export function Hero() { return <h1>Old</h1> }' } }]);
    runtime.submit(runtime.makeCommand('site', [{ type: 'source.update', module: { ...first, source: 'export function Hero() { return <h1>New</h1> }' } }]));
    assert.throws(() => runtime.submit(stale), { code: 'conflict' });
    runtime.undo('site');
    runtime.close();
    const reopened = ProjectRuntime.open(directory);
    try {
      assert.equal(reopened.readWebDocument('site').sourceModules?.[0]?.source, first.source);
      reopened.redo('site');
      assert.equal(reopened.readWebDocument('site').sourceModules?.[0]?.source, 'export function Hero() { return <h1>New</h1> }');
    } finally { reopened.close(); }
  } catch (error) { try { runtime.close(); } catch {} throw error; }
});

test('Web commands reject unknown operations and inherited targets without changing history', t => {
  const { runtime, document } = project(t);
  const root = document.pages[0]!.rootId;
  try {
    const before = runtime.readWebDocument('site');
    const events = runtime.events().length;
    for (const operation of [
      { type: 'web.unknown' },
      { type: 'source.unknown' },
      { type: 'web.node.update', nodeId: '__proto__', text: 'bad' },
      { type: 'web.node.update', nodeId: 'constructor', props: { poisoned: true } },
    ]) {
      const command = runtime.makeCommand('site', [{ type: 'web.node.update', nodeId: root, text: 'must roll back' }, operation as never]);
      assert.throws(() => runtime.submit(command));
      assert.deepEqual(runtime.readWebDocument('site'), before);
      assert.equal(runtime.events().length, events);
    }
    assert.equal(({} as Record<string, unknown>).poisoned, undefined);
  } finally { runtime.close(); }
});

test('Web positioned edits conflict after reparenting or changing their breakpoint', t => {
  const { runtime, document } = project(t);
  const root = document.pages[0]!.rootId;
  try {
    runtime.submit(runtime.makeCommand('site', [
      { type: 'web.node.insert', node: { id: 'box', parentId: root, tag: 'div', children: [], style: {}, layout: { mode: 'flow' } } },
      { type: 'web.node.insert', node: { id: 'item', parentId: root, tag: 'p', children: [], style: {}, layout: { mode: 'position' } } },
      { type: 'web.breakpoints.update', breakpoints: [{ id: 'mobile', maxWidth: 600 }] },
    ]));
    const position = runtime.makeCommand('site', [{ type: 'web.style.update', nodeId: 'item', style: { left: 40 } }]);
    runtime.submit(runtime.makeCommand('site', [{ type: 'web.node.reparent', nodeId: 'item', parentId: 'box' }]));
    assert.throws(() => runtime.submit(position), { code: 'conflict' });
    const responsive = runtime.makeCommand('site', [{ type: 'web.style.update', nodeId: 'item', style: { width: 200 }, breakpointId: 'mobile' }]);
    runtime.submit(runtime.makeCommand('site', [{ type: 'web.breakpoints.update', breakpoints: [{ id: 'mobile', maxWidth: 700 }] }]));
    assert.throws(() => runtime.submit(responsive), { code: 'conflict' });
  } finally { runtime.close(); }
});
