import { useEffect, useRef, useState } from 'react';

/** A field owns its draft and base revision, including across remote updates. */
export function WebDraftField({ label, value, revision, onCommit, multiline = false, disabled = false, placeholder, type = 'text' }: {
  label: string;
  value: string;
  revision: number;
  onCommit: (value: string, baseRevision: number) => Promise<boolean>;
  multiline?: boolean;
  disabled?: boolean;
  placeholder?: string;
  type?: 'text' | 'color';
}) {
  const [draft, setDraft] = useState(value);
  const [failed, setFailed] = useState(false);
  const dirty = useRef(false);
  const base = useRef(revision);
  useEffect(() => { if (!dirty.current) setDraft(value); }, [value]);
  const save = async (retry = false) => {
    if (!dirty.current || disabled) return;
    if (draft === value) { dirty.current = false; setFailed(false); return; }
    if (retry) base.current = revision;
    const ok = await onCommit(draft, base.current);
    if (ok) { dirty.current = false; setFailed(false); }
    else setFailed(true);
  };
  const common = {
    'aria-label': label, value: draft, disabled, placeholder,
    onFocus: () => { if (!dirty.current) base.current = revision; },
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      dirty.current = true; setDraft(event.currentTarget.value);
    },
    onBlur: () => { void save(); },
  };
  return <div className="web-editor-draft">
    <label>{label}{multiline ? <textarea {...common} /> : <input {...common} type={type} />}</label>
    {failed && <div className="web-editor-draft-conflict"><small>未保存的输入已保留</small>
      <button disabled={disabled} onClick={() => void save(true)}>重新应用</button>
      <button disabled={disabled} onClick={() => { dirty.current = false; setDraft(value); setFailed(false); }}>恢复已保存值</button>
    </div>}
  </div>;
}
