import { join } from 'node:path';
import chalk from 'chalk';
import { runAgentQuery } from '../core/agent-sdk-client.js';
import { ContextBuilder } from '../core/context-builder.js';
import {
  FEATURE_ADDER_SYSTEM_PROMPT,
  buildFeatureAdderContext,
} from '../prompts/feature-adder.js';
import type {
  AgentConfig,
  Feature,
  FeatureType,
  FeatureList,
  TargetType,
} from '../types/index.js';

export interface FeatureAdderOptions {
  workspacePath: string;
  featureType: FeatureType;
  description: string;
  relatedFiles?: string | undefined;
  target?: TargetType | undefined;
  onOutput?: ((text: string) => void) | undefined;
  onProgress?: ((message: string) => void) | undefined;
}

export interface FeatureAdderResult {
  success: boolean;
  feature?: Feature;
  error?: string;
}

export class FeatureAdderAgent {
  private config: AgentConfig;

  constructor(config: AgentConfig) {
    this.config = config;
  }

  async addFeature(options: FeatureAdderOptions): Promise<FeatureAdderResult> {
    const {
      workspacePath,
      featureType,
      description,
      relatedFiles,
      onOutput,
      onProgress,
    } = options;

    console.log(chalk.cyan('\n[DEBUG] addFeature called'));
    console.log(chalk.gray('  workspacePath:'), workspacePath);
    console.log(chalk.gray('  featureType:'), featureType);
    console.log(chalk.gray('  description:'), description);

    const log = (msg: string) => {
      if (onProgress) onProgress(msg);
    };

    try {
      log('Loading project context...');
      console.log(chalk.cyan('[DEBUG] Creating ContextBuilder...'));
      const contextBuilder = new ContextBuilder(workspacePath);

      // Load existing features
      const featureList = await contextBuilder.loadFeatureList();
      if (!featureList) {
        return {
          success: false,
          error: 'Could not load feature_list.json. Is this a valid project?',
        };
      }

      // Get project structure
      log('Analyzing project structure...');
      const projectStructure = await contextBuilder.getProjectStructure(3);

      // Build context for AI
      const existingFeaturesJson = JSON.stringify(
        featureList.features.map((f) => ({
          id: f.id,
          type: f.type || 'feature',
          title: f.title,
        })),
        null,
        2
      );

      const userMessage = buildFeatureAdderContext(
        featureType,
        description,
        projectStructure,
        existingFeaturesJson,
        relatedFiles
      );

      log('Generating feature with AI...');
      console.log(chalk.cyan('[DEBUG] About to call runAgentQuery...'));
      console.log(chalk.gray('  maxTurns: 15'));
      console.log(chalk.gray('  workingDirectory:'), workspacePath);

      // Suppress streaming output for feature generation to avoid confusion
      // We'll show a simple progress instead
      let outputBuffer = '';
      const collectOutput = (text: string) => {
        outputBuffer += text;
        // Show progress dots instead of full output
        if (onOutput) {
          onOutput('.');
        }
      };

      // Call AI to generate feature
      console.log(chalk.cyan('[DEBUG] Calling runAgentQuery now...'));
      const result = await runAgentQuery({
        prompt: userMessage,
        systemPrompt: FEATURE_ADDER_SYSTEM_PROMPT,
        workingDirectory: workspacePath,
        maxTurns: 15, // More turns to allow complete generation
        onText: collectOutput,
      });

      console.log(chalk.cyan('[DEBUG] runAgentQuery returned!'));
      console.log(chalk.gray('  success:'), result.success);
      console.log(chalk.gray('  hasOutput:'), !!result.output);
      console.log(chalk.gray('  outputLength:'), result.output?.length || 0);
      console.log(chalk.gray('  error:'), result.error || 'none');

      // Always save debug output
      console.log(chalk.cyan('[DEBUG] Preparing to write debug file...'));
      const { writeFile } = await import('node:fs/promises');
      const debugPath = join(workspacePath, '.harness-debug-output.txt');
      console.log(chalk.gray('  debugPath:'), debugPath);
      const timestamp = new Date().toISOString();
      const debugContent = `=== Debug Output (${timestamp}) ===
SUCCESS: ${result.success}
ERROR: ${result.error || 'none'}
OUTPUT LENGTH: ${result.output?.length || 0}

OUTPUT:
${result.output || '(empty)'}

=== End of Output ===`;

      try {
        console.log(chalk.cyan('[DEBUG] Writing debug file...'));
        await writeFile(debugPath, debugContent, 'utf-8');
        console.log(chalk.green('[DEBUG] Debug file written successfully!'));
        log(`Debug saved to ${debugPath}`);
      } catch (err) {
        console.log(chalk.red('[DEBUG] Failed to write debug file:'), err);
        log(`Failed to save debug: ${err}`);
      }

      if (!result.success || !result.output) {
        return {
          success: false,
          error: `Failed to generate feature. Error: ${result.error || 'unknown'}. Check ${debugPath}`,
        };
      }

      log('Parsing generated feature...');
      console.log(chalk.cyan('[DEBUG] About to parse feature from output...'));
      console.log(chalk.gray('  First 200 chars:'), result.output.substring(0, 200));

      // Parse the feature from output
      const feature = this.parseFeature(result.output);

      console.log(chalk.cyan('[DEBUG] Parsing result:'));
      console.log(chalk.gray('  feature found:'), !!feature);
      if (feature) {
        console.log(chalk.gray('  feature.id:'), feature.id);
        console.log(chalk.gray('  feature.title:'), feature.title);
      }

      if (!feature) {
        console.log(chalk.red('[DEBUG] Failed to parse feature from output'));
        // Always save output to a temp file for debugging
        const { writeFile } = await import('node:fs/promises');
        const debugPath = join(workspacePath, '.harness-debug-output.txt');
        const timestamp = new Date().toISOString();
        const debugContent = `=== Debug Output (${timestamp}) ===\n\n${result.output}\n\n=== End of Output ===`;

        try {
          await writeFile(debugPath, debugContent, 'utf-8');
          console.log(chalk.yellow(`\n⚠ Debug: Output saved to ${debugPath}`));
          console.log(chalk.gray('First 200 chars of output:'));
          console.log(chalk.gray(result.output.substring(0, 200) + '...'));
        } catch (err) {
          console.log(chalk.red(`Failed to save debug output: ${err}`));
        }

        return {
          success: false,
          error: `Could not parse feature from AI response. Output saved to ${debugPath} for debugging.`,
        };
      }

      // Validate feature
      if (!this.validateFeature(feature)) {
        return {
          success: false,
          error: 'Generated feature is invalid or incomplete',
        };
      }

      // Check for duplicate ID
      if (featureList.features.some((f) => f.id === feature.id)) {
        return {
          success: false,
          error: `Feature ID ${feature.id} already exists. Please try again.`,
        };
      }

      log('Adding feature to feature_list.json...');

      // Add feature to list
      featureList.features.push(feature);

      // Save updated feature list
      await contextBuilder.saveFeatureList(featureList);

      log('Feature added successfully!');

      return {
        success: true,
        feature,
      };
    } catch (error) {
      console.log(chalk.red('[DEBUG] Caught exception in addFeature:'));
      console.log(chalk.red('  error:'), error);
      console.log(chalk.red('  error message:'), error instanceof Error ? error.message : String(error));
      console.log(chalk.red('  stack:'), error instanceof Error ? error.stack : 'no stack');
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private parseFeature(output: string): Feature | null {
    // Strategy 1: Try to parse directly
    try {
      const feature = JSON.parse(output.trim());
      if (this.validateFeature(feature)) {
        return feature as Feature;
      }
    } catch {
      // Continue to next strategy
    }

    // Strategy 2: Find JSON in markdown code blocks
    const jsonMatch = output.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch?.[1]) {
      try {
        const feature = JSON.parse(jsonMatch[1].trim());
        if (this.validateFeature(feature)) {
          return feature as Feature;
        }
      } catch {
        // Continue
      }
    }

    // Strategy 3: Find object that looks like a feature (has "id", "title", etc.)
    // Extract everything from first { with "id" to matching }
    const featurePattern = /\{[^}]*"id"\s*:\s*"[^"]*"[^}]*"title"\s*:\s*"[^"]*"[\s\S]*?\}/;
    const featureMatch = output.match(featurePattern);
    if (featureMatch) {
      // Found a potential feature, now extract the complete object
      const startIndex = output.indexOf(featureMatch[0]);
      let braceCount = 0;
      let endIndex = startIndex;

      for (let i = startIndex; i < output.length; i++) {
        if (output[i] === '{') braceCount++;
        if (output[i] === '}') {
          braceCount--;
          if (braceCount === 0) {
            endIndex = i + 1;
            break;
          }
        }
      }

      const jsonStr = output.substring(startIndex, endIndex);
      try {
        const feature = JSON.parse(jsonStr);
        if (this.validateFeature(feature)) {
          return feature as Feature;
        }
      } catch {
        // Continue
      }
    }

    // Strategy 4: Line-by-line brace matching for complete object
    const lines = output.split('\n');
    let braceCount = 0;
    let jsonStart = -1;
    let jsonEnd = -1;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;

      if (jsonStart === -1 && line.trim().startsWith('{')) {
        jsonStart = i;
        braceCount = 0;
      }

      if (jsonStart !== -1) {
        for (const char of line) {
          if (char === '{') braceCount++;
          if (char === '}') braceCount--;
        }

        if (braceCount === 0 && jsonStart !== -1) {
          jsonEnd = i;
          break;
        }
      }
    }

    if (jsonStart !== -1 && jsonEnd !== -1) {
      const jsonStr = lines.slice(jsonStart, jsonEnd + 1).join('\n');
      try {
        const feature = JSON.parse(jsonStr);
        if (this.validateFeature(feature)) {
          return feature as Feature;
        }
      } catch {
        // Continue
      }
    }

    // Strategy 5: Extract ALL objects and try each
    const allObjectsPattern = /\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g;
    const matches = output.match(allObjectsPattern);
    if (matches) {
      for (const match of matches) {
        try {
          const feature = JSON.parse(match);
          if (this.validateFeature(feature)) {
            return feature as Feature;
          }
        } catch {
          // Try next match
        }
      }
    }

    return null;
  }

  private validateFeature(feature: Feature): boolean {
    return !!(
      feature.id &&
      feature.title &&
      feature.description &&
      feature.acceptance_criteria &&
      Array.isArray(feature.acceptance_criteria) &&
      feature.acceptance_criteria.length > 0 &&
      typeof feature.passes === 'boolean'
    );
  }
}
