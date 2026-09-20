export type JSONValue = null | boolean | number | string | JSONValue[] | { [key: string]: JSONValue };
export type PMNodeJSON = { type: string; attrs?: Record<string, JSONValue>; content?: PMNodeJSON[]; marks?: PMMarkJSON[]; text?: string };
export type PMMarkJSON = { type: string; attrs?: Record<string, JSONValue> };

export type Geometry = { x: number; y: number; width: number; height: number; rotation: number };
export type Style = Record<string, JSONValue | undefined>;
export type DeckNodeKind = "text" | "shape" | "image" | "group";

export type DeckNode = {
  id: string;
  kind: DeckNodeKind;
  parentId: string;
  geometry: Geometry;
  style: Style;
  locked: boolean;
  hidden: boolean;
  content?: PMNodeJSON;
  children?: string[];
  assetId?: string;
  [key: string]: unknown;
};

export type DeckPage = { id: string; name: string; width: number; height: number; children: string[] };
export type DocumentAsset = { id: string; [key: string]: unknown };
export type AssetCollection = DocumentAsset[] | Record<string, DocumentAsset>;
export type DesignConstraints = Record<string, JSONValue | undefined>;

export type DeckDocument = {
  schemaVersion: 1;
  documentId: string;
  kind: "deck";
  revision: number;
  name: string;
  assets?: AssetCollection;
  constraints?: DesignConstraints;
  pages: DeckPage[];
  nodes: Record<string, DeckNode>;
};

/** Shared identity boundary. Web and document media schemas are intentionally not implemented here. */
export type DocumentHeader = {
  schemaVersion: 1;
  documentId: string;
  kind: "deck" | "web" | "doc";
  revision: number;
  name: string;
  assets?: AssetCollection;
  constraints?: DesignConstraints;
};
/** Boundary-only Web model. Editing operations for this schema are intentionally not implemented by R1. */
export type WebLayoutMode = "flow" | "flex" | "grid" | "position";
export type WebBreakpoint = { id: string; minWidth?: number; maxWidth?: number };
export type WebLayout = { mode: WebLayoutMode; order?: number; gridColumn?: string; gridRow?: string; position?: "static" | "relative" | "absolute" | "fixed"; [key: string]: JSONValue | undefined };
export type WebNode = { id: string; parentId: string | null; tag: string; children: string[]; style: Record<string, JSONValue | undefined>; layout: WebLayout; props?: Record<string, JSONValue | undefined> };
export type WebPage = { id: string; name: string; route: string; rootId: string; breakpoints?: WebBreakpoint[] };
export type WebSourceModule = { id: string; path: string; language: "ts" | "tsx" | "css"; source: string; exports?: string[] };
export type WebDocument = DocumentHeader & { kind: "web"; pages: WebPage[]; nodes: Record<string, WebNode>; breakpoints?: WebBreakpoint[]; sourceModules?: WebSourceModule[] };

/** Boundary-only Doc model. Full section editing and pagination are intentionally not implemented by R1. */
export type DocPageSettings = { width: number; height: number; marginTop: number; marginRight: number; marginBottom: number; marginLeft: number; [key: string]: JSONValue | undefined };
export type DocSection = { id: string; name: string; content: PMNodeJSON; pageSettings?: DocPageSettings; styleId?: string };
export type DocDocument = DocumentHeader & { kind: "doc"; content: PMNodeJSON; sections: DocSection[]; pageSettings: DocPageSettings; styles?: Record<string, Record<string, JSONValue | undefined>> };
export type AnyDocument = DeckDocument | WebDocument | DocDocument;

export type ActorKind = "human" | "agent" | "system";
export type EditPrecondition =
  | { type: "node.exists"; nodeId: string; exists?: boolean }
  | { type: "node.property"; nodeId: string; path: string; value: unknown }
  | { type: "node.parent"; nodeId: string; parentId: string }
  | { type: "page.children"; pageId: string; children: string[] }
  | { type: "text.version"; nodeId: string; value: unknown };

export type PageInsertOperation = { type: "page.insert"; page: DeckPage; index?: number };
export type NodeInsertOperation = { type: "node.insert"; node: DeckNode; index?: number; parentId?: string };
export type NodeRemoveOperation = { type: "node.remove"; nodeId: string };
export type NodeReorderOperation = { type: "node.reorder"; nodeId: string; index: number; parentId?: string };
export type NodeReparentOperation = { type: "node.reparent"; nodeId: string; parentId: string; index?: number };
export type GeometryUpdateOperation = { type: "geometry.update"; nodeId: string; geometry: Partial<Geometry> };
export type StyleUpdateOperation = { type: "style.update"; nodeId: string; style: Style };
export type FlagsUpdateOperation = { type: "node.flags.update"; nodeId: string; flags: Partial<Pick<DeckNode, "locked" | "hidden">> };
export type TextApplyOperation = { type: "text.apply"; nodeId: string; steps: unknown[]; schema?: unknown };
export type DocumentOperation = PageInsertOperation | NodeInsertOperation | NodeRemoveOperation | NodeReorderOperation | NodeReparentOperation | GeometryUpdateOperation | StyleUpdateOperation | FlagsUpdateOperation | TextApplyOperation;

export type CommandEnvelope = {
  commandId: string;
  projectId: string;
  documentId: string;
  actorId: string;
  actorKind: ActorKind;
  clientId: string;
  runId?: string;
  baseRevision: number;
  preconditions: EditPrecondition[];
  operations: DocumentOperation[];
  label: string;
};
