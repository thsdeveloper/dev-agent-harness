// Dev Agent Harness - Main Entry Point
// Uses Claude Code CLI as backend (no API costs!)

export { ClaudeCodeClient, isClaudeCodeAvailable } from './core/claude-code-client.js';
export { ContextBuilder } from './core/context-builder.js';
export { InitializerAgent } from './agents/initializer.js';
export { CodingAgent } from './agents/coding-agent.js';
export {
  runAgentQuery,
  isAuthConfigured,
  getAuthMethod,
  buildMCPServers,
  DEFAULT_MCP_SERVERS,
  type MCPServerConfig,
  type MCPServerStdio,
  type MCPServerHttp,
  type MCPBuildOptions,
  type AgentQueryOptions,
  type AgentQueryResult,
} from './core/agent-sdk-client.js';
export {
  INITIALIZER_SYSTEM_PROMPT,
  buildInitializerPrompt,
} from './prompts/initializer.js';
export {
  CODING_AGENT_SYSTEM_PROMPT,
  buildCodingAgentContext,
} from './prompts/coding-agent.js';
export * from './types/index.js';
