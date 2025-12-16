import { runAgentQuery, buildMCPServers } from '../core/agent-sdk-client.js';
import { ContextBuilder } from '../core/context-builder.js';
import {
  CODING_AGENT_SYSTEM_PROMPT,
  buildCodingAgentContext,
  getSystemPromptForType,
} from '../prompts/coding-agent.js';
import type {
  AgentConfig,
  SessionResult,
} from '../types/index.js';

export interface CodingAgentOptions {
  workspacePath: string;
  onOutput?: ((text: string) => void) | undefined;
  onProgress?: ((message: string) => void) | undefined;
  maxTurns?: number | undefined;
  /** Supabase project ref for MCP (overrides env var) */
  supabaseProjectRef?: string | undefined;
}

export class CodingAgent {
  private config: AgentConfig;

  constructor(config: AgentConfig) {
    this.config = config;
  }

  async runSession(options: CodingAgentOptions): Promise<SessionResult> {
    const {
      workspacePath,
      onOutput,
      onProgress,
      maxTurns = 50,
      supabaseProjectRef,
    } = options;

    const log = (msg: string) => {
      if (onProgress) onProgress(msg);
    };

    const contextBuilder = new ContextBuilder(workspacePath);

    // 1. Build session context
    log('Building session context...');
    const sessionContext = await contextBuilder.buildSessionContext();

    if (!sessionContext) {
      return {
        success: false,
        featureId: '',
        error: 'No pending features found. All features may be complete.',
        progressEntry: '',
      };
    }

    const { feature, progressLog, gitLog, projectStructure } = sessionContext;
    log(`Working on feature: ${feature.id} - ${feature.title}`);

    // 2. Build user message with context
    const userMessage = buildCodingAgentContext(
      feature,
      progressLog,
      gitLog,
      projectStructure
    );

    // 3. Run Claude Agent SDK
    // The SDK provides all tools for file editing, bash, etc.
    log('Starting Claude Agent SDK session...');

    try {
      const queryOptions: Parameters<typeof runAgentQuery>[0] = {
        prompt: userMessage,
        systemPrompt: getSystemPromptForType(feature.type),
        workingDirectory: workspacePath,
        maxTurns,
        mcpServers: buildMCPServers({ supabaseProjectRef }),
      };
      if (onOutput) queryOptions.onText = onOutput;

      const result = await runAgentQuery(queryOptions);

      if (!result.success) {
        return {
          success: false,
          featureId: feature.id,
          error: result.error || 'Claude Agent SDK session failed',
          progressEntry: `[${new Date().toISOString()}] [${feature.id}] ${feature.title} - ERROR`,
        };
      }

      // 4. Check if feature was marked as complete
      // The agent should have updated feature_list.json
      const featureList = await contextBuilder.loadFeatureList();
      const updatedFeature = featureList?.features.find(
        (f) => f.id === feature.id
      );
      const success = updatedFeature?.passes === true;

      // 5. Get commit hash if any
      let commitHash: string | undefined;
      try {
        const { exec } = await import('node:child_process');
        const { promisify } = await import('node:util');
        const execAsync = promisify(exec);
        const { stdout } = await execAsync('git rev-parse --short HEAD', {
          cwd: workspacePath,
        });
        commitHash = stdout.trim();
      } catch {
        // No commit made
      }

      const progressEntry = success
        ? `[${new Date().toISOString()}] [${feature.id}] ${feature.title} - COMPLETED`
        : `[${new Date().toISOString()}] [${feature.id}] ${feature.title} - INCOMPLETE`;

      return {
        success,
        featureId: feature.id,
        commitHash,
        progressEntry,
      };
    } catch (error) {
      return {
        success: false,
        featureId: feature.id,
        error: error instanceof Error ? error.message : String(error),
        progressEntry: `[${new Date().toISOString()}] [${feature.id}] ${feature.title} - ERROR: ${error}`,
      };
    }
  }
}
