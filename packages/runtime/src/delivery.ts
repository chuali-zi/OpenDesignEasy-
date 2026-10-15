import { createHash } from 'node:crypto';
import { imageSize } from 'image-size';
import { defaultDeliveryFormat, deliveryFormats, inspectDelivery, packageDelivery, exportDocumentArtifact, docPdfEngine } from '@oeydesign/media';
import type { ArtifactFormat, DeliveryManifest, DeliveryReport } from '@oeydesign/media';
import type { EditableDocument, PMNodeJSON } from '@oeydesign/document';
import { ProjectAssets } from './assets.ts';
import type { ProjectRuntime } from './project-runtime.ts';
import { RuntimeError } from './errors.ts';

const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : item);
}

export interface DeliveryOptions { format?: ArtifactFormat; expectedRevision?: number; signal?: AbortSignal }

function assertRevision(runtime: ProjectRuntime, documentId: string, revision: number) {
  if (runtime.readDocument(documentId).revision !== revision) throw new RuntimeError('conflict', '文档已更新，请重新检查当前版本后交付。');
}

async function prepare(runtime: ProjectRuntime, documentId: string, options: DeliveryOptions) {
  options.signal?.throwIfAborted();
  const document = runtime.readDocument(documentId);
  if (options.expectedRevision !== undefined && (!Number.isSafeInteger(options.expectedRevision) || options.expectedRevision < 0)) throw new RuntimeError('invalid', 'expectedRevision 必须为非负整数。');
  if (options.expectedRevision !== undefined && document.revision !== options.expectedRevision) throw new RuntimeError('conflict', '文档已更新，请重新检查当前版本后交付。');
  const format = options.format ?? defaultDeliveryFormat(document.kind);
  if (!deliveryFormats[document.kind].includes(format)) throw new RuntimeError('invalid', '此文档不支持所选交付格式。');
  const report: DeliveryReport = {
    schemaVersion: 1, documentId, kind: document.kind, name: document.name, revision: document.revision, format,
    documentSha256: sha256(canonical(document)), assets: [], findings: inspectDelivery(document, format),
    summary: { errors: 0, warnings: 0 },
    checks: [
      { id: 'structure', status: 'checked', detail: '统一文档模型、待完成文案和有限静态几何/链接检查。' },
      { id: 'assets', status: 'checked', detail: '所注册图片及模板原件的实际字节、尺寸、类型和已有摘要。' },
      { id: 'visual', status: 'not-run', detail: '未测量文字溢出、遮挡、浏览器断点或真实分页；请预览并审阅。' },
      { id: 'native-app', status: 'not-run', detail: '未在 Microsoft Word/PowerPoint 打开本次文件，导出成功不代表 Office 验收。' },
      { id: 'facts', status: 'not-run', detail: '未核实事实、数值、引用来源或资产许可。' },
    ],
  };
  const metadata = new Map((Array.isArray(document.assets) ? document.assets : Object.values(document.assets ?? {})).map(asset => [asset.id, asset]));
  const ids = new Set(metadata.keys());
  const pm = (node: PMNodeJSON) => {
    if ((node.type === 'inline_image' || node.type === 'floating_image') && typeof node.attrs?.assetId === 'string') ids.add(node.attrs.assetId);
    for (const child of node.content ?? []) pm(child);
  };
  if (document.kind === 'doc') {
    for (const section of document.sections) for (const part of ['content', 'header', 'footer'] as const) if (section[part]) pm(section[part]!);
    if (document.templateSource) ids.add(document.templateSource.assetId);
  } else if (document.kind === 'deck') {
    for (const node of Object.values(document.nodes)) if (node.assetId) ids.add(node.assetId);
  } else for (const node of Object.values(document.nodes)) if (typeof node.props?.assetId === 'string') ids.add(node.props.assetId);
  if (ids.size > 512) throw new RuntimeError('invalid', '单次交付最多检查 512 个素材。');
  const assets = new ProjectAssets(runtime);
  const frozenAssets = new Map<string, Uint8Array>();
  let totalBytes = 0;
  for (const id of [...ids].sort()) {
    options.signal?.throwIfAborted();
    try {
      const { asset, bytes } = await assets.read(id);
      options.signal?.throwIfAborted();
      totalBytes += bytes.length;
      if (totalBytes > 128 * 1024 * 1024) throw new RuntimeError('invalid', '单次交付素材不能超过 128 MiB。');
      if (bytes.length !== asset.sizeBytes) throw new Error('Asset size mismatch');
      const hash = sha256(bytes), declared = metadata.get(id);
      if (asset.sha256 && asset.sha256 !== hash) throw new Error('Stored asset checksum mismatch');
      if (declared?.sha256 && declared.sha256 !== hash) throw new Error('Asset checksum mismatch');
      if (declared) {
        const dimensions = imageSize(bytes);
        const mime = ({ png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' } as Record<string, string>)[dimensions.type ?? ''];
        if (dimensions.width !== declared.width || dimensions.height !== declared.height || mime !== declared.mimeType) throw new Error('Asset metadata mismatch');
      }
      if (document.kind === 'doc' && document.templateSource?.assetId === id && hash !== document.templateSource.sourceHash) throw new Error('Template checksum mismatch');
      frozenAssets.set(id, bytes);
      report.assets.push({ id, sha256: hash, sizeBytes: bytes.length, mimeType: asset.mimeType });
    } catch (error) {
      options.signal?.throwIfAborted();
      if (totalBytes > 128 * 1024 * 1024) throw new RuntimeError('invalid', '单次交付素材不能超过 128 MiB。');
      // Do not leak local filesystem paths in the public report.
      report.findings.push({ code: 'asset.unavailable', severity: 'error', message: `素材 ${id} 缺失或字节与登记信息不一致，请重新导入。`, location: {} });
    }
  }
  assertRevision(runtime, documentId, document.revision);
  report.summary = { errors: report.findings.filter(item => item.severity === 'error').length, warnings: report.findings.filter(item => item.severity === 'warning').length };
  return { document, report, frozenAssets };
}

/** A check is a read, never a design command or a persisted approval. */
export async function checkDelivery(runtime: ProjectRuntime, documentId: string, options: DeliveryOptions = {}): Promise<DeliveryReport> {
  return (await prepare(runtime, documentId, options)).report;
}

/** Re-check and export the exact same snapshot and material bytes. No project files are written. */
export async function createDeliveryBundle(runtime: ProjectRuntime, documentId: string,
  options: DeliveryOptions & { expectedRevision: number }): Promise<{ bytes: Uint8Array; manifest: DeliveryManifest }> {
  if (options.expectedRevision === undefined) throw new RuntimeError('invalid', '交付需要 expectedRevision。');
  const { document, report, frozenAssets } = await prepare(runtime, documentId, options);
  if (report.summary.errors) throw new RuntimeError('invalid', '交付检查发现错误，请修复后重试。', { report });
  const resolve = async (id: string) => {
    options.signal?.throwIfAborted();
    const bytes = frozenAssets.get(id);
    if (!bytes) throw new RuntimeError('invalid', '导出请求了未检查的素材。');
    return bytes;
  };
  const artifact = await exportDocumentArtifact(document, resolve, report.format, { signal: options.signal });
  options.signal?.throwIfAborted();
  // The bundle records export engine truth without turning it into an Office approval.
  report.checks.push({ id: 'export', status: 'checked', detail: `已生成 ${report.format}${document.kind === 'doc' && report.format === 'pdf' ? `（${docPdfEngine()}）` : ''}；文件摘要见 artifact。` });
  const manifest: DeliveryManifest = { schemaVersion: 1, report, artifact: {
    filename: `${document.kind}-r${document.revision}.${report.format}`, sha256: sha256(artifact), sizeBytes: artifact.length,
  } };
  const bytes = await packageDelivery(manifest, artifact, options.signal);
  options.signal?.throwIfAborted();
  assertRevision(runtime, documentId, document.revision);
  return { bytes, manifest };
}
