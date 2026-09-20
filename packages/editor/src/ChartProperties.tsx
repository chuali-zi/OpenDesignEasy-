import { useEffect, useRef, useState } from 'react';
import type { ChartData } from '@oeydesign/document';

export function ChartProperties({ chart, revision, disabled, onCommit }: {
  chart: ChartData;
  revision: number;
  disabled: boolean;
  onCommit: (chart: ChartData, baseRevision: number) => void;
}) {
  const [draft, setDraft] = useState(structuredClone(chart));
  const [categoriesInput, setCategoriesInput] = useState(chart.categories.join(', '));
  const [valueInputs, setValueInputs] = useState<Record<string, string>>(() => Object.fromEntries(chart.series.map(series => [series.id, series.values.join(', ')])));
  const revisionRef = useRef(revision);
  const signature = JSON.stringify(chart);
  useEffect(() => {
    setDraft(structuredClone(chart));
    setCategoriesInput(chart.categories.join(', '));
    setValueInputs(Object.fromEntries(chart.series.map(series => [series.id, series.values.join(', ')])));
    revisionRef.current = revision;
  }, [signature, revision]);

  function patch(value: Partial<ChartData>) { setDraft(current => ({ ...current, ...value })); }
  function commit() { if (JSON.stringify(draft) !== signature) onCommit(draft, revisionRef.current); }
  function categoriesChanged(value: string) {
    setCategoriesInput(value);
    const categories = value.split(',').map(item => item.trim()).filter(Boolean);
    setDraft(current => ({ ...current, categories, series: current.series.map(series => ({ ...series, values: categories.map((_, index) => series.values[index] ?? 0) })) }));
  }
  function updateSeries(seriesId: string, changes: { name?: string; values?: number[]; color?: string }) {
    setDraft(current => ({ ...current, series: current.series.map(series => series.id === seriesId ? { ...series, ...changes } : series) }));
  }
  function addSeries() {
    const next = structuredClone(draft);
    next.series.push({ id: `series-${globalThis.crypto.randomUUID()}`, name: `系列 ${next.series.length + 1}`, values: next.categories.map(() => 0), color: ['#315d4b', '#c07e4d', '#6e87a1', '#a5ad68'][next.series.length % 4] });
    setDraft(next); onCommit(next, revision);
  }

  return <section className="editor-data-properties" aria-label="图表数据编辑器">
    <div className="editor-data-title"><strong>图表数据</strong><span>{draft.categories.length} 类目 · {draft.series.length} 个系列</span></div>
    <label className="editor-data-field">图表类型<select aria-label="图表类型" value={draft.type} disabled={disabled}
      onChange={event => { const next = { ...draft, type: event.currentTarget.value as ChartData['type'] }; setDraft(next); onCommit(next, revision); }}>
      <option value="bar">柱状图</option><option value="line">折线图</option><option value="pie">饼图</option>
    </select></label>
    <label className="editor-data-field">标题<input aria-label="图表标题" value={draft.title ?? ''} disabled={disabled} onFocus={() => { revisionRef.current = revision; }}
      onChange={event => patch({ title: event.currentTarget.value })} onBlur={commit} /></label>
    <label className="editor-data-field">类目（逗号分隔）<input aria-label="图表类目" value={categoriesInput} disabled={disabled} onFocus={() => { revisionRef.current = revision; }}
      onChange={event => categoriesChanged(event.currentTarget.value)} onBlur={commit} /></label>
    <div className="editor-chart-series">
      {draft.series.map(series => <div key={series.id} className="editor-chart-series-row">
        <input aria-label={`${series.name} 系列名称`} value={series.name} disabled={disabled} onFocus={() => { revisionRef.current = revision; }}
          onChange={event => updateSeries(series.id, { name: event.currentTarget.value })} onBlur={commit} />
        <input aria-label={`${series.name} 系列颜色`} type="color" value={series.color ?? '#315d4b'} disabled={disabled} onFocus={() => { revisionRef.current = revision; }}
          onChange={event => { updateSeries(series.id, { color: event.currentTarget.value }); }} onBlur={commit} />
        <input aria-label={`${series.name} 系列数据`} placeholder="10, 20, 30" value={valueInputs[series.id] ?? ''} disabled={disabled} onFocus={() => { revisionRef.current = revision; }}
          onChange={event => {
            const value = event.currentTarget.value;
            setValueInputs(current => ({ ...current, [series.id]: value }));
            const values = value.split(',').map(item => item.trim() === '' ? 0 : Number(item.trim()));
            updateSeries(series.id, { values: Array.from({ length: draft.categories.length }, (_, index) => Number.isFinite(values[index]) ? values[index]! : 0) });
          }} onBlur={commit} />
      </div>)}
    </div>
    <div className="editor-data-actions">
      <button type="button" disabled={disabled} onClick={addSeries}>＋ 数据系列</button>
      <label><input aria-label="显示图例" type="checkbox" checked={draft.legend ?? true} disabled={disabled} onChange={event => { const next = { ...draft, legend: event.currentTarget.checked }; setDraft(next); onCommit(next, revision); }} /> 图例</label>
      <label><input aria-label="显示数据标签" type="checkbox" checked={draft.dataLabels ?? false} disabled={disabled} onChange={event => { const next = { ...draft, dataLabels: event.currentTarget.checked }; setDraft(next); onCommit(next, revision); }} /> 数值</label>
    </div>
  </section>;
}
