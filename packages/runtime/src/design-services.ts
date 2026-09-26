import { randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { exportDocumentArtifact } from '@oeydesign/media';
import type { ArtifactFormat } from '@oeydesign/media';
import { ProjectAssets, generateImage } from './assets.ts';
import type { ProjectRuntime } from './project-runtime.ts';
import { RuntimeError } from './errors.ts';

export interface AgentDesignServices {
  readReference(args: { assetId: string; offset?: number; limit?: number }, signal: AbortSignal): Promise<unknown>;
  importAsset(args: { path: string }, signal: AbortSignal): Promise<unknown>;
  generateAsset(args: { prompt: string }, signal: AbortSignal): Promise<unknown>;
  preview(args: { documentId: string; pageId?: string }, signal: AbortSignal): Promise<{ revision: number; mimeType: 'image/png'; data: string }>;
  exportArtifact(args: { documentId: string; format: ArtifactFormat }, signal: AbortSignal): Promise<unknown>;
}

export function createDesignServices(runtime: ProjectRuntime): AgentDesignServices {
  const assets = new ProjectAssets(runtime);
  return {
    async readReference(args, signal) {
      signal.throwIfAborted();
      const { asset, bytes } = await assets.read(args.assetId);
      if (asset.kind === 'image') return { asset, mimeType: asset.mimeType, data: Buffer.from(bytes).toString('base64') };
      return assets.readReference(args.assetId, args.offset, args.limit);
    },
    async importAsset(args, signal) {
      const directory = join(runtime.root, 'references');
      await mkdir(directory, { recursive: true });
      const source = await realpath(resolve(directory, args.path));
      const path = relative(await realpath(directory), source);
      if (path.startsWith('..') || isAbsolute(path)) throw new RuntimeError('invalid', 'Agent imports must be inside the project references directory.');
      const bytes = await readFile(source, { signal });
      return /\.(png|jpe?g|webp)$/i.test(source) ? assets.importImage(bytes, basename(source), signal) : assets.importReference(bytes, basename(source), signal);
    },
    async generateAsset(args, signal) {
      const endpoint = process.env.ARK_BASE_URL;
      const model = process.env.ARK_MODEL_ID;
      if (!endpoint || !model) throw new RuntimeError('invalid', 'Configure ARK_BASE_URL, ARK_MODEL_ID and ARK_API_KEY to generate images.');
      return generateImage(assets, args.prompt, { endpoint, model, apiKeyEnv: 'ARK_API_KEY' }, signal);
    },
    async preview(args, signal) {
      signal.throwIfAborted();
      const document = runtime.readDocument(args.documentId);
      const bytes = await exportDocumentArtifact(document, assets.resolve, 'png', { signal, pageId: args.pageId });
      signal.throwIfAborted();
      return { revision: document.revision, mimeType: 'image/png', data: Buffer.from(bytes).toString('base64') };
    },
    async exportArtifact(args, signal) {
      signal.throwIfAborted();
      const document = runtime.readDocument(args.documentId);
      const bytes = await exportDocumentArtifact(document, assets.resolve, args.format, { signal });
      signal.throwIfAborted();
      const id = `export-${randomUUID()}`;
      const directory = join(runtime.root, 'exports');
      await mkdir(directory, { recursive: true });
      const path = join(directory, `${id}.${args.format}`);
      await writeFile(`${path}.tmp`, bytes, { signal });
      signal.throwIfAborted();
      await rename(`${path}.tmp`, path);
      const result = { id, documentId: document.documentId, revision: document.revision, format: args.format, filename: basename(path), sizeBytes: bytes.length, createdAt: new Date().toISOString() };
      signal.throwIfAborted();
      runtime.putRecord('exports', id, result);
      return result;
    },
  };
}
