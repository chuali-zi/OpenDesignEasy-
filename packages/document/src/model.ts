export type JSONValue = null | boolean | number | string | JSONValue[] | { [key: string]: JSONValue };
export type PMNodeJSON = { type: string; attrs?: Record<string, JSONValue>; content?: PMNodeJSON[]; marks?: PMMarkJSON[]; text?: string };
export type PMMarkJSON = { type: string; attrs?: Record<string, JSONValue> };

export type Geometry = { x: number; y: number; width: number; height: number; rotation: number };
export type Style = Record<string, JSONValue | undefined>;
export type DeckNodeKind = "text" | "shape" | "image" | "group" | "table" | "chart";

export type ImageMimeType = "image/png" | "image/jpeg" | "image/webp";
export type ImageAsset = {
  id: string;
  kind: "image";
  mimeType: ImageMimeType;
  width: number;
  height: number;
  name?: string;
  sizeBytes?: number;
  sha256?: string;
  [key: string]: unknown;
};
export type DocumentAsset = ImageAsset;
export type AssetCollection = DocumentAsset[] | Record<string, DocumentAsset>;

export type DeckThemeColorKey = "accent1" | "accent2" | "accent3" | "accent4" | "accent5" | "accent6" | "text1" | "text2" | "background1" | "background2";
export type DeckTheme = {
  name?: string;
  fontFamily?: string;
  headingFontFamily?: string;
  bodyFontFamily?: string;
  colors?: Partial<Record<DeckThemeColorKey, string>>;
};

export type ImageCrop = { left: number; top: number; right: number; bottom: number };
export type ImageSettings = { fit: "contain" | "cover" | "stretch"; crop?: ImageCrop; opacity?: number };
export type TableCellStyle = { fill?: string; color?: string; fontFamily?: string; fontSize?: number; align?: "left" | "center" | "right" };
export type TableCell = { id: string; content: PMNodeJSON; style?: TableCellStyle };
export type TableRow = { id: string; height?: number; cells: TableCell[] };
export type TableData = {
  rows: TableRow[];
  columnWidths?: number[];
  headerRows?: number;
  borderColor?: string;
  borderWidth?: number;
  cellPadding?: number;
};
export type ChartSeries = { id: string; name: string; values: number[]; color?: string };
export type ChartData = {
  type: "bar" | "line" | "pie";
  title?: string;
  categories: string[];
  series: ChartSeries[];
  legend?: boolean;
  dataLabels?: boolean;
  xAxisTitle?: string;
  yAxisTitle?: string;
};

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
  image?: ImageSettings;
  table?: TableData;
  chart?: ChartData;
  [key: string]: unknown;
};

export type DeckPage = { id: string; name: string; width: number; height: number; children: string[] };
export type DesignConstraints = Record<string, JSONValue | undefined>;

export type DeckDocument = {
  schemaVersion: 1;
  documentId: string;
  kind: "deck";
  revision: number;
  name: string;
  assets?: AssetCollection;
  theme?: DeckTheme;
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
  | { type: "page.property"; pageId: string; path: "name" | "width" | "height"; value: unknown }
  | { type: "asset.exists"; assetId: string; exists?: boolean }
  | { type: "document.property"; path: "name" | "theme"; value: unknown }
  | { type: "text.version"; nodeId: string; value: unknown };

export type PageInsertOperation = { type: "page.insert"; page: DeckPage; index?: number };
export type PageUpdateOperation = { type: "page.update"; pageId: string; page: Partial<Pick<DeckPage, "name" | "width" | "height">> };
export type PageReorderOperation = { type: "page.reorder"; pageId: string; index: number };
export type NodeInsertOperation = { type: "node.insert"; node: DeckNode; index?: number; parentId?: string };
export type NodeRemoveOperation = { type: "node.remove"; nodeId: string };
export type NodeReorderOperation = { type: "node.reorder"; nodeId: string; index: number; parentId?: string };
export type NodeReparentOperation = { type: "node.reparent"; nodeId: string; parentId: string; index?: number };
export type GeometryUpdateOperation = { type: "geometry.update"; nodeId: string; geometry: Partial<Geometry> };
export type StyleUpdateOperation = { type: "style.update"; nodeId: string; style: Style };
export type FlagsUpdateOperation = { type: "node.flags.update"; nodeId: string; flags: Partial<Pick<DeckNode, "locked" | "hidden">> };
export type TextApplyOperation = { type: "text.apply"; nodeId: string; steps: unknown[]; schema?: unknown };
export type ImageUpdateOperation = { type: "image.update"; nodeId: string; image: Partial<ImageSettings> };
export type AssetRegisterOperation = { type: "asset.register"; asset: ImageAsset };
export type AssetReplaceOperation = { type: "asset.replace"; nodeId: string; asset: ImageAsset };
export type TableUpdateOperation = { type: "table.update"; nodeId: string; table: TableData };
export type ChartUpdateOperation = { type: "chart.update"; nodeId: string; chart: ChartData };
export type ThemePatch = {
  name?: string | null;
  fontFamily?: string | null;
  headingFontFamily?: string | null;
  bodyFontFamily?: string | null;
  colors?: Partial<Record<DeckThemeColorKey, string | null>>;
};
export type DocumentThemeOperation = { type: "document.theme"; theme: ThemePatch };
export type DocumentOperation = PageInsertOperation | PageUpdateOperation | PageReorderOperation | NodeInsertOperation | NodeRemoveOperation | NodeReorderOperation | NodeReparentOperation | GeometryUpdateOperation | StyleUpdateOperation | FlagsUpdateOperation | TextApplyOperation | ImageUpdateOperation | AssetRegisterOperation | AssetReplaceOperation | TableUpdateOperation | ChartUpdateOperation | DocumentThemeOperation;

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
