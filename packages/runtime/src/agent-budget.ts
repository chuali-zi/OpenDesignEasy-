import type { StreamFn } from '@earendil-works/pi-agent-core';
import type { AssistantMessage } from '@earendil-works/pi-ai';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai/utils/event-stream';

/** Opt-in text/tool acceptance envelope, shared by every turn in one run. */
export interface AgentRunLimits {
  maxRequests: number;
  maxInputTokens: number;
  maxOutputTokens: number;
  maxOutputTokensPerRequest: number;
  maxToolCalls: number;
  timeoutMs: number;
  allowedTools: string[];
  /** When set, constrain actual HTTP requests, including redirects. */
  endpoint?: string;
  modelId?: string;
}

export interface AgentRunUsage {
  requests: number;
  toolCalls: number;
  inputTokens: number;
  outputTokens: number;
  reservedInputTokens: number;
  reservedOutputTokens: number;
  failure?: string;
}

export function validateRunLimits(limits: AgentRunLimits): void {
  for (const key of ['maxRequests', 'maxInputTokens', 'maxOutputTokens', 'maxOutputTokensPerRequest', 'maxToolCalls', 'timeoutMs'] as const) {
    if (!Number.isSafeInteger(limits[key]) || limits[key] <= 0) throw new Error(`Invalid agent run limit: ${key}`);
  }
  if (!Array.isArray(limits.allowedTools) || !limits.allowedTools.every(tool => typeof tool === 'string' && tool.length)) throw new Error('Invalid allowedTools.');
  if (limits.endpoint && new URL(limits.endpoint).protocol !== 'https:') throw new Error('Budget endpoint must use HTTPS.');
}

export class AgentRunBudget {
  readonly controller = new AbortController();
  readonly usage: AgentRunUsage = { requests: 0, toolCalls: 0, inputTokens: 0, outputTokens: 0, reservedInputTokens: 0, reservedOutputTokens: 0 };
  private readonly timer: ReturnType<typeof setTimeout>;
  constructor(readonly limits: AgentRunLimits, private readonly onFailure: (reason: string) => void) {
    validateRunLimits(limits);
    this.timer = setTimeout(() => this.fail('deadline'), limits.timeoutMs);
  }
  close(): void { clearTimeout(this.timer); this.controller.abort(); }
  private fail(reason: string): Error {
    if (!this.usage.failure) {
      this.usage.failure = reason;
      this.onFailure(`Agent run budget stopped: ${reason}`);
      this.close();
    }
    return new Error(`Agent run budget stopped: ${this.usage.failure}`);
  }
  beforeTool(name: string): void {
    if (this.controller.signal.aborted) throw this.fail('stopped');
    if (!this.limits.allowedTools.includes(name)) throw this.fail('tool_not_allowed');
    if (this.usage.toolCalls >= this.limits.maxToolCalls) throw this.fail('tool_calls');
    this.usage.toolCalls++;
  }
  wrap(delegate: StreamFn): StreamFn {
    return (model, context, options) => {
      const output = createAssistantMessageEventStream();
      const signal = AbortSignal.any([this.controller.signal, ...(options?.signal ? [options.signal] : [])]);
      let finished = false;
      const finishError = () => {
        if (finished) return;
        finished = true;
        const message: AssistantMessage = { role: 'assistant', content: [], api: model.api, provider: model.provider, model: model.id,
          stopReason: 'error', errorMessage: `Agent run budget stopped: ${this.usage.failure ?? 'aborted'}`, timestamp: Date.now(),
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
        output.push({ type: 'error', reason: 'error', error: message }); output.end(message);
      };
      signal.addEventListener('abort', finishError, { once: true });
      void (async () => {
        try {
          if (signal.aborted) throw this.fail('stopped');
          if (this.limits.modelId && model.id !== this.limits.modelId) throw this.fail('model_mismatch');
          if (this.usage.requests >= this.limits.maxRequests) throw this.fail('requests');
          // Byte reservation is conservative for text, not a vendor tokenizer.
          // Images are rejected: their provider-specific token accounting needs a separate envelope.
          if (context.messages.some(message => typeof message.content !== 'string' && message.content.some(part => part.type === 'image'))) throw this.fail('images_not_budgeted');
          const reservedInput = Buffer.byteLength(JSON.stringify(context), 'utf8') + 4096;
          if (this.usage.reservedInputTokens + reservedInput > this.limits.maxInputTokens) throw this.fail('input_tokens');
          const maxTokens = Math.min(this.limits.maxOutputTokensPerRequest, this.limits.maxOutputTokens - this.usage.reservedOutputTokens);
          if (maxTokens <= 0) throw this.fail('output_tokens');
          this.usage.requests++; this.usage.reservedInputTokens += reservedInput; this.usage.reservedOutputTokens += maxTokens;
          let httpCalls = 0;
          const fetchOnce: typeof fetch = async (input, init) => {
            const request = new Request(input, init);
            const target = new URL(request.url);
            const expected = this.limits.endpoint ? new URL(this.limits.endpoint) : new URL(`${model.baseUrl.replace(/\/$/, '')}/v1/messages`);
            if (httpCalls++ || target.origin !== expected.origin || target.pathname !== expected.pathname || target.username || target.password
              || !['', '?beta=true'].includes(target.search) || request.method !== 'POST') throw this.fail('http_target_or_retry');
            const body = await request.clone().json();
            if (body.max_tokens !== maxTokens || body.model !== model.id) throw this.fail('http_budget');
            return globalThis.fetch(request, { redirect: 'error', signal });
          };
          const stream = await delegate(model, context, { ...options, signal, maxTokens, maxRetries: 0,
            timeoutMs: this.limits.timeoutMs, reasoning: undefined, transport: 'sse', cacheRetention: 'none', fetch: fetchOnce,
            onPayload: payload => ({ ...(payload as Record<string, unknown>), thinking: { type: 'disabled' } }),
          });
          for await (const event of stream) {
            if (finished || signal.aborted) return;
            if (event.type === 'done' || event.type === 'error') {
              const result = event.type === 'done' ? event.message : event.error;
              const input = result.usage.input + result.usage.cacheRead + result.usage.cacheWrite;
              const out = result.usage.output;
              if (![input, out].every(value => Number.isFinite(value) && value >= 0)) throw this.fail('invalid_usage');
              this.usage.inputTokens += input; this.usage.outputTokens += out;
              if (input > reservedInput || out > maxTokens || this.usage.inputTokens > this.limits.maxInputTokens || this.usage.outputTokens > this.limits.maxOutputTokens) throw this.fail('reported_tokens');
              if (result.stopReason === 'error' || result.stopReason === 'aborted') throw this.fail('provider_error');
              if (result.model !== model.id) throw this.fail('response_model_mismatch');
              finished = true;
            }
            output.push(event);
          }
          if (!finished) throw this.fail('incomplete_stream');
        } catch { if (!this.usage.failure && !signal.aborted) this.fail('provider_error'); finishError(); }
        finally { signal.removeEventListener('abort', finishError); }
      })();
      return output;
    };
  }
}
