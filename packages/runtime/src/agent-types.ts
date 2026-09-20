import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { Model, Api } from '@earendil-works/pi-ai';

export type AgentRunStatus = 'running' | 'waiting_input' | 'completed' | 'cancelled' | 'failed' | 'interrupted';
export type AgentInputKind = 'message' | 'steer' | 'follow_up' | 'answer';
export type AgentInputStatus = 'accepted' | 'delivered' | 'resolved' | 'cancelled' | 'interrupted';

export interface AgentSessionRecord {
  sessionId: string;
  title?: string;
  piSessionId: string;
  piSessionFile?: string;
  status: 'idle' | 'running' | 'waiting_input' | 'interrupted';
  createdAt: string;
  updatedAt: string;
  lastRunId?: string;
}

export interface AgentRunRecord {
  runId: string;
  sessionId: string;
  parentRunId?: string;
  status: AgentRunStatus;
  inputIds: string[];
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  error?: string;
}

export interface AgentInputRecord {
  inputId: string;
  sessionId: string;
  runId?: string;
  parentRunId?: string;
  kind: AgentInputKind;
  questionId?: string;
  assetIds?: string[];
  text: string;
  status: AgentInputStatus;
  createdAt: string;
  deliveredAt?: string;
  piEntryId?: string;
}

export interface AgentQuestionRecord {
  questionId: string;
  sessionId: string;
  runId: string;
  status: 'pending' | 'answered' | 'cancelled';
  prompt: string;
  options: string[];
  allowFreeText: boolean;
  createdAt: string;
  answeredAt?: string;
  answerInputId?: string;
}

export interface AgentSelection {
  documentId: string;
  nodeIds: string[];
  updatedAt: string;
}

/** Runtime-only provider details. apiKey is never stored in the project database. */
export interface AgentProviderConfig {
  providerId?: string;
  /** Accepted as a convenience for existing client forms. */
  provider?: string;
  providerName?: string;
  modelId?: string;
  /** Accepted as a convenience for existing client forms. */
  model?: string;
  baseUrl?: string;
  /** Runtime-only explicit secret; never returned by getConfig or persisted. */
  apiKey?: string;
  /** Name of a server environment variable containing the key. */
  apiKeyEnv?: string;
  api?: Api;
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
  compat?: Model<Api>['compat'];
  thinkingLevel?: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  userAgent?: string;
}

export interface PublicAgentConfig {
  configured: boolean;
  providerId?: string;
  providerName?: string;
  modelId?: string;
  baseUrl?: string;
  apiKeyEnv?: string;
  thinkingLevel?: AgentProviderConfig['thinkingLevel'];
}

export interface AgentSessionOptions {
  title?: string;
}

export interface AgentRunStart {
  runId: string;
  inputId: string;
}

export interface AgentAcceptedInputOptions {
  inputId?: string;
  assetIds?: string[];
}

export interface AgentServiceEvent {
  type: 'session.created' | 'input.accepted' | 'input.delivered' | 'run.started' | 'run.waiting_input'
    | 'run.completed' | 'run.cancelled' | 'run.failed' | 'run.interrupted' | 'question.created'
    | 'question.answered' | 'agent.event';
  sessionId: string;
  runId?: string;
  inputId?: string;
  questionId?: string;
  event?: unknown;
  record?: unknown;
  createdAt: string;
}

export interface AgentProviderRuntime {
  model: Model<Api>;
  dispose(): void;
}

export type AgentMessageList = AgentMessage[];
