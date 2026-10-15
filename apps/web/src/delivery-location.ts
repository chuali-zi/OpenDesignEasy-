import type { EditableDocument, PMNodeJSON } from '@oeydesign/document';
import type { DeliveryLocation } from '@oeydesign/media';
import type { EditorRevealTarget } from '@oeydesign/editor';

function hasBlock(content: PMNodeJSON | undefined, id: string): boolean {
  return !!content && (content.attrs?.id === id || (content.content ?? []).some(child => hasBlock(child, id)));
}

/** Resolve against the canonical snapshot, never guess a missing/ambiguous object. */
export function resolveDeliveryLocation(document: EditableDocument, location: DeliveryLocation): EditorRevealTarget | null {
  if (document.kind === 'doc') {
    const section = document.sections.find(item => item.id === location.sectionId);
    const part = location.part ?? 'content';
    if (!section || !['content', 'header', 'footer'].includes(part)) return null;
    const key = part as 'content' | 'header' | 'footer';
    if (location.nodeId && !hasBlock(section[key], location.nodeId)) return null;
    return { kind: 'doc', sectionId: section.id, part: key, ...(location.nodeId ? { nodeId: location.nodeId } : {}) };
  }
  const page = document.pages.find(item => item.id === location.pageId);
  if (!page) return null;
  if (!location.nodeId) return { kind: document.kind, pageId: page.id };
  const id = location.nodeId;
  // Rich-text/table findings can refer to a child block/cell instead of its scene owner.
  const candidates = document.kind === 'deck'
    ? Object.values(document.nodes).filter(node => node.id === id || hasBlock(node.content, id) || node.table?.rows.some(row => row.cells.some(cell => cell.id === id || hasBlock(cell.content, id))))
    : Object.values(document.nodes).filter(node => node.id === id || hasBlock(node.content, id));
  const matching = candidates.filter(node => {
    const seen = new Set<string>();
    for (let cursor: typeof node | undefined = node; cursor; cursor = document.nodes[cursor.parentId ?? ''] as typeof node | undefined) {
      if (cursor.hidden || seen.has(cursor.id)) return false;
      seen.add(cursor.id);
      if ('rootId' in page ? cursor.id === page.rootId : cursor.parentId === page.id) return true;
    }
    return false;
  });
  return matching.length === 1 ? { kind: document.kind, pageId: page.id, nodeId: matching[0]!.id } : null;
}
