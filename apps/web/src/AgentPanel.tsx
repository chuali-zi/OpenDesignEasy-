import { useCallback, useEffect, useRef, useState } from 'react';
import * as api from './api.ts';

type Session = { sessionId: string; title?: string; status: string; lastRunId?: string };
type Question = { questionId: string; status: string; prompt: string; options: string[]; allowFreeText: boolean };
type Snapshot = { session: Session; inputs: Array<{ inputId: string; text: string; status: string }>;
  runs: Array<{ runId: string; status: string; error?: string }>; questions: Question[]; messages: Array<{ role?: string; content?: unknown; text?: string; toolName?: string; customType?: string; details?: { inputId?: string } }> };
type Config = { providerId?: string; modelId?: string; baseUrl?: string; apiKeyEnv?: string; configured?: boolean };
type ExportedArtifact = { id: string; documentId: string; revision: number; format: string; createdAt: string };
const statusText: Record<string, string> = { idle: '可以继续', running: '正在创作', waiting_input: '等待你的回答', interrupted: '上次任务已中断', completed: '已完成', cancelled: '已停止', failed: '执行失败', accepted: '已接收', delivered: '处理中', resolved: '已处理' };

function contentText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(contentText).filter(Boolean).join('\n');
  if (value && typeof value === 'object' && 'text' in value && typeof value.text === 'string') return value.text;
  return '';
}

export function AgentPanel({ documentId, selectedIds }: { documentId?: string; selectedIds: string[] }) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selected, setSelected] = useState('');
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [config, setConfig] = useState<Config>({});
  const [settings, setSettings] = useState(false);
  const [text, setText] = useState('');
  const [mode, setMode] = useState('steer');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [activity, setActivity] = useState('');
  const [attachments, setAttachments] = useState<Array<{ id: string; name: string }>>([]);
  const [exports, setExports] = useState<ExportedArtifact[]>([]);
  const current = useRef(selected);
  const refreshId = useRef(0);
  const input = useRef<HTMLInputElement>(null);
  const transcript = useRef<HTMLDivElement>(null);
  current.current = selected;

  const refresh = useCallback(async () => {
    const serial = ++refreshId.current;
    const [list, artifacts] = await Promise.all([
      api.request<{ sessions: Session[] }>('/api/agent/sessions'),
      api.request<{ exports: ExportedArtifact[] }>('/api/exports'),
    ]);
    if (serial !== refreshId.current) return;
    setSessions(list.sessions);
    setExports(artifacts.exports);
    const id = current.current || list.sessions.at(-1)?.sessionId;
    if (!id) return;
    if (!current.current) { current.current = id; setSelected(id); }
    const state = await api.request<Snapshot>(`/api/agent/sessions/${id}`);
    if (current.current === id && serial === refreshId.current) setSnapshot(state);
  }, []);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    void api.request<Config>('/api/agent/config').then(value => { if (active) setConfig(value); }).catch(reason => setError(reason.message));
    void refresh().catch(reason => setError(reason.message));
    const stream = new EventSource('/api/agent/events');
    stream.onopen = () => { void refresh().catch(reason => setError(reason.message)); };
    stream.onmessage = event => {
      const update = JSON.parse(event.data) as { sessionId?: string; type?: string; event?: { type?: string; toolName?: string } };
      if (update.sessionId && current.current && update.sessionId !== current.current) return;
      if (update.event?.toolName) setActivity(update.event.toolName);
      if (update.type?.startsWith('run.') && update.type !== 'run.started') setActivity('');
      if (!timer) timer = setTimeout(() => { timer = undefined; if (active) void refresh().catch(reason => setError(reason.message)); }, 160);
    };
    return () => { active = false; stream.close(); if (timer) clearTimeout(timer); };
  }, [refresh]);

  useEffect(() => { if (selected) void refresh().catch(reason => setError(reason.message)); }, [selected, refresh]);
  useEffect(() => {
    if (selected && documentId) void api.request(`/api/agent/sessions/${selected}/selection`, { documentId, nodeIds: selectedIds }).catch(reason => setError(reason.message));
  }, [selected, documentId, selectedIds]);
  useEffect(() => { transcript.current?.scrollTo({ top: transcript.current.scrollHeight, behavior: 'smooth' }); }, [snapshot?.messages.length, snapshot?.inputs.length]);

  const runAction = async (action: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try { await action(); await refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };
  const ensureSession = async () => {
    if (current.current) return current.current;
    const result = await api.request<{ session: Session }>('/api/agent/sessions', { title: '设计对话' });
    current.current = result.session.sessionId; setSelected(current.current);
    return current.current;
  };
  const running = snapshot?.session.status === 'running';
  const pendingQuestion = snapshot?.questions.find(question => question.status === 'pending');
  const send = (answer?: string) => runAction(async () => {
    const id = await ensureSession();
    const message = answer ?? text;
    if (!message.trim()) return;
    const withReferences = message + (attachments.length ? `\n\n项目参考资料：${attachments.map(item => `${item.name} (assetId: ${item.id})`).join('；')}` : '');
    await api.request(`/api/agent/sessions/${id}/inputs`, { text: withReferences, mode: pendingQuestion ? 'answer' : running ? mode : 'message', questionId: pendingQuestion?.questionId, inputId: crypto.randomUUID(), documentId, assetIds: attachments.map(item => item.id) });
    setText(''); setAttachments([]);
  });

  return <aside className="agent-panel" aria-label="设计对话">
    <div className="agent-heading"><div><span className="agent-eyebrow">DESIGN PARTNER</span><h2>一起把想法做出来</h2></div><button aria-label="模型设置" title="模型设置" onClick={() => setSettings(!settings)}>⚙</button></div>
    <div className="agent-session-line"><select aria-label="选择对话" value={selected} onChange={event => { current.current = event.target.value; setSelected(event.target.value); setSnapshot(null); }}><option value="">新对话</option>{sessions.map(session => <option key={session.sessionId} value={session.sessionId}>{session.title || '设计对话'}</option>)}</select><button aria-label="新建对话" onClick={() => { void runAction(async () => { const result = await api.request<{ session: Session }>('/api/agent/sessions', { title: `设计对话 ${sessions.length + 1}` }); current.current = result.session.sessionId; setSelected(current.current); setSnapshot(null); }); }}>＋</button></div>
    {settings && <form className="agent-settings" onSubmit={event => { event.preventDefault(); void runAction(async () => { setConfig(await api.request<Config>('/api/agent/config', config)); setSettings(false); }); }}>
      <label>Provider<input aria-label="模型 Provider" value={config.providerId ?? ''} onChange={event => setConfig({ ...config, providerId: event.target.value })} placeholder="kimi-coding" /></label>
      <label>模型<input aria-label="模型名称" value={config.modelId ?? ''} onChange={event => setConfig({ ...config, modelId: event.target.value })} /></label>
      <label>服务地址<input aria-label="模型服务地址" value={config.baseUrl ?? ''} onChange={event => setConfig({ ...config, baseUrl: event.target.value })} placeholder="原生 provider 可留空" /></label>
      <label>密钥环境变量名<input aria-label="密钥环境变量名" value={config.apiKeyEnv ?? 'API_KEY'} onChange={event => setConfig({ ...config, apiKeyEnv: event.target.value })} /></label>
      <small>服务端读取环境变量中的密钥。</small><button type="submit" disabled={busy || running}>保存模型设置</button>
    </form>}
    <div className="agent-transcript" ref={transcript} aria-live="polite">
      {!snapshot?.inputs.length && <div className="agent-welcome"><span>↗</span><h3>先说说，<br/>你想表达什么？</h3><p>给我主题、受众或参考资料。你也可以直接调整画布，再让我沿用你的布局继续。</p><button onClick={() => setText('先和我讨论这份演示的受众、核心信息与视觉方向，暂时不要修改作品。')}>讨论一个方向</button><button onClick={() => setText('读取我当前选中的对象与最新布局，告诉我可以怎样改进。')}>看看当前设计</button></div>}
      {snapshot?.messages.filter(message => message.role !== 'toolResult').map((message, index) => {
        const submitted = message.customType === 'oey_input' ? snapshot.inputs.find(item => item.inputId === message.details?.inputId) : undefined;
        if (message.role === 'custom' && !submitted) return null;
        const body = submitted?.text ?? (contentText(message.content) || message.text || '');
        if (!body) return null;
        const user = message.role === 'user' || Boolean(submitted);
        return <article key={index} className={`agent-message ${user ? 'from-user' : ''}`}><span>{user ? '你' : 'OEY'}</span><p>{body}</p></article>;
      })}
      {snapshot?.inputs.filter(item => ['accepted', 'interrupted'].includes(item.status)).map(item => <div className="agent-input-state" key={item.inputId}><strong>{statusText[item.status]}</strong><p>{item.text}</p></div>)}
      {snapshot?.runs.at(-1)?.error && <p className="agent-error">{snapshot.runs.at(-1)?.error}</p>}
      {pendingQuestion && <section className="agent-question"><strong>{pendingQuestion.prompt}</strong>{pendingQuestion.options.map(option => <button key={option} disabled={busy} onClick={() => { void send(option); }}>{option}</button>)}</section>}
      {exports.filter(item => item.documentId === documentId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 3).map(item => <div className="agent-context" key={item.id}><a href={`/api/exports/${encodeURIComponent(item.id)}`} download>下载 {item.format.toUpperCase()} · 修订 {item.revision}</a></div>)}
    </div>
    {error && <div role="alert" className="agent-error">{error}</div>}
    <div className="agent-composer"><div className="agent-state"><i className={running ? 'active' : ''}/>{statusText[snapshot?.session.status ?? 'idle'] ?? snapshot?.session.status}{running && activity && <span title={activity}>{activity}</span>}</div>
      {selectedIds.length > 0 && <div className="agent-context">已选中 {selectedIds.length} 个对象 · 随最新设计同步</div>}
      {attachments.map(item => <div className="agent-context" key={item.id}>{item.name}<button aria-label={`移除参考 ${item.name}`} onClick={() => setAttachments(attachments.filter(asset => asset.id !== item.id))}>×</button></div>)}
      <textarea aria-label="给设计 Agent 的消息" placeholder={pendingQuestion ? '回答这个问题…' : '描述你的想法，或要求局部调整…'} value={text} onChange={event => setText(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} />
      <div className="agent-compose-actions"><input ref={input} type="file" hidden accept=".txt,.md,.csv,.json,.png,.jpg,.jpeg,.webp" onChange={event => { const file = event.target.files?.[0]; if (file) void runAction(async () => { const asset = await api.importAsset(file, file.type.startsWith('image/') ? 'image' : 'reference'); setAttachments(items => [...items, { id: asset.id, name: file.name }]); }); event.target.value = ''; }} /><button aria-label="添加参考资料" title="添加参考资料" disabled={busy} onClick={() => input.current?.click()}>＋ 参考</button>
        {running && <select aria-label="执行中消息方式" value={mode} onChange={event => setMode(event.target.value)}><option value="steer">纠偏</option><option value="follow_up">随后处理</option></select>}
        {running && <button disabled={busy} onClick={() => { void runAction(() => api.request(`/api/agent/sessions/${selected}/cancel`, {})); }}>停止</button>}
        <button className="agent-send" disabled={busy || !text.trim()} onClick={() => { void send(); }}>{pendingQuestion ? '回答' : running ? '补充' : '发送'} ↑</button>
      </div>
    </div>
  </aside>;
}
