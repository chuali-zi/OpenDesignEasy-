/**
 * R1 Pi SDK compatibility check.
 *
 * This uses Pi's published faux provider with in-memory credentials and
 * sessions. It makes no provider network requests and never loads user Pi
 * extensions, skills, prompt files, context files, themes, or settings.
 *
 * Run from the workspace after dependencies are installed:
 *
 *   npm run check:compat
 */

import type { AgentTool } from "@earendil-works/pi-agent-core";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import {
  InMemoryCredentialStore,
  Type,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TOOL_NAME = "r1_probe_tool";
const checks: Record<string, unknown> = {
  package: "@earendil-works/pi-coding-agent@0.85.1",
  provider: "Pi faux provider",
  network: false,
  credentials: false,
  extensions: false,
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function within<T>(label: string, promise: Promise<T>, timeoutMs = 8_000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label} (${timeoutMs} ms)`)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function capture<T>(promise: Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  return promise.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );
}

function createProbeTool(onExecute: (value: string) => void): AgentTool {
  return {
    name: TOOL_NAME,
    label: "R1 probe tool",
    description: "Returns a deterministic in-memory result for R1.",
    parameters: Type.Object({ value: Type.String() }),
    execute: async (_toolCallId, rawParams) => {
      const params = rawParams as { value: string };
      onExecute(params.value);
      return {
        content: [{ type: "text", text: `probe:${params.value}` }],
        details: { value: params.value },
      };
    },
  };
}

interface ProbeSession {
  session: Awaited<ReturnType<typeof createAgentSession>>["session"];
  directory: string;
}

async function createProbeSession(
  faux: ReturnType<typeof fauxProvider>,
  tools: AgentTool[] = [],
): Promise<ProbeSession> {
  const directory = await mkdtemp(join(tmpdir(), "oey-r1-pi-"));
  try {
    const settingsManager = SettingsManager.inMemory();
    const resourceLoader = new DefaultResourceLoader({
      cwd: directory,
      agentDir: directory,
      settingsManager,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      systemPrompt: "R1 SDK compatibility probe. Use only the supplied faux model and tools.",
    });
    await resourceLoader.reload();

    const modelRuntime = await ModelRuntime.create({
      credentials: new InMemoryCredentialStore(),
      modelsPath: null,
      allowModelNetwork: false,
      refreshOnCreate: false,
    });
    modelRuntime.registerNativeProvider(faux.provider);

    const { session } = await createAgentSession({
      cwd: directory,
      agentDir: directory,
      model: faux.getModel(),
      thinkingLevel: "off",
      resourceLoader,
      modelRuntime,
      settingsManager,
      sessionManager: SessionManager.inMemory(directory),
      tools: tools.map((tool) => tool.name),
      customTools: tools,
    });

    return { session, directory };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

async function closeProbeSession(probe: ProbeSession): Promise<void> {
  if (!probe.session.isIdle) {
    try {
      await within("session abort", probe.session.abort(), 2_000);
    } catch {
      // Dispose below also aborts the public AgentSession operation.
    }
    try {
      await within("session idle", probe.session.waitForIdle(), 2_000);
    } catch {
      // Keep cleanup bounded even if an SDK operation fails to settle.
    }
  }
  probe.session.dispose();
  await rm(probe.directory, { recursive: true, force: true });
}

function contextText(context: { messages: unknown[] }): string {
  return JSON.stringify(context.messages);
}

async function checkAgentSessionInteractions(): Promise<void> {
  const faux = fauxProvider({
    provider: "oey-r1-session-faux",
    models: [{ id: "r1-session", contextWindow: 8_192, maxTokens: 256 }],
  });
  const executions: string[] = [];
  const contexts: string[] = [];
  const firstRequestStarted = deferred<void>();
  const releaseFirstResponse = deferred<void>();
  const tool = createProbeTool((value) => executions.push(value));
  const probe = await createProbeSession(faux, [tool]);

  try {
    assert(probe.session.getToolDefinition(TOOL_NAME), "customTools was not registered in AgentSession");
    await probe.session.sendCustomMessage({
      customType: "r1_probe",
      content: "in-memory custom message",
      display: true,
      details: { source: "r1" },
    });

    faux.setResponses([
      async (context) => {
        contexts.push(contextText(context));
        firstRequestStarted.resolve();
        await releaseFirstResponse.promise;
        return fauxAssistantMessage(
          fauxToolCall(TOOL_NAME, { value: "success" }, { id: "r1-success-call" }),
          { stopReason: "toolUse" },
        );
      },
      (context) => {
        contexts.push(contextText(context));
        return fauxAssistantMessage("Steering reached the faux model.", { stopReason: "stop" });
      },
      (context) => {
        contexts.push(contextText(context));
        return fauxAssistantMessage("Follow-up reached the faux model.", { stopReason: "stop" });
      },
    ]);

    const run = capture(probe.session.prompt("initial R1 prompt", { expandPromptTemplates: false }));
    await within("first faux model request", firstRequestStarted.promise);
    assert(probe.session.isStreaming, "AgentSession should report an active model request");
    await within(
      "steering queue",
      probe.session.prompt("steer message delivered", {
        expandPromptTemplates: false,
        streamingBehavior: "steer",
      }),
    );
    await within(
      "follow-up queue",
      probe.session.prompt("follow-up message delivered", {
        expandPromptTemplates: false,
        streamingBehavior: "followUp",
      }),
    );
    assert(probe.session.pendingMessageCount === 2, "steer and follow-up should both be queued during the request");
    releaseFirstResponse.resolve();
    const runResult = await within("faux tool, steer, and follow-up turns", run);
    if (!runResult.ok) throw runResult.error;

    assert(executions.length === 1 && executions[0] === "success", "the registered tool should execute successfully once");
    assert(faux.state.callCount === 3, "the faux provider should receive initial, steered, and follow-up requests");
    assert(contexts[1]?.includes("steer message delivered"), "steering text should appear in the next model context");
    assert(contexts[1]?.includes("probe:success"), "the successful tool result should appear in the next model context");
    assert(contexts[2]?.includes("follow-up message delivered"), "follow-up text should appear in the later model context");

    checks.agentSession = {
      status: "pass",
      customToolRegistered: true,
      successfulToolExecutions: executions.length,
      fauxCalls: faux.state.callCount,
      steerDelivered: true,
      followUpDelivered: true,
      customMessage: "sent",
    };
  } finally {
    releaseFirstResponse.resolve();
    await closeProbeSession(probe);
  }
}

async function checkBeforeToolCall(): Promise<void> {
  const faux = fauxProvider({
    provider: "oey-r1-before-tool-faux",
    models: [{ id: "r1-before-tool", contextWindow: 8_192, maxTokens: 256 }],
  });
  const executions: string[] = [];
  const tool = createProbeTool((value) => executions.push(value));
  const probe = await createProbeSession(faux, [tool]);
  let beforeCalls = 0;

  try {
    probe.session.agent.beforeToolCall = async () => {
      beforeCalls += 1;
      return { block: true, reason: "R1 compatibility probe", terminate: true };
    };
    faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall(TOOL_NAME, { value: "blocked" }, { id: "r1-blocked-call" }),
        { stopReason: "toolUse" },
      ),
    ]);
    await within("beforeToolCall session run", probe.session.prompt("exercise beforeToolCall", { expandPromptTemplates: false }));

    assert(beforeCalls === 1, "beforeToolCall should receive the real faux tool call");
    assert(executions.length === 0, "a blocked tool must not execute");
    assert(faux.state.callCount === 1, "a terminating blocked call should end without another model request");
    checks.beforeToolCall = {
      status: "pass",
      calls: beforeCalls,
      blockedToolExecutions: executions.length,
      fauxCalls: faux.state.callCount,
    };
  } finally {
    await closeProbeSession(probe);
  }
}

async function checkShouldStopAfterTurn(): Promise<void> {
  const faux = fauxProvider({
    provider: "oey-r1-stop-after-turn-faux",
    models: [{ id: "r1-stop-after-turn", contextWindow: 8_192, maxTokens: 256 }],
  });
  const executions: string[] = [];
  const tool = createProbeTool((value) => executions.push(value));
  const probe = await createProbeSession(faux, [tool]);
  let stopCalls = 0;

  try {
    probe.session.agent.shouldStopAfterTurn = async () => {
      stopCalls += 1;
      return true;
    };
    faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall(TOOL_NAME, { value: "completed-before-stop" }, { id: "r1-stop-after-tool" }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("This next request must not happen.", { stopReason: "stop" }),
    ]);

    await within(
      "shouldStopAfterTurn session run",
      probe.session.prompt("stop after the completed tool turn", { expandPromptTemplates: false }),
    );

    assert(stopCalls === 1, "shouldStopAfterTurn should run for the completed turn");
    assert(faux.state.callCount === 1, "shouldStopAfterTurn must stop before another model request");
    assert(executions.length === 1, "the current tool batch should finish before shouldStopAfterTurn runs");
    checks.shouldStopAfterTurn = {
      status: "pass",
      calls: stopCalls,
      fauxCalls: faux.state.callCount,
      toolExecutionsBeforeStop: executions.length,
    };
  } finally {
    await closeProbeSession(probe);
  }
}

function rejectOnAbort(signal: AbortSignal | undefined, observed: () => void): Promise<never> {
  if (!signal) return Promise.reject(new Error("faux provider did not receive an AbortSignal"));
  if (signal.aborted) {
    observed();
    return Promise.reject(new Error("faux model request was aborted"));
  }
  return new Promise((_, reject) => {
    signal.addEventListener("abort", () => {
      observed();
      reject(new Error("faux model request was aborted"));
    }, { once: true });
  });
}

async function checkActiveAbort(): Promise<void> {
  const faux = fauxProvider({
    provider: "oey-r1-abort-faux",
    models: [{ id: "r1-abort", contextWindow: 8_192, maxTokens: 256 }],
  });
  const requestStarted = deferred<void>();
  const probe = await createProbeSession(faux);
  let abortObserved = false;

  try {
    faux.setResponses([
      async (_context, options) => {
        requestStarted.resolve();
        await rejectOnAbort(options?.signal, () => {
          abortObserved = true;
        });
        return fauxAssistantMessage("unreachable after abort", { stopReason: "stop" });
      },
    ]);

    const run = capture(probe.session.prompt("abort this active faux request", { expandPromptTemplates: false }));
    await within("active abort faux request", requestStarted.promise);
    assert(probe.session.isStreaming, "abort probe must be an active model request");
    assert(faux.state.callCount === 1, "abort probe must have entered the faux provider");
    await within("AgentSession.abort", probe.session.abort());
    const runResult = await within("aborted prompt settlement", run);
    if (!runResult.ok) throw runResult.error;
    await within("aborted session idle state", probe.session.waitForIdle());

    assert(abortObserved, "AgentSession.abort should abort the in-flight faux model request");
    assert(probe.session.isIdle, "the session should settle after abort");
    assert(faux.state.callCount === 1, "abort should prevent another faux request");
    checks.activeAbort = {
      status: "pass",
      abortedInFlightModelRequest: abortObserved,
      fauxCalls: faux.state.callCount,
      sessionIdleAfterAbort: probe.session.isIdle,
    };
  } finally {
    await closeProbeSession(probe);
  }
}

async function main(): Promise<void> {
  const startedAt = Date.now();
  await within("AgentSession custom tool, steer, and follow-up checks", checkAgentSessionInteractions());
  await within("beforeToolCall check", checkBeforeToolCall());
  await within("shouldStopAfterTurn check", checkShouldStopAfterTurn());
  await within("active abort check", checkActiveAbort());
  checks.elapsedMs = Date.now() - startedAt;
  console.log(JSON.stringify({ status: "pass", checks }, null, 2));
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({
    status: "fail",
    error: error instanceof Error ? error.message : String(error),
    checks,
  }, null, 2));
  process.exitCode = 1;
});
