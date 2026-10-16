import { useEffect, useMemo, useRef, useState } from 'react';
import type { EditableDocument } from '@oeydesign/document';
import type { ArtifactFormat, DeliveryFinding, DeliveryReport } from '@oeydesign/media';
import { resolveDeliveryLocation } from './delivery-location.ts';

const formats: Record<EditableDocument['kind'], Array<[ArtifactFormat, string]>> = {
  doc: [['docx', 'Word 文档'], ['pdf', 'PDF'], ['html', 'HTML'], ['png', '首页 PNG']],
  deck: [['pptx', 'PowerPoint'], ['pdf', 'PDF'], ['png', '首页 PNG']],
  web: [['zip', '静态站点 ZIP'], ['html', '首页 HTML'], ['source.zip', '可编辑源码 ZIP'], ['build.zip', '构建应用 ZIP'], ['pdf', 'PDF'], ['png', '首页 PNG']],
};
function locationName(document: EditableDocument, finding: DeliveryFinding) {
  const { pageId, sectionId, part } = finding.location;
  if (document.kind === 'doc') return `${document.sections.find(section => section.id === sectionId)?.name ?? '文档'}${part === 'header' ? ' · 页眉' : part === 'footer' ? ' · 页脚' : ''}`;
  return document.pages.find(page => page.id === pageId)?.name ?? '文档素材';
}

export function DeliveryPanel({ document, onClose, onLocate, initialFormat }: { document: EditableDocument; initialFormat?:ArtifactFormat; onClose(): void; onLocate(report: DeliveryReport, finding: DeliveryFinding): boolean }) {
  const [format, setFormat] = useState<ArtifactFormat>(formats[document.kind].some(([value])=>value===initialFormat)?initialFormat!:formats[document.kind][0]![0]);
  const [report, setReport] = useState<DeliveryReport | null>(null);
  const [busy, setBusy] = useState<'check' | 'export' | null>(null);
  const [error, setError] = useState('');
  const [downloaded, setDownloaded] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const current = useRef(document); current.current = document;
  const dialog = useRef<HTMLDialogElement>(null);
  const stale = !!report && (report.documentId !== document.documentId || report.kind !== document.kind || report.revision !== document.revision || report.format !== format);
  const findingTargets=useMemo(()=>report?.findings.map(finding=>resolveDeliveryLocation(document,finding.location))??[],[document,report]);
  const fontRows = useMemo(() => [...new Map((report?.fonts?.runs ?? []).map(run => [JSON.stringify([run.declared,run.weight,run.style,run.actual,run.availability]),run])).values()], [report]);

  async function check() {
    controller.current?.abort();
    const request = new AbortController(); controller.current = request;
    setBusy('check'); setError(''); setDownloaded(false);
    const target = current.current;
    try {
      const response = await fetch(`/api/documents/${encodeURIComponent(target.documentId)}/delivery-check?revision=${target.revision}&format=${format}`, { signal: AbortSignal.any([request.signal, AbortSignal.timeout(30_000)]) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message ?? '检查失败');
      if (!request.signal.aborted) setReport(result.report);
    } catch (failure) { if (!request.signal.aborted) setError(failure instanceof Error ? failure.message : '检查失败'); }
    finally { if (controller.current === request) { controller.current = null; setBusy(null); } }
  }
  useEffect(() => { dialog.current?.showModal(); return () => controller.current?.abort(); }, []);
  useEffect(() => { setReport(null); void check(); }, [format]);

  async function deliver() {
    if (!report || stale || busy || controller.current || report.summary.errors) return;
    const request = new AbortController(); controller.current = request;
    setBusy('export'); setError(''); setDownloaded(false);
    try {
      const response = await fetch(`/api/documents/${encodeURIComponent(report.documentId)}/delivery.zip`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ format, expectedRevision: report.revision }),
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(125_000)]),
      });
      if (!response.ok) throw new Error((await response.json()).error?.message ?? '交付失败');
      const blob = await response.blob();
      if (request.signal.aborted) return;
      if (current.current.revision !== report.revision) throw new Error('文档已更新，请重新检查当前版本后交付。');
      const url = URL.createObjectURL(blob);
      const link = window.document.createElement('a'); link.href = url; link.download = `${document.kind}-r${report.revision}.delivery.zip`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000); setDownloaded(true);
      const engine = response.headers.get('X-Delivery-Renderer');
      if (engine) setReport(value => value?.renderer ? { ...value, renderer: { ...value.renderer, engine, phase: 'generated' } } : value);
    } catch (failure) { if (!request.signal.aborted) setError(failure instanceof Error ? failure.message : '交付失败'); }
    finally { if (controller.current === request) { controller.current = null; setBusy(null); } }
  }
  const cancel = () => { controller.current?.abort(); controller.current = null; setBusy(null); setError('操作已取消，可重新检查或交付。'); };

  return <dialog ref={dialog} className="delivery-panel" aria-label="交付检查" onCancel={onClose}>
    <header><div><strong>交付检查</strong><p>{document.name} · 当前修订 {document.revision}</p></div><button onClick={onClose} aria-label="关闭交付检查">关闭</button></header>
    <div className="delivery-controls"><label>交付格式 <select aria-label="交付格式" value={format} disabled={!!busy} onChange={event => setFormat(event.target.value as ArtifactFormat)}>{formats[document.kind].map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></label>
      <button disabled={!!busy} onClick={() => void check()}>重新检查</button>{busy && <button onClick={cancel}>取消操作</button>}</div>
    {busy && <p role="status">{busy === 'check' ? '正在检查已保存的文档与素材…' : '正在生成同一版本的产物与检查报告…'}</p>}
    {error && <p className="delivery-error" role="alert">{error}</p>}
    {stale && <p className="delivery-error" role="alert">检查已过期：报告为修订 {report!.revision}，作品已更新。请重新检查。</p>}
    {report && <>
      <section className="delivery-summary"><strong>修订 {report.revision} · {report.summary.errors ? `${report.summary.errors} 项错误` : report.summary.warnings ? `${report.summary.warnings} 项提醒` : '未发现已知结构问题'}</strong><p>此检查帮助发现交付遗漏，视觉、事实和目标软件仍需审阅。</p></section>
      {report.renderer && <section className="delivery-renderer" aria-label="交付渲染器"><strong>{report.renderer.phase === 'generated' ? '本次已生成' : '本次导出将使用'}：{report.renderer.engine}</strong><p>运行环境：{report.renderer.platform}。{report.renderer.detail}</p></section>}
      {report.fonts && <section className="delivery-fonts" aria-label="字体检查"><strong>字体可用性与字形实测</strong><p>检查宿主：{report.fonts.platform} · {report.fonts.inventory === 'fontconfig' ? '本机字体目录已查询' : '字体目录未查询'} · {report.fonts.probe === 'measured' ? `Chromium ${report.fonts.browserVersion ?? ''} 实测` : '字形未实测'}{!report.fonts.complete && ' · 覆盖不完整'}</p><p>声明字体不等于实际使用字体。云端字体情况不代表用户 Windows 的字体情况。</p>
        {!!fontRows.length && <table><thead><tr><th>声明 / 字重</th><th>当前宿主</th><th>Chromium 实际字形</th></tr></thead><tbody>{fontRows.map((run,index) => <tr key={index}><td>{run.declared}<small>{run.weight} · {run.style}</small></td><td>{{ available:'首选字体已发现', missing:'首选字体未发现', generic:'通用字体，随设备解析', unknown:'可用性未知' }[run.availability]}{run.fallback && <small>已观察到字形回退</small>}</td><td>{run.actual.map(font => `${font.family}（${font.glyphs} 字形）`).join('、') || '未测得'}<small>文字片段：{run.sample}</small></td></tr>)}</tbody></table>}
        <p>已发现仅指字体家族，字重可能由渲染器合成。实测仅覆盖离线浏览器预览；Office、LibreOffice、其他设备及网页断点仍需复核。外部字体与脚本未加载。</p></section>}
      {!!report.findings.length && <ul className="delivery-findings">{report.findings.map((finding, index) => <li key={index}><span className={finding.severity === 'error' ? 'delivery-error' : ''}>{finding.severity === 'error' ? '需修复' : '请确认'}</span><div>{finding.message}<small>{locationName(document, finding)}</small></div>{(finding.location.pageId || finding.location.sectionId || finding.location.nodeId) && <button title={stale?'报告已过期，请重新检查。':findingTargets[index]?'打开对应章节或对象':'未找到唯一的编辑位置，请手动检查。'} disabled={!!busy || stale || !findingTargets[index]} onClick={() => { if (!onLocate(report, finding)) setError('当前版本中无法定位此问题，请重新检查。'); }}>定位问题</button>}</li>)}</ul>}
      <dl className="delivery-checks">{report.checks.map(item => <div key={item.id}><dt>{item.status === 'checked' ? '已检查' : '待审阅'}</dt><dd>{item.detail}</dd></div>)}</dl>
      <footer><p>交付包包含所选产物、检查报告与文件摘要，不额外归档项目目录、独立资料库或聊天。{format === 'source.zip' && ' 源码格式包含网页源码。'}产物内容未脱敏。{report.summary.warnings > 0 && ' 提醒会随包保留，请确认后交付。'}</p><button className="export-button" disabled={!!busy || stale || report.summary.errors > 0} onClick={() => void deliver()}>下载交付包</button></footer>
      {downloaded && <p role="status">交付包已下载，版本与报告一同保留。</p>}
    </>}
  </dialog>;
}
