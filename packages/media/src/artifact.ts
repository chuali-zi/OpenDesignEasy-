import { KernelError } from '@oeydesign/document';
import type { EditableDocument } from '@oeydesign/document';
import type { AssetResolver } from './assets.ts';
import type { RenderOptions } from './raster.ts';
import { exportDeckPdf, renderDeckPng } from './raster.ts';
import { exportDeckPptx } from './pptx.ts';
import { exportWebPdf, exportWebSourceZip, exportWebZip, renderWebHtml, renderWebPng } from './web.ts';

export type ArtifactFormat = 'pptx' | 'pdf' | 'png' | 'html' | 'zip' | 'source.zip';

export const artifactMimeTypes: Record<ArtifactFormat, string> = {
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  pdf: 'application/pdf', png: 'image/png', html: 'text/html; charset=utf-8',
  zip: 'application/zip', 'source.zip': 'application/zip',
};

/** All clients export the same committed snapshot through this entry point. */
export async function exportDocumentArtifact(document: EditableDocument, resolveAsset: AssetResolver | undefined,
  format: ArtifactFormat, options: RenderOptions & { pageId?: string } = {}): Promise<Uint8Array> {
  options.signal?.throwIfAborted();
  let result: Uint8Array;
  if (document.kind === 'web') {
    switch (format) {
      case 'html': result = new TextEncoder().encode(await renderWebHtml(document, options.pageId, resolveAsset)); break;
      case 'zip': result = await exportWebZip(document, resolveAsset); break;
      case 'source.zip': result = await exportWebSourceZip(document, resolveAsset); break;
      case 'pdf': result = await exportWebPdf(document, resolveAsset, options); break;
      case 'png': result = await renderWebPng(document, options.pageId, resolveAsset, options); break;
      default: throw new KernelError('invalid', 'Web documents support HTML, ZIP, source.zip, PDF and PNG exports.');
    }
  } else {
    switch (format) {
      case 'pptx': result = await exportDeckPptx(document, resolveAsset); break;
      case 'pdf': result = await exportDeckPdf(document, resolveAsset, options); break;
      case 'png': result = await renderDeckPng(document, options.pageId, resolveAsset, options); break;
      default: throw new KernelError('invalid', 'Deck documents support PPTX, PDF and PNG exports.');
    }
  }
  options.signal?.throwIfAborted();
  return result;
}
