import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import type { Api, ApiStreamOptions, Model, SimpleStreamOptions, TranscriptContext } from '@earendil-works/pi-ai';
import { ChatGPTAuth, ChatGPTError, CHATGPT_USAGE_URL } from './chatgpt-auth.ts';

const BASE_URL = 'https://api.openai.com/v1';
const UNSUPPORTED = ['background', 'conversation', 'previous_response_id', 'max_output_tokens', 'max_tool_calls', 'metadata', 'moderation', 'multi_agent', 'prompt', 'prompt_cache_retention', 'safety_identifier', 'temperature', 'top_logprobs', 'top_p', 'truncation', 'user'];
export interface ChatGPTModelChoice { id: string; name: string; supported: boolean; images: boolean }

/** Applies only to ChatGPT plan requests. Ordinary API-key/provider calls are unchanged. */
export function chatGPTPayload(value: unknown): Record<string, unknown> {
  const payload = { ...(value as Record<string, unknown>), store: false, stream: true } as Record<string, unknown>;
  for (const key of UNSUPPORTED) delete payload[key];
  const input = Array.isArray(payload.input) ? payload.input.map(item => {
    if (item && typeof item === 'object' && item.role === 'system') return { ...item, role: 'developer' };
    return item;
  }) : [];
  if (Array.isArray(payload.tools) && payload.tools.length) {
    if (payload.tools.some(tool => !['function', 'custom'].includes(tool.type))) throw new ChatGPTError('unsupported_tool', 'This ChatGPT connection supports local design function tools only.');
    input.unshift({ type: 'additional_tools', role: 'developer', tools: payload.tools });
  }
  delete payload.tools;
  payload.input = input;
  return payload;
}

export async function createChatGPTModelRuntime(auth: ChatGPTAuth, profileId: string) {
  const runtime = await ModelRuntime.create({ credentials: auth.store.credentials(profileId), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
  const builtin = runtime.getProvider('openai');
  if (!builtin) throw new ChatGPTError('provider_missing', 'Pi does not provide the OpenAI Responses provider.');
  const restrictions = (options?: { onPayload?: SimpleStreamOptions['onPayload'] }) => ({
    maxRetries: 0,
    onPayload: async (payload: unknown, model: Model<Api>) => chatGPTPayload(await options?.onPayload?.(payload, model) ?? payload),
    onProviderStreamEvent: async (value: unknown) => {
      const event = value as { type?: string };
      if (event.type === 'response.incomplete') throw new ChatGPTError('incomplete', 'ChatGPT response was incomplete. The design task has not completed.');
    },
  });
  runtime.registerNativeProvider({
    ...builtin, auth: { oauth: auth.oauth(profileId) },
    stream<T extends Api>(model: Model<T>, context: TranscriptContext, options?: ApiStreamOptions<T>) {
      return builtin.stream(model, context, Object.assign({}, options, restrictions(options)));
    },
    streamSimple: (model, context, options) => builtin.streamSimple(model, context, { ...options, ...restrictions(options) }),
  });
  return runtime;
}

export async function listChatGPTModels(auth: ChatGPTAuth, profileId: string, request: typeof fetch = fetch): Promise<ChatGPTModelChoice[]> {
  const runtime = await createChatGPTModelRuntime(auth, profileId);
  const connection = await runtime.getAuth('openai');
  if (!connection?.auth.apiKey) throw new ChatGPTError('sign_in_required', 'Sign in to ChatGPT before choosing a model.');
  const response = await request(`${BASE_URL}/models`, { headers: { Authorization: `Bearer ${connection.auth.apiKey}` }, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new ChatGPTError('models_unavailable', `ChatGPT model discovery failed (HTTP ${response.status}).`);
  const data = await response.json() as { models?: Array<{ slug: string; display_name: string; visibility: string }> };
  if (!Array.isArray(data.models)) throw new ChatGPTError('invalid_models', 'ChatGPT returned an unexpected model catalog.');
  return data.models.filter(model => model.visibility === 'list').map(model => {
    const known = runtime.getModel('openai', model.slug);
    return { id: model.slug, name: model.display_name, supported: Boolean(known?.api === 'openai-responses'), images: known?.input.includes('image') ?? false };
  });
}

export function chatGPTFailure(message: string): string {
  if (message.includes('subscription_sharing_usage_limit_exceeded')) return `ChatGPT 套餐或应用用量已达上限。请管理用量：${CHATGPT_USAGE_URL}`;
  if (message.includes('subscription_sharing_user_not_eligible')) return '当前 ChatGPT 账号或工作区不支持套餐调用。请选择符合条件的账号，或手动切换 API key。';
  if (message.includes('plan_not_enabled')) return '账号已连接，但尚未允许 OEYdesign 使用 ChatGPT 套餐。请在模型设置中启用。';
  if (message.includes('invalid_grant') || message.includes('sign_in_required')) return 'ChatGPT 连接已失效，请在模型设置中重新登录。';
  return message;
}
