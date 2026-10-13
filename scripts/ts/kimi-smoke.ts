import { stream } from '@earendil-works/pi-ai/api/anthropic-messages';
import { kimiCodingProvider } from '@earendil-works/pi-ai/providers/kimi-coding';

export const KIMI_SMOKE_LIMITS = Object.freeze({ requests: 1, maxTokens: 256, timeoutMs: 30_000, maxRetries: 0 });
// Official Kimi Code docs map this stable ID to K2.8 Preview (2026-09-11).
// Pi 0.85.1 still labels it K2.7; do not select by that stale display name.
export const KIMI_SMOKE_MODEL_ID = 'kimi-for-coding';
const baseUrl = 'https://api.kimi.com/coding';
const prompt = 'Reply with exactly OK and nothing else.';

export function kimiSmokeModel() {
  const model = kimiCodingProvider().getModels().find(item => item.id === KIMI_SMOKE_MODEL_ID);
  if (!model || model.provider !== 'kimi-coding' || model.api !== 'anthropic-messages' || model.baseUrl !== baseUrl) {
    throw new Error('Native Kimi model configuration does not match the approved endpoint and protocol.');
  }
  return model;
}

/** One synthetic Pi request; no project, tools, credential files, or agent loop. */
export async function runKimiSmoke(apiKey: string, transport: typeof fetch = globalThis.fetch) {
  const model = kimiSmokeModel();
  if (!apiKey) throw new Error('KIMI_API_KEY is missing.');
  const controller = new AbortController();
  let requests = 0;
  let httpStatus: number | undefined;
  let transportCode: string | undefined;
  let blocked = false;
  const guardedFetch: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const body = JSON.parse(await request.clone().text());
    if (requests !== 0 || url.origin !== 'https://api.kimi.com' || url.pathname !== '/coding/v1/messages'
      || (url.search !== '' && url.search !== '?beta=true') || url.username || url.password
      || request.method !== 'POST' || body.model !== KIMI_SMOKE_MODEL_ID || body.max_tokens !== 256 || body.tools?.length
      || body.thinking?.type !== 'disabled'
      || body.system?.length || body.messages?.length !== 1 || body.messages[0]?.role !== 'user'
      || body.messages[0]?.content !== prompt) {
      blocked = true;
      throw new Error('Smoke request rejected by local limits.');
    }
    requests++;
    try {
      const response = await transport(request, { redirect: 'error', signal: controller.signal });
      httpStatus = response.status;
      return response;
    } catch (error) {
      const detail = error as { code?: unknown; cause?: { code?: unknown } } | undefined;
      const code = detail?.cause?.code ?? detail?.code;
      if (typeof code === 'string' && ['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT',
        'ENETUNREACH', 'EHOSTUNREACH', 'CERT_HAS_EXPIRED', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
        'SELF_SIGNED_CERT_IN_CHAIN', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET'].includes(code)) transportCode = code;
      // Keep arbitrary transport messages (and any URLs/headers in them) out of SDK errors.
      throw new Error('Smoke transport failed.');
    }
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error('deadline')); }, KIMI_SMOKE_LIMITS.timeoutMs);
    });
    const result = await Promise.race([stream(model, {
      messages: [{ role: 'user', content: prompt, timestamp: Date.now() }],
    }, {
      apiKey, maxTokens: KIMI_SMOKE_LIMITS.maxTokens, maxRetries: 0,
      timeoutMs: KIMI_SMOKE_LIMITS.timeoutMs, signal: controller.signal,
      thinkingEnabled: false, cacheRetention: 'none', fetch: guardedFetch,
      // Pi's false option omits the field; Kimi defaults to thinking enabled.
      onPayload: payload => ({ ...(payload as Record<string, unknown>), thinking: { type: 'disabled' } }),
    }).result(), deadline]);
    const text = result.content.filter(part => part.type === 'text').map(part => part.text).join('').trim();
    const modelMatched = result.model === KIMI_SMOKE_MODEL_ID;
    const responseReceived = Boolean(result.responseId);
    const ok = modelMatched && result.stopReason === 'stop' && text === 'OK' && result.content.every(part => part.type === 'text');
    return {
      ok, requests, httpStatus, transportCode, responseReceived, protocol: result.api, provider: result.provider,
      requestedModel: KIMI_SMOKE_MODEL_ID, model: responseReceived ? result.model : undefined,
      status: ok ? 'ok' : blocked ? 'blocked' : controller.signal.aborted ? 'timeout'
        : result.stopReason === 'error' ? (httpStatus ? 'http_error' : 'transport_error')
        : !modelMatched ? 'model_mismatch' : 'unexpected_response',
      // Never expose response text, headers, or SDK error messages.
      usage: responseReceived ? { input: result.usage.input, output: result.usage.output, cacheRead: result.usage.cacheRead,
        cacheWrite: result.usage.cacheWrite, totalTokens: result.usage.totalTokens } : null,
    };
  } catch {
    return { ok: false, requests, httpStatus, status: controller.signal.aborted ? 'timeout' : 'transport_error' };
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
