import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { processTranscriptLine } from '../../src/transcriptParser.js';
import type { AgentState } from '../../src/types.js';
import { TOOL_DONE_DELAY_MS } from '../src/constants.js';

function createTestAgent(overrides: Partial<AgentState> = {}): AgentState {
  return {
    id: 1,
    sessionId: 'pending-1',
    terminalRef: undefined,
    isExternal: false,
    projectDir: 'c:\\repo',
    jsonlFile: 'c:\\Users\\me\\.codex\\sessions\\2026\\04\\15\\session.jsonl',
    fileOffset: 0,
    lineBuffer: '',
    activeToolIds: new Set(),
    activeToolStatuses: new Map(),
    activeToolNames: new Map(),
    codexToolArgumentsById: new Map(),
    activeSubagentToolIds: new Map(),
    activeSubagentToolNames: new Map(),
    backgroundAgentToolIds: new Set(),
    codexSpawnedAgentsByToolId: new Map(),
    codexSpawnedToolIdByAgentId: new Map(),
    isWaiting: false,
    permissionSent: false,
    hadToolsInTurn: false,
    lastDataAt: 0,
    linesProcessed: 0,
    seenUnknownRecordTypes: new Set(),
    hookDelivered: false,
    providerId: 'codex',
    inputTokens: 0,
    outputTokens: 0,
    ...overrides,
  };
}

function createMockWebview() {
  const messages: Array<Record<string, unknown>> = [];
  return {
    postMessage: vi.fn((message: Record<string, unknown>) => {
      messages.push(message);
      return Promise.resolve(true);
    }),
    messages,
  };
}

describe('Codex transcript parsing', () => {
  let agents: Map<number, AgentState>;
  let waitingTimers: Map<number, ReturnType<typeof setTimeout>>;
  let permissionTimers: Map<number, ReturnType<typeof setTimeout>>;
  let webview: ReturnType<typeof createMockWebview>;

  beforeEach(() => {
    vi.useFakeTimers();
    agents = new Map();
    waitingTimers = new Map();
    permissionTimers = new Map();
    webview = createMockWebview();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('tracks Codex function calls and completions by call_id', () => {
    const agent = createTestAgent();
    agents.set(agent.id, agent);

    processTranscriptLine(
      agent.id,
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'function_call',
          name: 'shell_command',
          call_id: 'call_123',
          arguments: JSON.stringify({ command: 'npm test' }),
        },
      }),
      agents,
      waitingTimers,
      permissionTimers,
      webview as unknown as import('vscode').Webview,
    );

    expect(agent.activeToolIds.has('call_123')).toBe(true);
    expect(
      webview.messages.find(
        (message) => message.type === 'agentToolStart' && message.toolId === 'call_123',
      ),
    ).toMatchObject({
      type: 'agentToolStart',
      id: agent.id,
      toolId: 'call_123',
      toolName: 'shell_command',
      status: 'Running: npm test',
    });

    processTranscriptLine(
      agent.id,
      JSON.stringify({
        type: 'event_msg',
        payload: {
          type: 'exec_command_end',
          call_id: 'call_123',
        },
      }),
      agents,
      waitingTimers,
      permissionTimers,
      webview as unknown as import('vscode').Webview,
    );

    expect(agent.activeToolIds.has('call_123')).toBe(false);
    vi.advanceTimersByTime(TOOL_DONE_DELAY_MS);
    expect(
      webview.messages.find(
        (message) => message.type === 'agentToolDone' && message.toolId === 'call_123',
      ),
    ).toBeTruthy();
  });

  it('uses Codex total token usage when available', () => {
    const agent = createTestAgent();
    agents.set(agent.id, agent);

    processTranscriptLine(
      agent.id,
      JSON.stringify({
        type: 'event_msg',
        payload: {
          type: 'token_count',
          info: {
            total_token_usage: {
              input_tokens: 321,
              output_tokens: 45,
            },
          },
        },
      }),
      agents,
      waitingTimers,
      permissionTimers,
      webview as unknown as import('vscode').Webview,
    );

    expect(agent.inputTokens).toBe(321);
    expect(agent.outputTokens).toBe(45);
    expect(webview.messages.find((message) => message.type === 'agentTokenUsage')).toMatchObject({
      type: 'agentTokenUsage',
      id: agent.id,
      inputTokens: 321,
      outputTokens: 45,
    });
  });

  it('finishes completed web searches even when the call record arrives last', () => {
    const agent = createTestAgent();
    agents.set(agent.id, agent);

    processTranscriptLine(
      agent.id,
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'web_search_call',
          status: 'completed',
          action: {
            type: 'search',
            query: 'codex session logs',
          },
        },
      }),
      agents,
      waitingTimers,
      permissionTimers,
      webview as unknown as import('vscode').Webview,
    );

    vi.advanceTimersByTime(TOOL_DONE_DELAY_MS);
    expect(agent.activeToolIds.size).toBe(0);
    expect(
      webview.messages.find(
        (message) =>
          message.type === 'agentToolDone' && message.toolId === 'web-search:codex session logs',
      ),
    ).toBeTruthy();
  });

  it('marks Codex agents waiting on task completion and clears live tools', () => {
    const agent = createTestAgent({
      isWaiting: false,
      hadToolsInTurn: true,
    });
    agent.activeToolIds.add('call_1');
    agent.activeToolStatuses.set('call_1', 'Running: npm test');
    agent.activeToolNames.set('call_1', 'shell_command');
    agents.set(agent.id, agent);

    processTranscriptLine(
      agent.id,
      JSON.stringify({
        type: 'event_msg',
        payload: {
          type: 'task_complete',
        },
      }),
      agents,
      waitingTimers,
      permissionTimers,
      webview as unknown as import('vscode').Webview,
    );

    expect(agent.activeToolIds.size).toBe(0);
    expect(agent.isWaiting).toBe(true);
    expect(
      webview.messages.find(
        (message) => message.type === 'agentToolsClear' && message.id === agent.id,
      ),
    ).toBeTruthy();
    expect(
      webview.messages.find(
        (message) =>
          message.type === 'agentStatus' && message.id === agent.id && message.status === 'waiting',
      ),
    ).toBeTruthy();
  });

  it('surfaces spawned Codex subagents and clears them after wait_agent completes', () => {
    const agent = createTestAgent();
    agents.set(agent.id, agent);

    processTranscriptLine(
      agent.id,
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'function_call',
          name: 'spawn_agent',
          call_id: 'call_spawn_1',
          arguments: JSON.stringify({
            message: 'Inspect the repo graph and summarize one subsystem.',
          }),
        },
      }),
      agents,
      waitingTimers,
      permissionTimers,
      webview as unknown as import('vscode').Webview,
    );

    expect(
      webview.messages.find(
        (message) =>
          message.type === 'agentToolStart' &&
          message.toolId === 'call_spawn_1' &&
          message.toolName === 'Agent',
      ),
    ).toMatchObject({
      type: 'agentToolStart',
      id: agent.id,
      toolId: 'call_spawn_1',
      toolName: 'Agent',
    });

    processTranscriptLine(
      agent.id,
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'function_call_output',
          call_id: 'call_spawn_1',
          output: JSON.stringify({
            agent_id: 'agent-child-1',
            nickname: 'Scout',
          }),
        },
      }),
      agents,
      waitingTimers,
      permissionTimers,
      webview as unknown as import('vscode').Webview,
    );

    expect(agent.codexSpawnedToolIdByAgentId.get('agent-child-1')).toBe('call_spawn_1');
    expect(
      webview.messages.find(
        (message) =>
          message.type === 'subagentToolStart' &&
          message.parentToolId === 'call_spawn_1' &&
          message.toolId === 'codex-agent:agent-child-1',
      ),
    ).toMatchObject({
      type: 'subagentToolStart',
      id: agent.id,
      parentToolId: 'call_spawn_1',
      toolId: 'codex-agent:agent-child-1',
      status: 'Task: Scout',
    });

    processTranscriptLine(
      agent.id,
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'function_call',
          name: 'wait_agent',
          call_id: 'call_wait_1',
          arguments: JSON.stringify({
            targets: ['agent-child-1'],
            timeout_ms: 60000,
          }),
        },
      }),
      agents,
      waitingTimers,
      permissionTimers,
      webview as unknown as import('vscode').Webview,
    );

    processTranscriptLine(
      agent.id,
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'function_call_output',
          call_id: 'call_wait_1',
          output: JSON.stringify({
            status: {
              'agent-child-1': {
                completed: '- done',
              },
            },
            timed_out: false,
          }),
        },
      }),
      agents,
      waitingTimers,
      permissionTimers,
      webview as unknown as import('vscode').Webview,
    );

    expect(agent.codexSpawnedToolIdByAgentId.has('agent-child-1')).toBe(false);
    expect(
      webview.messages.find(
        (message) =>
          message.type === 'subagentToolDone' &&
          message.parentToolId === 'call_spawn_1' &&
          message.toolId === 'codex-agent:agent-child-1',
      ),
    ).toBeTruthy();
    expect(
      webview.messages.find(
        (message) => message.type === 'subagentClear' && message.parentToolId === 'call_spawn_1',
      ),
    ).toBeTruthy();
  });
});
