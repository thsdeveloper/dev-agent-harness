import { join } from 'node:path';
import chalk from 'chalk';
import { runAgentQuery } from '../core/agent-sdk-client.js';
import { ContextBuilder } from '../core/context-builder.js';
import {
  FEATURE_ATOMIZER_SYSTEM_PROMPT,
  buildFeatureAtomizerContext,
} from '../prompts/feature-atomizer.js';
import type {
  AgentConfig,
  Feature,
  FeatureType,
  FeatureList,
  TargetType,
} from '../types/index.js';

export interface FeatureAtomizerOptions {
  workspacePath: string;
  featureType: FeatureType;
  description: string;
  target?: TargetType | undefined;
  onOutput?: ((text: string) => void) | undefined;
  onProgress?: ((message: string) => void) | undefined;
}

export interface FeatureAtomizerResult {
  success: boolean;
  features?: Feature[];
  error?: string;
}

export class FeatureAtomizerAgent {
  private config: AgentConfig;

  constructor(config: AgentConfig) {
    this.config = config;
  }

  async atomizeFeature(
    options: FeatureAtomizerOptions
  ): Promise<FeatureAtomizerResult> {
    const { workspacePath, featureType, description, onOutput, onProgress } =
      options;

    console.log(chalk.cyan('\n[DEBUG] atomizeFeature called'));
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

      const userMessage = buildFeatureAtomizerContext(
        featureType,
        description,
        projectStructure,
        existingFeaturesJson,
        featureList.tech_stack || []
      );

      log('Atomizing feature with AI...');
      console.log(chalk.cyan('[DEBUG] About to call runAgentQuery...'));
      console.log(chalk.gray('  maxTurns: 20'));

      // Suppress streaming output
      let outputBuffer = '';
      const collectOutput = (text: string) => {
        outputBuffer += text;
        if (onOutput) {
          onOutput('.');
        }
      };

      // Call AI to atomize feature
      console.log(chalk.cyan('[DEBUG] Calling runAgentQuery now...'));
      const result = await runAgentQuery({
        prompt: userMessage,
        systemPrompt: FEATURE_ATOMIZER_SYSTEM_PROMPT,
        workingDirectory: workspacePath,
        maxTurns: 20,
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
      const debugPath = join(workspacePath, '.harness-atomizer-debug.txt');
      console.log(chalk.gray('  debugPath:'), debugPath);
      const timestamp = new Date().toISOString();
      const debugContent = `=== Atomizer Debug Output (${timestamp}) ===
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
          error: `Failed to atomize feature. Error: ${result.error || 'unknown'}. Check ${debugPath}`,
        };
      }

      log('Parsing atomized features...');
      console.log(chalk.cyan('[DEBUG] About to parse features array...'));
      console.log(chalk.gray('  First 300 chars:'), result.output.substring(0, 300));

      // Parse the features array from output
      const features = this.parseFeatures(result.output);

      console.log(chalk.cyan('[DEBUG] Parsing result:'));
      console.log(chalk.gray('  features found:'), features?.length || 0);
      if (features && features.length > 0) {
        console.log(chalk.gray('  first feature.id:'), features[0]?.id);
        console.log(chalk.gray('  last feature.id:'), features[features.length - 1]?.id);
      }

      if (!features || features.length === 0) {
        console.log(chalk.red('[DEBUG] Failed to parse features array'));
        return {
          success: false,
          error: `Could not parse features from AI response. Output saved to ${debugPath} for debugging.`,
        };
      }

      // Validate all features
      log('Validating atomized features...');
      const invalidFeatures = features.filter((f) => !this.validateFeature(f));
      if (invalidFeatures.length > 0) {
        console.log(chalk.red('[DEBUG] Invalid features found:'), invalidFeatures.length);
        return {
          success: false,
          error: `${invalidFeatures.length} invalid feature(s) generated. Check structure.`,
        };
      }

      // Check for duplicate IDs
      const existingIds = new Set(featureList.features.map((f) => f.id));
      const duplicates = features.filter((f) => existingIds.has(f.id));
      if (duplicates.length > 0) {
        console.log(chalk.red('[DEBUG] Duplicate IDs found:'), duplicates.map(f => f.id));
        return {
          success: false,
          error: `Duplicate feature IDs found: ${duplicates.map((f) => f.id).join(', ')}`,
        };
      }

      log(`Adding ${features.length} features to feature_list.json...`);
      console.log(chalk.cyan(`[DEBUG] Adding ${features.length} features to list`));

      // Add all features to list
      featureList.features.push(...features);

      // Save updated feature list
      await contextBuilder.saveFeatureList(featureList);

      log(`Successfully added ${features.length} atomic features!`);
      console.log(chalk.green(`[DEBUG] Successfully added ${features.length} features`));

      return {
        success: true,
        features,
      };
    } catch (error) {
      console.log(chalk.red('[DEBUG] Caught exception in atomizeFeature:'));
      console.log(chalk.red('  error:'), error);
      console.log(
        chalk.red('  error message:'),
        error instanceof Error ? error.message : String(error)
      );
      console.log(chalk.red('  stack:'), error instanceof Error ? error.stack : 'no stack');
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private parseFeatures(output: string): Feature[] | null {
    // Strategy 1: Try to parse directly as array
    try {
      const features = JSON.parse(output.trim());
      if (Array.isArray(features) && features.every((f) => this.validateFeature(f))) {
        return features as Feature[];
      }
    } catch {
      // Continue to next strategy
    }

    // Strategy 2: Find JSON array in markdown code blocks
    const jsonMatch = output.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/);
    if (jsonMatch?.[1]) {
      try {
        const features = JSON.parse(jsonMatch[1].trim());
        if (Array.isArray(features) && features.every((f) => this.validateFeature(f))) {
          return features as Feature[];
        }
      } catch {
        // Continue
      }
    }

    // Strategy 3: Find array bracket matching
    const arrayStart = output.indexOf('[');
    if (arrayStart !== -1) {
      let bracketCount = 0;
      let arrayEnd = -1;

      for (let i = arrayStart; i < output.length; i++) {
        if (output[i] === '[') bracketCount++;
        if (output[i] === ']') {
          bracketCount--;
          if (bracketCount === 0) {
            arrayEnd = i + 1;
            break;
          }
        }
      }

      if (arrayEnd !== -1) {
        const jsonStr = output.substring(arrayStart, arrayEnd);
        try {
          const features = JSON.parse(jsonStr);
          if (Array.isArray(features) && features.every((f) => this.validateFeature(f))) {
            return features as Feature[];
          }
        } catch {
          // Continue
        }
      }
    }

    // Strategy 4: Look for array pattern with multiple objects
    const arrayPattern = /\[\s*\{[\s\S]*?"id"\s*:[\s\S]*?\}\s*(?:,\s*\{[\s\S]*?"id"\s*:[\s\S]*?\}\s*)*\]/;
    const arrayMatch = output.match(arrayPattern);
    if (arrayMatch) {
      try {
        const features = JSON.parse(arrayMatch[0]);
        if (Array.isArray(features) && features.every((f) => this.validateFeature(f))) {
          return features as Feature[];
        }
      } catch {
        // Failed
      }
    }

    return null;
  }

  private validateFeature(feature: any): boolean {
    return !!(
      feature &&
      typeof feature === 'object' &&
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
