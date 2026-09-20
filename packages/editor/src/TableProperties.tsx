import { useEffect, useRef, useState } from 'react';
import type { TableData } from '@oeydesign/document';
import { textFromString, textToString } from '@oeydesign/document';

function newCell(value = '') {
  return { id: `cell-${globalThis.crypto.randomUUID()}`, content: textFromString(value) };
}

export function TableProperties({ table, revision, disabled, onCommit }: {
  table: TableData;
  revision: number;
  disabled: boolean;
  onCommit: (table: TableData, baseRevision: number) => void;
}) {
  const [draft, setDraft] = useState(structuredClone(table));
  const revisionRef = useRef(revision);
  useEffect(() => { setDraft(structuredClone(table)); revisionRef.current = revision; }, [table, revision]);

  function editCell(rowIndex: number, columnIndex: number, value: string) {
    setDraft(current => {
      const next = structuredClone(current);
      const cell = next.rows[rowIndex]?.cells[columnIndex];
      if (cell) cell.content = textFromString(value);
      return next;
    });
  }

  function commit() {
    if (JSON.stringify(draft) !== JSON.stringify(table)) onCommit(draft, revisionRef.current);
  }

  function updateStructure(next: TableData) {
    setDraft(next); onCommit(next, revision);
  }

  function addRow() {
    const columns = draft.rows[0]?.cells.length ?? draft.columnWidths?.length ?? 2;
    updateStructure({ ...structuredClone(draft), rows: [...draft.rows, { id: `row-${globalThis.crypto.randomUUID()}`, cells: Array.from({ length: Math.max(1, columns) }, () => newCell()) }] });
  }

  function addColumn() {
    const next = structuredClone(draft);
    for (const row of next.rows) row.cells.push(newCell());
    if (next.columnWidths) next.columnWidths = [...next.columnWidths, next.columnWidths.at(-1) ?? 150];
    updateStructure(next);
  }

  function removeLastRow() {
    if (draft.rows.length < 2) return;
    const next = structuredClone(draft); next.rows.pop();
    updateStructure(next);
  }

  function removeLastColumn() {
    if ((draft.rows[0]?.cells.length ?? 0) < 2) return;
    const next = structuredClone(draft);
    for (const row of next.rows) row.cells.pop();
    next.columnWidths?.pop();
    updateStructure(next);
  }

  return <section className="editor-data-properties" aria-label="表格数据编辑器">
    <div className="editor-data-title"><strong>表格内容</strong><span>{draft.rows.length} 行 · {draft.rows[0]?.cells.length ?? 0} 列</span></div>
    <div className="editor-table-editor">
      {draft.rows.map((row, rowIndex) => <div key={row.id} className="editor-table-edit-row">
        {row.cells.map((cell, columnIndex) => <input key={cell.id} aria-label={`表格单元格 ${rowIndex + 1},${columnIndex + 1}`}
          value={textToString(cell.content)} disabled={disabled} onFocus={() => { revisionRef.current = revision; }}
          onChange={event => editCell(rowIndex, columnIndex, event.currentTarget.value)} onBlur={commit}
          onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} />)}
      </div>)}
    </div>
    <div className="editor-data-actions">
      <button type="button" disabled={disabled} onClick={addRow}>＋ 行</button>
      <button type="button" disabled={disabled} onClick={addColumn}>＋ 列</button>
      <button type="button" disabled={disabled || draft.rows.length < 2} onClick={removeLastRow}>− 行</button>
      <button type="button" disabled={disabled || (draft.rows[0]?.cells.length ?? 0) < 2} onClick={removeLastColumn}>− 列</button>
    </div>
  </section>;
}
