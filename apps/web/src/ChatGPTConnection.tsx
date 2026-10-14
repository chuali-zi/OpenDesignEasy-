import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatGPTLoginState, ChatGPTModelChoice, PublicChatGPTProfile, PublicAgentConfig } from '@oeydesign/runtime';
import { request } from './api.ts';

type State = { profiles: PublicChatGPTProfile[]; login: ChatGPTLoginState; profileId?: string };
const USAGE_URL = 'https://chatgpt.com/settings/usage';
export function ChatGPTConnection({ onConfigured, disabled }: { onConfigured: (config: PublicAgentConfig) => void; disabled: boolean }) {
  const [state, setState] = useState<State>({ profiles: [], login: { status: 'idle' } });
  const [selected, setSelected] = useState('');
  const [models, setModels] = useState<ChatGPTModelChoice[]>([]);
  const [modelId, setModelId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [welcome, setWelcome] = useState(false);
  const configuredAttempt = useRef('');
  const refresh = useCallback(async () => {
    const value = await request<State>('/api/agent/chatgpt');
    setState(value);
    setSelected(current => current || value.profileId || value.login.profileId || value.profiles[0]?.id || '');
    return value;
  }, []);
  useEffect(() => { void refresh().catch(reason => setError(reason.message)); }, [refresh]);
  useEffect(() => {
    if (state.login.status !== 'pending') return;
    let active = true;
    const timer = setInterval(() => {
      void refresh().then(value => {
        if (!active) return;
        if (value.login.status === 'failed') setError(value.login.error?.message || '登录失败');
      }).catch(reason => { if (active) setError(reason.message); });
    }, 1000);
    return () => { active = false; clearInterval(timer); };
  }, [state.login.status, refresh, onConfigured]);
  useEffect(() => {
    if (state.login.status !== 'completed' || !state.login.profileId || configuredAttempt.current === state.login.attemptId) return;
    configuredAttempt.current = state.login.attemptId || '';
    setSelected(state.login.profileId);
    const profile = state.profiles.find(entry => entry.id === state.login.profileId);
    if (!profile?.planEnabled) return;
    void request<PublicAgentConfig>('/api/agent/chatgpt/select', { profileId: profile.id }).then(config => {
      onConfigured(config); setModelId(config.modelId || '');
      if (!localStorage.getItem('oey-chatgpt-plan-welcome')) setWelcome(true);
    }).catch(reason => setError(reason.message));
  }, [state.login.status, state.login.attemptId, state.login.profileId, state.profiles, onConfigured]);
  useEffect(() => {
    let active = true;
    const profile = state.profiles.find(entry => entry.id === selected);
    if (!profile?.planEnabled) { setModels([]); return; }
    void request<{ models: ChatGPTModelChoice[] }>(`/api/agent/chatgpt/models?profileId=${encodeURIComponent(selected)}`)
      .then(value => { if (active) { setModels(value.models); setModelId(current => value.models.some(model => model.id === current) ? current : value.models.find(model => model.supported)?.id || ''); } })
      .catch(reason => { if (active) setError(reason.message); });
    return () => { active = false; };
  }, [selected, state.profiles.map(profile => `${profile.id}:${profile.planEnabled}`).join(',')]);
  const action = async (run: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await run(); await refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };
  const signIn = (profileId?: string, enablePlan = false) => {
    const popup = window.open('about:blank', '_blank');
    if (popup) popup.opener = null;
    void action(async () => {
      try {
        const login = await request<{ authorizationUrl: string }>('/api/agent/chatgpt/login', { profileId, enablePlan });
        if (popup) popup.location.href = login.authorizationUrl;
        else window.location.assign(login.authorizationUrl);
      } catch (reason) { popup?.close(); throw reason; }
    });
  };
  const profile = state.profiles.find(entry => entry.id === selected);
  return <div className="chatgpt-connection" aria-label="ChatGPT 账号连接">
    <p>连接你的 ChatGPT 账号，授权后使用套餐完成设计。</p>
    {state.profiles.length > 0 && <label>ChatGPT 连接<select aria-label="ChatGPT 连接" value={selected} disabled={busy || disabled} onChange={event => { setSelected(event.target.value); setError(''); }}>
      {state.profiles.map(entry => <option value={entry.id} key={entry.id}>{entry.label}{entry.connected ? '' : ' · 未连接'}</option>)}
    </select></label>}
    {profile && <p className="chatgpt-account-status">{profile.planEnabled ? '已连接 · 可以使用 ChatGPT 套餐' : profile.connected ? '已登录 · 尚未允许使用套餐' : '请重新登录此连接'}</p>}
    {state.login.status === 'pending' ? <div><span role="status">正在等待浏览器授权…</span><button type="button" onClick={() => { void action(async () => { await request('/api/agent/chatgpt/login/cancel', {}); }); }}>取消登录</button></div>
      : <div className="chatgpt-actions">
        <button type="button" disabled={busy || disabled} onClick={() => signIn()}>Continue with ChatGPT</button>
        {profile && <button type="button" disabled={busy || disabled} onClick={() => signIn(profile.id, profile.connected && !profile.planEnabled)}>{profile.connected && !profile.planEnabled ? '启用套餐调用' : '重新连接'}</button>}
      </div>}
    {profile?.planEnabled && <>
      <label>可用模型<select aria-label="ChatGPT 模型" value={modelId} onChange={event => setModelId(event.target.value)} disabled={busy || disabled}>
        {models.map(model => <option key={model.id} value={model.id} disabled={!model.supported}>{model.name}{model.supported ? '' : ' · 当前 SDK 未支持'}</option>)}
      </select></label>
      <button type="button" disabled={busy || disabled || !modelId} onClick={() => { void action(async () => { onConfigured(await request('/api/agent/chatgpt/select', { profileId: selected, modelId })); }); }}>使用此账号和模型</button>
    </>}
    {profile?.connected && <button type="button" disabled={busy} onClick={() => { void action(async () => {
      const result = await request<{ remoteRevoked: boolean }>('/api/agent/chatgpt/logout', { profileId: profile.id });
      onConfigured(await request<PublicAgentConfig>('/api/agent/config'));
      if (!result.remoteRevoked) setError('已在本机退出；未能确认远端撤销，可在 ChatGPT 设置中断开连接。');
    }); }}>退出此连接</button>}
    <a href={USAGE_URL} target="_blank" rel="noreferrer">管理 ChatGPT 用量</a>
    {error && <p role="alert">{error}</p>}
    {welcome && <div role="dialog" aria-label="已启用 ChatGPT 套餐"><p>OEYdesign 正在使用你的 ChatGPT 套餐。你可以在 ChatGPT 设置中管理用量和应用权限。</p><button type="button" onClick={() => { localStorage.setItem('oey-chatgpt-plan-welcome', '1'); setWelcome(false); }}>知道了</button></div>}
  </div>;
}
