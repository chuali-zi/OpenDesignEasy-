import type { DocDocument, PMNodeJSON } from './model.ts';

/** Logical CSS pixels (96/in); 16px is 12pt. Explicit document styles always win. */
export const DEFAULT_DOC_STYLES: NonNullable<DocDocument['styles']> = {
  Normal: { fontFamily: 'Noto Sans CJK SC', fontSize: 16, color: '#000000', lineHeight: 24, spaceBefore: 0, spaceAfter: 8 },
  ...Object.fromEntries([24, 20, 18, 16, 16, 16].map((size, i) => [`Heading${i + 1}`, {
    fontFamily: 'Noto Sans CJK SC', fontSize: size, color: '#000000', bold: true,
    lineHeight: size + 8, spaceBefore: 16, spaceAfter: 8, keepNext: true,
  }])),
};

export function docBlockStyle(styles: Record<string, Record<string, unknown>> = {}, node: PMNodeJSON, inheritedStyle = 'Normal'): Record<string, unknown> {
  const attrs = node.attrs ?? {};
  const styleId = typeof attrs.styleId === 'string' ? attrs.styleId : node.type === 'heading' ? `Heading${attrs.level ?? 1}` : inheritedStyle;
  return { ...(styles.Normal ?? DEFAULT_DOC_STYLES.Normal), ...(styles[styleId] ?? (styleId.startsWith('Heading') ? DEFAULT_DOC_STYLES[styleId] : {})),
    ...Object.fromEntries(Object.entries(attrs).filter(([, value]) => value != null)) };
}
