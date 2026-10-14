import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright';
import { InMemoryCredentialStore, fauxAssistantMessage, fauxProvider, fauxToolCall } from '@earendil-works/pi-ai';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { ProjectRuntime, createDesignServices } from '../src/index.ts';
import { createVisionWeb } from './fixtures/vision-web.ts';

test('agent receives real React screenshots at desktop and mobile widths, with revision and visual-repair guidance', { timeout: 120_000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'oey-vision-preview-'));
  const faux = fauxProvider({ provider: 'oey-vision-preview-test', models: [{ id: 'test', input: ['text', 'image'] }] });
  const runtime = ProjectRuntime.create(root, { name: 'Synthetic preview transport', agentService: { async createModelRuntime() {
    const modelRuntime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
    modelRuntime.registerNativeProvider(faux.provider);
    return { modelRuntime, model: faux.getModel() };
  } } });
  t.after(async () => { runtime.close(); await rm(root, { recursive: true, force: true }); });
  runtime.agent.configureTools(createDesignServices(runtime));
  const document = createVisionWeb(runtime);
  const previews: string[] = [];
  faux.setResponses([
    fauxAssistantMessage([
      fauxToolCall('render_preview', { documentId: document.documentId, viewport: 'desktop' }, { id: 'desktop' }),
      fauxToolCall('render_preview', { documentId: document.documentId, viewport: 'mobile' }, { id: 'mobile' }),
    ], { stopReason: 'toolUse' }),
    context => {
      assert.match(context.systemPrompt!, /After important layout changes and before final delivery/);
      assert.match(context.systemPrompt!, /then render again/);
      for (const [id, width] of [['desktop', 1280], ['mobile', 390]] as const) {
        const result = context.messages.find(message => message.role === 'toolResult' && message.toolCallId === id);
        assert.ok(result && result.role === 'toolResult' && !result.isError, result && result.role === 'toolResult' ? JSON.stringify(result.content.filter(part => part.type === 'text')) : 'Missing preview');
        const image = result.content.find(part => part.type === 'image');
        assert.ok(image && image.type === 'image');
        const png = Buffer.from(image.data, 'base64');
        assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
        assert.equal(png.readUInt32BE(16), width, 'overflow must not widen the viewport screenshot');
        assert.ok(result.content.some(part => part.type === 'text' && part.text.includes('"renderMode":"react"') && part.text.includes(`revision ${document.revision}`)));
        previews.push(image.data);
      }
      return fauxAssistantMessage('Preview transport verified.', { stopReason: 'stop' });
    },
  ]);
  const session = await runtime.agent.createSession();
  const run = await runtime.agent.send(session.sessionId, 'Inspect.', { documentId: document.documentId });
  await runtime.agent.waitForIdle(session.sessionId);
  assert.equal(runtime.agent.getRun(run.runId)?.status, 'completed', runtime.agent.getRun(run.runId)?.error);
  assert.equal(previews.length, 2);
  assert.equal(runtime.readDocument(document.documentId).revision, document.revision);

  // Verify component pixels, not merely that a PNG was returned.
  const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'chrome' : undefined, headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<img src="data:image/png;base64,${previews[1]}">`);
    const pixel = await page.evaluate(async () => {
      const image = window.document.images[0]!;
      await image.decode();
      const canvas = window.document.createElement('canvas');
      canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0);
      return Array.from(context.getImageData(40, 40, 1, 1).data);
    });
    assert.deepEqual(pixel, [20, 83, 45, 255], 'the green React hero must actually render');
  } finally { await browser.close(); }
  const staticWeb = runtime.createDocument({ kind: 'web', name: 'Native Web preview' });
  const staticPreview = await createDesignServices(runtime).preview({ documentId: staticWeb.documentId, viewport: 'mobile' }, new AbortController().signal);
  assert.equal(staticPreview.renderMode, 'static');
  assert.equal(Buffer.from(staticPreview.data, 'base64').readUInt32BE(16), 390);
  const deck = runtime.createDocument({ name: 'Native Deck preview' });
  const deckPreview = await createDesignServices(runtime).preview({ documentId: deck.documentId }, new AbortController().signal);
  assert.equal(deckPreview.renderMode, 'deck');
  assert.equal(Buffer.from(deckPreview.data, 'base64').readUInt32BE(16), deck.pages[0]!.width);
  const cancelled = new AbortController(); cancelled.abort(new Error('cancel preview'));
  await assert.rejects(createDesignServices(runtime).preview({ documentId: document.documentId }, cancelled.signal), /cancel preview/);
  await assert.rejects(createDesignServices(runtime).preview({ documentId: document.documentId, pageId: 'missing' }, new AbortController().signal), /does not exist/);
});
