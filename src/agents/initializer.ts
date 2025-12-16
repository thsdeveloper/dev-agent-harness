import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { runAgentQuery, buildMCPServers } from '../core/agent-sdk-client.js';
import { ContextBuilder } from '../core/context-builder.js';
import {
  INITIALIZER_SYSTEM_PROMPT,
  buildInitializerPrompt,
} from '../prompts/initializer.js';
import type { FeatureList, AgentConfig } from '../types/index.js';

export interface InitializerOptions {
  projectName: string;
  description: string;
  techStack?: string[] | undefined;
  workspacePath: string;
  onProgress?: ((message: string) => void) | undefined;
  onOutput?: ((text: string) => void) | undefined;
  /** Supabase project ref for MCP (overrides env var) */
  supabaseProjectRef?: string | undefined;
}

export interface InitializerResult {
  success: boolean;
  featureList?: FeatureList | undefined;
  error?: string | undefined;
  totalCostUsd?: number | undefined;
}

export class InitializerAgent {
  private config: AgentConfig;

  constructor(config: AgentConfig) {
    this.config = config;
  }

  async initialize(options: InitializerOptions): Promise<InitializerResult> {
    const { projectName, description, techStack, workspacePath, onProgress, onOutput, supabaseProjectRef } = options;

    const log = (msg: string) => {
      if (onProgress) onProgress(msg);
    };

    try {
      // 1. Create workspace directory
      log('Creating workspace directory...');
      const projectPath = join(workspacePath, projectName);

      if (existsSync(projectPath)) {
        return {
          success: false,
          error: `Project directory already exists: ${projectPath}`,
        };
      }

      await mkdir(projectPath, { recursive: true });

      // 2. Generate feature list via Claude Agent SDK
      log('Generating feature list via Claude Agent SDK...');
      const userMessage = buildInitializerPrompt(description, techStack);

      const queryOptions: Parameters<typeof runAgentQuery>[0] = {
        prompt: userMessage,
        systemPrompt: INITIALIZER_SYSTEM_PROMPT,
        workingDirectory: projectPath,
        maxTurns: 10,
        // Initializer doesn't need MCPs, pass empty to avoid starting them
        mcpServers: {},
      };
      if (onOutput) queryOptions.onText = onOutput;

      const result = await runAgentQuery(queryOptions);

      if (!result.success) {
        return {
          success: false,
          error: result.error || 'Claude Agent SDK failed to generate feature list',
        };
      }

      // 3. Parse feature list from response
      log('Parsing feature list...');
      const featureList = this.parseFeatureList(result.output);

      if (!featureList) {
        return {
          success: false,
          error: 'Failed to parse feature list from Claude response',
        };
      }

      // Ensure project name matches
      featureList.project_name = projectName;

      // 4. Write feature_list.json
      log('Writing feature_list.json...');
      const featureListPath = join(projectPath, 'feature_list.json');
      await writeFile(
        featureListPath,
        JSON.stringify(featureList, null, 2),
        'utf-8'
      );

      // 5. Create empty progress.log
      log('Creating progress.log...');
      const progressLogPath = join(projectPath, 'progress.log');
      await writeFile(
        progressLogPath,
        `# Progress Log for ${projectName}\n# Created: ${new Date().toISOString()}\n`,
        'utf-8'
      );

      // 6. Initialize git
      log('Initializing git repository...');
      const contextBuilder = new ContextBuilder(projectPath);
      await contextBuilder.initializeGit();

      log('Project initialized successfully!');

      return {
        success: true,
        featureList,
        totalCostUsd: result.totalCostUsd,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private parseFeatureList(response: string): FeatureList | null {
    // Try to extract JSON from the response
    // The response should be pure JSON, but let's be robust

    // First, try parsing the whole response as JSON
    try {
      return JSON.parse(response.trim()) as FeatureList;
    } catch {
      // Try to find JSON in the response
    }

    // Try to find JSON block in markdown
    const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch?.[1]) {
      try {
        return JSON.parse(jsonMatch[1].trim()) as FeatureList;
      } catch {
        // Continue trying
      }
    }

    // Try to find any JSON object in the response
    const objectMatch = response.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      try {
        return JSON.parse(objectMatch[0]) as FeatureList;
      } catch {
        // Failed to parse
      }
    }

    return null;
  }
}
