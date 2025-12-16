import { query } from '@anthropic-ai/claude-agent-sdk';
import type { SDKMessage, SDKAssistantMessage, SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';

/**
 * MCP Server configuration for stdio-based servers (local processes)
 */
export interface MCPServerStdio {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

/**
 * MCP Server configuration for HTTP-based servers (remote)
 */
export interface MCPServerHttp {
  type: 'http' | 'sse';
  url: string;
  headers?: Record<string, string>;
}

/**
 * Union type for all MCP server configurations
 */
export type MCPServerConfig = MCPServerStdio | MCPServerHttp;

export interface AgentQueryOptions {
  prompt: string;
  systemPrompt: string;
  workingDirectory: string;
  maxTurns?: number | undefined;
  onMessage?: ((message: SDKMessage) => void) | undefined;
  onText?: ((text: string) => void) | undefined;
  mcpServers?: Record<string, MCPServerConfig> | undefined;
}

export interface MCPBuildOptions {
  /** Supabase project ref (overrides SUPABASE_PROJECT_REF env var) */
  supabaseProjectRef?: string | undefined;
}

/**
 * Build MCP servers configuration based on available environment variables.
 * Includes shadcn/ui MCP always, and Supabase MCP if configured.
 *
 * @param options - Optional configuration to override env vars
 */
export function buildMCPServers(options?: MCPBuildOptions): Record<string, MCPServerConfig> {
  const servers: Record<string, MCPServerConfig> = {
    // shadcn/ui MCP - always available for UI components
    shadcn: {
      command: 'npx',
      args: ['shadcn@latest', 'mcp'],
    },
  };

  // Supabase MCP - only if access token is configured
  const supabaseToken = process.env['SUPABASE_ACCESS_TOKEN'];
  const supabaseProjectRef = options?.supabaseProjectRef || process.env['SUPABASE_PROJECT_REF'];

  // Debug logging
  if (options?.supabaseProjectRef) {
    console.log(`[MCP Config] Using Supabase project from CLI: ${options.supabaseProjectRef}`);
  } else if (process.env['SUPABASE_PROJECT_REF']) {
    console.log(`[MCP Config] Using Supabase project from ENV: ${process.env['SUPABASE_PROJECT_REF']}`);
  }

  if (supabaseToken) {
    const supabaseUrl = supabaseProjectRef
      ? `https://mcp.supabase.com/mcp?project_ref=${supabaseProjectRef}`
      : 'https://mcp.supabase.com/mcp';

    console.log(`[MCP Config] Supabase MCP URL: ${supabaseUrl}`);

    servers['supabase'] = {
      type: 'http',
      url: supabaseUrl,
      headers: {
        Authorization: `Bearer ${supabaseToken}`,
      },
    };
  }

  return servers;
}

/**
 * Default MCP servers configuration.
 * @deprecated Use buildMCPServers() for dynamic configuration based on env vars.
 */
export const DEFAULT_MCP_SERVERS: Record<string, MCPServerConfig> = {
  shadcn: {
    command: 'npx',
    args: ['shadcn@latest', 'mcp'],
  },
};

export interface AgentQueryResult {
  success: boolean;
  output: string;
  error?: string | undefined;
  totalCostUsd?: number | undefined;
  numTurns?: number | undefined;
}

/**
 * Run a Claude Agent SDK query with the given prompt and options.
 * Uses the official Claude Agent SDK for proper programmatic access.
 */
export async function runAgentQuery(options: AgentQueryOptions): Promise<AgentQueryResult> {
  const {
    prompt,
    systemPrompt,
    workingDirectory,
    maxTurns = 50,
    onMessage,
    onText,
    mcpServers = buildMCPServers(),
  } = options;

  let output = '';
  let success = false;
  let error: string | undefined;
  let totalCostUsd: number | undefined;
  let numTurns: number | undefined;

  try {
    const queryResult = query({
      prompt,
      options: {
        systemPrompt,
        cwd: workingDirectory,
        maxTurns,
        // Use Claude Code's default tools
        tools: { type: 'preset', preset: 'claude_code' },
        // Bypass permissions for autonomous operation
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        // MCP servers for extended capabilities (shadcn/ui, etc.)
        mcpServers,
      },
    });

    // Process streamed messages
    for await (const message of queryResult) {
      if (onMessage) {
        onMessage(message);
      }

      // Handle assistant messages (Claude's responses)
      if (message.type === 'assistant') {
        const assistantMsg = message as SDKAssistantMessage;
        for (const block of assistantMsg.message.content) {
          if (block.type === 'text') {
            output += block.text;
            if (onText) {
              onText(block.text);
            }
          }
        }
      }

      // Handle result messages (final outcome)
      if (message.type === 'result') {
        const resultMsg = message as SDKResultMessage;
        totalCostUsd = resultMsg.total_cost_usd;
        numTurns = resultMsg.num_turns;

        if (resultMsg.subtype === 'success') {
          success = true;
          if (resultMsg.result) {
            output = resultMsg.result;
          }
        } else {
          success = false;
          if ('errors' in resultMsg && resultMsg.errors) {
            error = resultMsg.errors.join('\n');
          }
        }
      }
    }

    const result: AgentQueryResult = {
      success,
      output,
    };
    if (error !== undefined) result.error = error;
    if (totalCostUsd !== undefined) result.totalCostUsd = totalCostUsd;
    if (numTurns !== undefined) result.numTurns = numTurns;
    return result;
  } catch (err) {
    return {
      success: false,
      output,
      error: err instanceof Error ? err.message : String(err),
    } as AgentQueryResult;
  }
}

/**
 * Check if authentication is configured (OAuth token or API key).
 * OAuth token is preferred for Claude Max subscription users (no API costs).
 */
export function isAuthConfigured(): boolean {
  return !!(
    process.env['CLAUDE_CODE_OAUTH_TOKEN'] ||
    process.env['ANTHROPIC_API_KEY']
  );
}

/**
 * Get the authentication method being used.
 */
export function getAuthMethod(): 'oauth' | 'api_key' | 'none' {
  if (process.env['CLAUDE_CODE_OAUTH_TOKEN']) return 'oauth';
  if (process.env['ANTHROPIC_API_KEY']) return 'api_key';
  return 'none';
}
