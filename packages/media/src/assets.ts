import type { DeckDocument, DeckNode, ImageAsset } from "@oeydesign/document";

export type AssetResolver = (assetId: string) => Uint8Array | Promise<Uint8Array>;

export function imageAsset(document: DeckDocument, node: DeckNode): ImageAsset {
  if (node.kind !== "image" || !node.assetId) throw new Error(`Image node ${node.id} has no asset reference.`);
  const assets = document.assets;
  const asset = Array.isArray(assets) ? assets.find((candidate) => candidate.id === node.assetId) : assets?.[node.assetId];
  if (!asset || asset.kind !== "image") throw new Error(`Image node ${node.id} refers to missing image asset ${node.assetId}.`);
  return asset;
}

export async function imageBytes(document: DeckDocument, node: DeckNode, resolveAsset?: AssetResolver): Promise<{ asset: ImageAsset; bytes: Uint8Array }> {
  const asset = imageAsset(document, node);
  if (!resolveAsset) throw new Error(`Cannot render image node ${node.id}: provide an asset resolver for ${asset.id}.`);
  const bytes = await resolveAsset(asset.id);
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) throw new Error(`Asset resolver returned no bytes for image asset ${asset.id}.`);
  return { asset, bytes };
}

export function imageDataUri(asset: ImageAsset, bytes: Uint8Array): string {
  return `data:${asset.mimeType};base64,${Buffer.from(bytes).toString("base64")}`;
}

export function findImageAsset(document: DeckDocument, assetId: string): ImageAsset | undefined {
  const assets = document.assets;
  const asset = Array.isArray(assets) ? assets.find((candidate) => candidate.id === assetId) : assets?.[assetId];
  return asset?.kind === "image" ? asset : undefined;
}
