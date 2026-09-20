import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { imageSize } from 'image-size';
import type { DocumentAsset } from '@oeydesign/document';
import type { ProjectRuntime } from './project-runtime.ts';
import { RuntimeError } from './errors.ts';

export interface StoredAsset {
  id: string; kind: 'image' | 'reference'; name: string; mimeType: string;
  sizeBytes: number; width?: number; height?: number; createdAt: string;
}
const MAX_BYTES = 20 * 1024 * 1024;
const mimeTypes: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };

/** Immutable original files. Registering an asset in a design is a separate document command. */
export class ProjectAssets {
  constructor(private readonly runtime: ProjectRuntime) {}

  async importImage(bytes: Uint8Array, name = 'Image', signal?: AbortSignal): Promise<DocumentAsset> {
    signal?.throwIfAborted();
    if (!bytes.length || bytes.length > MAX_BYTES) throw new RuntimeError('invalid', 'Images must be between 1 byte and 20 MiB.');
    let dimensions: ReturnType<typeof imageSize>;
    try { dimensions = imageSize(bytes); } catch { throw new RuntimeError('invalid', 'The image could not be decoded.'); }
    const mimeType = mimeTypes[dimensions.type ?? ''];
    if (!mimeType || !dimensions.width || !dimensions.height || dimensions.width * dimensions.height > 100_000_000) {
      throw new RuntimeError('invalid', 'Use a PNG, JPEG or WebP image below 100 megapixels.');
    }
    const asset: StoredAsset = { id: `asset-${randomUUID()}`, kind: 'image', name: basename(name).slice(0, 240), mimeType,
      sizeBytes: bytes.length, width: dimensions.width, height: dimensions.height, createdAt: new Date().toISOString() };
    await this.store(asset, bytes, signal);
    return asset as unknown as DocumentAsset;
  }

  async importReference(bytes: Uint8Array, name: string, signal?: AbortSignal): Promise<StoredAsset> {
    if (!bytes.length || bytes.length > MAX_BYTES) throw new RuntimeError('invalid', 'References must be between 1 byte and 20 MiB.');
    const extension = name.split('.').at(-1)?.toLowerCase();
    if (!['txt', 'md', 'csv', 'json'].includes(extension ?? '')) throw new RuntimeError('invalid', 'Reference reading currently accepts TXT, Markdown, CSV and JSON. Images use image import.');
    const asset: StoredAsset = { id: `reference-${randomUUID()}`, kind: 'reference', name: basename(name).slice(0, 240),
      mimeType: extension === 'json' ? 'application/json' : extension === 'csv' ? 'text/csv' : 'text/plain', sizeBytes: bytes.length, createdAt: new Date().toISOString() };
    await this.store(asset, bytes, signal);
    return asset;
  }

  list(): StoredAsset[] { return this.runtime.listRecords<StoredAsset>('assets').map(record => record.value); }

  async read(id: string): Promise<{ asset: StoredAsset; bytes: Uint8Array }> {
    if (!/^(asset|reference)-[a-f0-9-]{36}$/.test(id)) throw new RuntimeError('invalid', 'Invalid asset ID.');
    const asset = this.runtime.getRecord<StoredAsset>('assets', id);
    if (!asset) throw new RuntimeError('not_found', 'Asset not found.');
    return { asset, bytes: await readFile(join(this.runtime.root, 'assets', `${id}.bin`)) };
  }

  readonly resolve = async (id: string): Promise<Uint8Array> => (await this.read(id)).bytes;

  async readReference(id: string, offset = 0, limit = 12000) {
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 50000) throw new RuntimeError('invalid', 'Use a non-negative offset and a limit between 1 and 50000.');
    const { asset, bytes } = await this.read(id);
    if (asset.kind !== 'reference') throw new RuntimeError('invalid', 'Use the image asset as a visual reference.');
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return { asset, offset, text: text.slice(offset, offset + limit), totalCharacters: text.length, hasMore: offset + limit < text.length };
  }

  private async store(asset: StoredAsset, bytes: Uint8Array, signal?: AbortSignal) {
    const directory = join(this.runtime.root, 'assets');
    await mkdir(directory, { recursive: true });
    const final = join(directory, `${asset.id}.bin`);
    const temporary = `${final}.tmp`;
    try {
      await writeFile(temporary, bytes, { flag: 'wx', signal });
      signal?.throwIfAborted();
      await rename(temporary, final);
      signal?.throwIfAborted();
      this.runtime.putRecord('assets', asset.id, asset);
    } finally { await unlink(temporary).catch(() => {}); }
  }
}

export interface ImageGenerationConfig { endpoint: string; model: string; apiKeyEnv: string }

export async function generateImage(assets: ProjectAssets, prompt: string, config: ImageGenerationConfig, signal?: AbortSignal): Promise<DocumentAsset> {
  if (!prompt.trim()) throw new RuntimeError('invalid', 'An image prompt is required.');
  const key = process.env[config.apiKeyEnv];
  if (!key) throw new RuntimeError('invalid', `Set ${config.apiKeyEnv} to use image generation.`);
  const endpoint = new URL(config.endpoint);
  if (endpoint.protocol !== 'https:' && endpoint.hostname !== '127.0.0.1' && endpoint.hostname !== 'localhost') throw new RuntimeError('invalid', 'Image generation endpoints require HTTPS.');
  const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(180000)]) : AbortSignal.timeout(180000);
  const response = await fetch(endpoint, { method: 'POST', signal: requestSignal, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: config.model, prompt, size: '2K', response_format: 'b64_json', watermark: false }) });
  if (!response.ok) throw new RuntimeError('invalid', `Image service returned HTTP ${response.status}.`);
  const result = await response.json() as { data?: Array<{ b64_json?: string; url?: string }> };
  const image = result.data?.[0];
  let bytes: Uint8Array;
  if (image?.b64_json) bytes = Buffer.from(image.b64_json, 'base64');
  else if (image?.url) {
    if (new URL(image.url).protocol !== 'https:') throw new RuntimeError('invalid', 'Image service returned a non-HTTPS download.');
    const download = await fetch(image.url, { signal: requestSignal });
    if (!download.ok || Number(download.headers.get('content-length') ?? 0) > MAX_BYTES) throw new RuntimeError('invalid', 'Image download failed or exceeds 20 MiB.');
    bytes = new Uint8Array(await download.arrayBuffer());
  } else throw new RuntimeError('invalid', 'Image service returned no image.');
  requestSignal.throwIfAborted();
  return assets.importImage(bytes, prompt.slice(0, 80), requestSignal);
}
