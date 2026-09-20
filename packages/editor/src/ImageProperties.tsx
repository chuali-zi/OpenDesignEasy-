import { useEffect, useRef, useState } from 'react';
import type { ImageSettings } from '@oeydesign/document';

export function ImageProperties({
  settings, revision, disabled, onCommit,
}: {
  settings: ImageSettings | undefined;
  revision: number;
  disabled: boolean;
  onCommit: (image: Partial<ImageSettings>, baseRevision: number) => void;
}) {
  const fit = settings?.fit ?? 'contain';
  const opacity = settings?.opacity ?? 1;
  const crop = settings?.crop ?? { left: 0, top: 0, right: 0, bottom: 0 };
  const signature = JSON.stringify({ fit, opacity, crop });
  const [draftOpacity, setDraftOpacity] = useState(String(opacity));
  const [draftCrop, setDraftCrop] = useState(crop);
  const [baseRevision, setBaseRevision] = useState(revision);
  const lastOpacityCommit = useRef<number | null>(null);
  useEffect(() => { setDraftOpacity(String(opacity)); setDraftCrop(crop); setBaseRevision(revision); lastOpacityCommit.current = null; }, [signature, revision]);
  const commitCrop = () => { if (JSON.stringify(draftCrop) !== JSON.stringify(crop)) onCommit({ crop: draftCrop }, baseRevision); };
  const commitOpacity = () => {
    const value = Number(draftOpacity);
    if (value !== opacity && lastOpacityCommit.current !== value) { lastOpacityCommit.current = value; onCommit({ opacity: value }, baseRevision); }
  };
  const changeCrop = (key: keyof typeof crop, value: string) => setDraftCrop(current => ({ ...current, [key]: Math.min(0.45, Math.max(0, Number(value) || 0)) }));

  return <div className="editor-image-properties">
    <label>适配方式<select aria-label="图片适配方式" value={fit} disabled={disabled} onChange={event => onCommit({ fit: event.currentTarget.value as ImageSettings['fit'] }, revision)}>
      <option value="contain">完整显示</option><option value="cover">填满裁切</option><option value="stretch">拉伸填满</option>
    </select></label>
    <div className="editor-image-crop">
      <span>裁切边缘</span>
      {(['left', 'top', 'right', 'bottom'] as const).map(key => <label key={key}>{key === 'left' ? '左' : key === 'top' ? '上' : key === 'right' ? '右' : '下'}
        <input aria-label={`图片裁切${key === 'left' ? '左' : key === 'top' ? '上' : key === 'right' ? '右' : '下'}`} type="number" min="0" max="0.45" step="0.01" value={draftCrop[key]} disabled={disabled}
          onFocus={() => setBaseRevision(revision)} onChange={event => changeCrop(key, event.currentTarget.value)} onBlur={commitCrop}
          onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} />
      </label>)}
    </div>
    <label className="editor-image-opacity">透明度 <span>{Math.round(Number(draftOpacity) * 100)}%</span>
      <input aria-label="图片透明度" type="range" min="0" max="1" step="0.01" value={draftOpacity} disabled={disabled}
        onFocus={() => setBaseRevision(revision)} onChange={event => setDraftOpacity(event.currentTarget.value)}
        onPointerUp={commitOpacity} onBlur={commitOpacity} />
    </label>
  </div>;
}
