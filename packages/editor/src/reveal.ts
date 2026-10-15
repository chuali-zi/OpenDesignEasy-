/** Ephemeral view navigation; never a document command or an approval. */
export type EditorRevealTarget =
  | { kind: 'doc'; sectionId: string; part: 'content' | 'header' | 'footer'; nodeId?: string }
  | { kind: 'deck' | 'web'; pageId: string; nodeId?: string };
export type EditorRevealRequest = { requestId: string; documentId: string; revision: number; target: EditorRevealTarget };
