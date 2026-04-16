import type * as vscode from 'vscode';

import { TOOL_DONE_DELAY_MS } from '../server/src/constants.js';
import { formatCodexToolStatus, normalizeCodexToolName, parseCodexToolArguments } from './codex.js';
import { cancelPermissionTimer, cancelWaitingTimer, clearAgentActivity } from './timerManager.js';
import type { AgentState } from './types.js';

export function processCodexTranscriptRecord(
  agentId: number,
  record: Record<string, unknown>,
  agents: Map<number, AgentState>,
  waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
  permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
  webview: vscode.Webview | undefined,
): void {
  const agent = agents.get(agentId);
  if (!agent) return;

  const recordType = typeof record.type === 'string' ? record.type : '';
  const payload =
    record.payload && typeof record.payload === 'object'
      ? (record.payload as Record<string, unknown>)
      : {};

  if (recordType === 'session_meta') {
    const sessionId = typeof payload.id === 'string' ? payload.id : undefined;
    const cwd = typeof payload.cwd === 'string' ? payload.cwd : undefined;
    if (sessionId) {
      agent.sessionId = sessionId;
    }
    if (cwd) {
      agent.projectDir = cwd;
    }
    return;
  }

  if (recordType === 'event_msg') {
    processCodexEventMessage(
      agentId,
      agent,
      payload,
      agents,
      waitingTimers,
      permissionTimers,
      webview,
    );
    return;
  }

  if (recordType === 'response_item') {
    processCodexResponseItem(agentId, agent, payload, waitingTimers, permissionTimers, webview);
  }
}

function processCodexEventMessage(
  agentId: number,
  agent: AgentState,
  payload: Record<string, unknown>,
  agents: Map<number, AgentState>,
  waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
  permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
  webview: vscode.Webview | undefined,
): void {
  const eventType = typeof payload.type === 'string' ? payload.type : '';

  switch (eventType) {
    case 'task_started':
    case 'user_message':
      cancelWaitingTimer(agentId, waitingTimers);
      clearAgentActivity(agent, agentId, permissionTimers, webview);
      agent.hadToolsInTurn = false;
      break;
    case 'token_count': {
      const info =
        payload.info && typeof payload.info === 'object'
          ? (payload.info as Record<string, unknown>)
          : null;
      const usage =
        info?.total_token_usage && typeof info.total_token_usage === 'object'
          ? (info.total_token_usage as Record<string, unknown>)
          : null;
      if (usage) {
        agent.inputTokens =
          typeof usage.input_tokens === 'number' ? usage.input_tokens : agent.inputTokens;
        agent.outputTokens =
          typeof usage.output_tokens === 'number' ? usage.output_tokens : agent.outputTokens;
        webview?.postMessage({
          type: 'agentTokenUsage',
          id: agentId,
          inputTokens: agent.inputTokens,
          outputTokens: agent.outputTokens,
        });
      }
      break;
    }
    case 'exec_command_end': {
      const callId = typeof payload.call_id === 'string' ? payload.call_id : undefined;
      if (callId) {
        finishCodexTool(agentId, agent, callId, webview);
      }
      break;
    }
    case 'web_search_end': {
      const query = typeof payload.query === 'string' ? payload.query : undefined;
      if (query) {
        finishCodexTool(agentId, agent, `web-search:${query}`, webview);
      }
      break;
    }
    case 'task_complete':
      cancelWaitingTimer(agentId, waitingTimers);
      cancelPermissionTimer(agentId, permissionTimers);
      for (const toolId of agent.codexSpawnedAgentsByToolId.keys()) {
        webview?.postMessage({ type: 'subagentClear', id: agentId, parentToolId: toolId });
      }
      agent.activeToolIds.clear();
      agent.activeToolStatuses.clear();
      agent.activeToolNames.clear();
      agent.codexToolArgumentsById.clear();
      agent.activeSubagentToolIds.clear();
      agent.activeSubagentToolNames.clear();
      agent.backgroundAgentToolIds.clear();
      agent.codexSpawnedAgentsByToolId.clear();
      agent.codexSpawnedToolIdByAgentId.clear();
      agent.isWaiting = true;
      agent.permissionSent = false;
      agent.hadToolsInTurn = false;
      webview?.postMessage({ type: 'agentToolsClear', id: agentId });
      webview?.postMessage({ type: 'agentStatus', id: agentId, status: 'waiting' });
      break;
    case 'agent_message':
      if (agent.activeToolIds.size > 0 || agent.isWaiting) {
        agent.isWaiting = false;
        webview?.postMessage({ type: 'agentStatus', id: agentId, status: 'active' });
      }
      break;
    default:
      break;
  }

  void agents;
}

function processCodexResponseItem(
  agentId: number,
  agent: AgentState,
  payload: Record<string, unknown>,
  waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
  permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
  webview: vscode.Webview | undefined,
): void {
  const responseType = typeof payload.type === 'string' ? payload.type : '';

  if (responseType === 'function_call') {
    const rawToolName = typeof payload.name === 'string' ? payload.name : '';
    const callId = typeof payload.call_id === 'string' ? payload.call_id : '';
    if (!rawToolName || !callId) return;

    cancelWaitingTimer(agentId, waitingTimers);
    cancelPermissionTimer(agentId, permissionTimers);
    agent.isWaiting = false;
    agent.hadToolsInTurn = true;

    const parsedArguments = parseCodexToolArguments(
      typeof payload.arguments === 'string'
        ? payload.arguments
        : (payload.arguments as Record<string, unknown> | undefined),
    );
    const toolName = normalizeCodexToolName(rawToolName);
    const status = formatCodexToolStatus(rawToolName, parsedArguments);
    agent.activeToolIds.add(callId);
    agent.activeToolStatuses.set(callId, status);
    agent.activeToolNames.set(callId, toolName);
    agent.codexToolArgumentsById.set(callId, parsedArguments);

    webview?.postMessage({ type: 'agentStatus', id: agentId, status: 'active' });
    webview?.postMessage({
      type: 'agentToolStart',
      id: agentId,
      toolId: callId,
      status,
      toolName,
    });
    return;
  }

  if (responseType === 'function_call_output') {
    const callId = typeof payload.call_id === 'string' ? payload.call_id : undefined;
    if (callId) {
      const toolName = agent.activeToolNames.get(callId);
      const argumentsInput = agent.codexToolArgumentsById.get(callId);
      const output = parseCodexFunctionOutput(
        typeof payload.output === 'string' ? payload.output : undefined,
      );

      if (toolName === 'Agent') {
        const spawnedAgentId = typeof output?.agent_id === 'string' ? output.agent_id : undefined;
        if (spawnedAgentId) {
          const nickname = typeof output?.nickname === 'string' ? output.nickname : undefined;
          agent.codexSpawnedAgentsByToolId.set(callId, { agentId: spawnedAgentId, nickname });
          agent.codexSpawnedToolIdByAgentId.set(spawnedAgentId, callId);
          webview?.postMessage({
            type: 'subagentToolStart',
            id: agentId,
            parentToolId: callId,
            toolId: `codex-agent:${spawnedAgentId}`,
            status: nickname ? `Task: ${nickname}` : 'Task: Delegated agent',
          });
        }
      }

      if (toolName === 'wait_agent') {
        const completedAgentIds = getCompletedCodexAgentIds(output, argumentsInput);
        for (const spawnedAgentId of completedAgentIds) {
          clearCodexSpawnedAgent(agentId, agent, spawnedAgentId, webview);
        }
      }

      if (toolName === 'close_agent') {
        const target =
          typeof argumentsInput?.target === 'string' ? argumentsInput.target : undefined;
        if (target) {
          clearCodexSpawnedAgent(agentId, agent, target, webview);
        }
      }

      finishCodexTool(agentId, agent, callId, webview);
    }
    return;
  }

  if (responseType === 'web_search_call') {
    const action =
      payload.action && typeof payload.action === 'object'
        ? (payload.action as Record<string, unknown>)
        : null;
    const query = typeof action?.query === 'string' ? action.query : '';
    if (!query) return;

    cancelWaitingTimer(agentId, waitingTimers);
    cancelPermissionTimer(agentId, permissionTimers);
    agent.isWaiting = false;
    agent.hadToolsInTurn = true;

    const toolId = `web-search:${query}`;
    const status = 'Searching the web';
    agent.activeToolIds.add(toolId);
    agent.activeToolStatuses.set(toolId, status);
    agent.activeToolNames.set(toolId, 'web_search');

    webview?.postMessage({ type: 'agentStatus', id: agentId, status: 'active' });
    webview?.postMessage({
      type: 'agentToolStart',
      id: agentId,
      toolId,
      status,
      toolName: 'web_search',
    });

    if (payload.status === 'completed') {
      finishCodexTool(agentId, agent, toolId, webview);
    }
  }
}

function finishCodexTool(
  agentId: number,
  agent: AgentState,
  toolId: string,
  webview: vscode.Webview | undefined,
): void {
  if (!agent.activeToolIds.has(toolId)) return;

  agent.activeToolIds.delete(toolId);
  agent.activeToolStatuses.delete(toolId);
  agent.activeToolNames.delete(toolId);
  agent.codexToolArgumentsById.delete(toolId);

  setTimeout(() => {
    webview?.postMessage({
      type: 'agentToolDone',
      id: agentId,
      toolId,
    });
  }, TOOL_DONE_DELAY_MS);
}

function parseCodexFunctionOutput(output: string | undefined): Record<string, unknown> | null {
  if (!output) return null;
  try {
    const parsed = JSON.parse(output);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function getCompletedCodexAgentIds(
  output: Record<string, unknown> | null,
  argumentsInput: Record<string, unknown> | undefined,
): string[] {
  const status =
    output?.status && typeof output.status === 'object'
      ? (output.status as Record<string, unknown>)
      : null;
  if (status && Object.keys(status).length > 0) {
    return Object.keys(status);
  }
  if (output?.timed_out === true) {
    return [];
  }

  const targets = Array.isArray(argumentsInput?.targets) ? argumentsInput.targets : [];
  return targets.filter((target): target is string => typeof target === 'string');
}

function clearCodexSpawnedAgent(
  agentId: number,
  agent: AgentState,
  spawnedAgentId: string,
  webview: vscode.Webview | undefined,
): void {
  const parentToolId = agent.codexSpawnedToolIdByAgentId.get(spawnedAgentId);
  if (!parentToolId) return;

  agent.codexSpawnedToolIdByAgentId.delete(spawnedAgentId);
  agent.codexSpawnedAgentsByToolId.delete(parentToolId);

  webview?.postMessage({
    type: 'subagentToolDone',
    id: agentId,
    parentToolId,
    toolId: `codex-agent:${spawnedAgentId}`,
  });
  webview?.postMessage({ type: 'subagentClear', id: agentId, parentToolId });
}
