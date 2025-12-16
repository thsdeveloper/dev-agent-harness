#!/usr/bin/env node

// Load .env file first
import 'dotenv/config';

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { createInterface } from 'node:readline';
import { join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { InitializerAgent } from './agents/initializer.js';
import { CodingAgent } from './agents/coding-agent.js';
import { FeatureAdderAgent } from './agents/feature-adder.js';
import { FeatureAtomizerAgent } from './agents/feature-atomizer.js';
import { ContextBuilder } from './core/context-builder.js';
import { isAuthConfigured, getAuthMethod } from './core/agent-sdk-client.js';
import { DEFAULT_AGENT_CONFIG, type FeatureType, type FeatureList, type TargetType } from './types/index.js';
import { createOutputFormatter } from './core/output-formatter.js';

const program = new Command();

// Helper to get workspace path
function getWorkspacePath(): string {
  return resolve(process.cwd(), 'workspace');
}

// Helper for user prompts
async function askUser(question: string): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

// Check authentication (OAuth token for Max subscription, or API key)
function checkAuth(): boolean {
  if (!isAuthConfigured()) {
    console.log(chalk.red('✗ Autenticação não encontrada!\n'));
    console.log(chalk.cyan('Opção 1 - Claude Max (Recomendado - sem custos adicionais):'));
    console.log(chalk.gray('  # Gerar token (uma vez):'));
    console.log(chalk.gray('  claude setup-token'));
    console.log(chalk.gray('  # Exportar:'));
    console.log(chalk.gray('  export CLAUDE_CODE_OAUTH_TOKEN="<token-gerado>"'));
    console.log(chalk.cyan('\nOpção 2 - API Key (custos por uso):'));
    console.log(chalk.gray('  export ANTHROPIC_API_KEY="sua-api-key"'));
    return false;
  }

  const method = getAuthMethod();
  if (method === 'oauth') {
    console.log(chalk.green('✓ Usando Claude Max subscription (sem custos de API)'));
  } else {
    console.log(chalk.yellow('! Usando API Key (custos aplicam)'));
  }
  return true;
}

/**
 * Shared handler for run commands (supports type filtering)
 */
async function runCommandHandler(
  options: { project?: string; maxTurns?: string; supabaseRef?: string },
  featureType?: FeatureType
): Promise<void> {
  if (!checkAuth()) {
    process.exit(1);
  }

  const projectPath = options.project ? resolve(options.project) : process.cwd();
  const maxTurns = parseInt(options.maxTurns || '50', 10);

  // Validate feature_list.json
  const featureListPath = join(projectPath, 'feature_list.json');
  if (!existsSync(featureListPath)) {
    console.log(chalk.red('✗ No feature_list.json found in project.'));
    console.log(chalk.gray(`  Looked in: ${featureListPath}`));
    console.log(
      chalk.cyan('\n  Run "harness init <name>" to create a new project first.')
    );
    process.exit(1);
  }

  // Load next feature (filtered by type if specified)
  const contextBuilder = new ContextBuilder(projectPath);
  const feature = featureType
    ? await contextBuilder.getNextFeatureByType(featureType)
    : await contextBuilder.getNextFeature();

  if (!feature) {
    const typeMsg = featureType ? ` of type "${featureType}"` : '';
    console.log(
      chalk.green(`✓ No pending features${typeMsg} found. All features may be complete!`)
    );
    console.log(chalk.cyan('\n  Run "harness status" to see project status.'));
    process.exit(0);
  }

  console.log(chalk.cyan('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log(
    chalk.cyan.bold(`  Starting session for: ${feature.id} - ${feature.title}`)
  );
  if (feature.type) {
    console.log(chalk.gray(`  Type: ${feature.type}`));
  }
  console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));

  const formatter = createOutputFormatter();
  const agent = new CodingAgent(DEFAULT_AGENT_CONFIG);

  const result = await agent.runSession({
    workspacePath: projectPath,
    maxTurns,
    supabaseProjectRef: options.supabaseRef,
    onOutput: (text) => {
      const formatted = formatter.formatText(text);
      process.stdout.write(formatted);
    },
    onProgress: (msg) => {
      console.log(chalk.gray(`\n[Progress] ${msg}`));
    },
  });

  console.log('\n');
  console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));

  if (result.success) {
    console.log(chalk.green.bold(`✓ Feature ${result.featureId} completed successfully!`));
    if (result.commitHash) {
      console.log(chalk.gray(`  Commit: ${result.commitHash}`));
    }
  } else {
    console.log(chalk.yellow.bold(`⚠ Feature ${result.featureId} incomplete`));
    if (result.error) {
      console.log(chalk.red(`  Error: ${result.error}`));
    }
  }

  // Show progress
  const stats = await contextBuilder.getProgressStats();
  console.log(
    chalk.gray(
      `\n  Progress: ${stats.completed}/${stats.total} features (${stats.percentage}%)`
    )
  );
  console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));
}

// ============================================
// INIT Command
// ============================================
program
  .command('init <name>')
  .description('Initialize a new project with AI-generated feature list')
  .option('-d, --description <desc>', 'Project description')
  .option('-t, --tech <stack>', 'Comma-separated tech stack')
  .action(async (name: string, options: { description?: string; tech?: string }) => {
    if (!checkAuth()) {
      process.exit(1);
    }

    const spinner = ora('Initializing project...').start();

    try {
      // Get description interactively if not provided
      let description = options.description;
      if (!description) {
        spinner.stop();
        description = await askUser(
          chalk.cyan('Enter project description: ')
        );
        spinner.start();
      }

      const techStack = options.tech?.split(',').map((t) => t.trim());
      const workspacePath = getWorkspacePath();

      const agent = new InitializerAgent(DEFAULT_AGENT_CONFIG);
      const formatter = createOutputFormatter();

      spinner.stop();
      console.log(chalk.cyan('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
      console.log(chalk.cyan.bold('  Claude Agent SDK: Generating feature list...'));
      console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));

      const result = await agent.initialize({
        projectName: name,
        description,
        techStack,
        workspacePath,
        onProgress: (msg) => {
          console.log(chalk.gray(`[Progress] ${msg}`));
        },
        onOutput: (text) => {
          const formatted = formatter.formatText(text);
          process.stdout.write(formatted);
        },
      });

      if (result.success && result.featureList) {
        console.log(chalk.green('\n✓ Project initialized successfully!'));
        console.log(chalk.gray(`  Location: ${join(workspacePath, name)}`));
        console.log(
          chalk.gray(
            `  Features: ${result.featureList.features.length} features generated`
          )
        );
        console.log(
          chalk.gray(`  Tech stack: ${result.featureList.tech_stack?.join(', ') || 'Not specified'}`)
        );
        if (result.totalCostUsd) {
          console.log(chalk.gray(`  Cost: $${result.totalCostUsd.toFixed(4)}`));
        }

        console.log(chalk.cyan('\nGenerated features:'));
        for (const feature of result.featureList.features) {
          console.log(chalk.gray(`  ${feature.id}: ${feature.title}`));
        }

        console.log(
          chalk.cyan(`\nNext steps:\n  cd workspace/${name}\n  harness run`)
        );
      } else {
        console.log(chalk.red(`\n✗ Failed to initialize: ${result.error}`));
        process.exit(1);
      }
    } catch (error) {
      spinner.stop();
      console.log(
        chalk.red(
          `\n✗ Error: ${error instanceof Error ? error.message : error}`
        )
      );
      process.exit(1);
    }
  });

// ============================================
// RUN Command
// ============================================
program
  .command('run')
  .description('Run a single coding session to implement the next feature')
  .option('-p, --project <path>', 'Project path (defaults to current directory)')
  .option('-m, --max-turns <n>', 'Maximum turns for Claude', '50')
  .option('-s, --supabase-ref <ref>', 'Supabase project ref (overrides SUPABASE_PROJECT_REF env)')
  .action(async (options) => {
    await runCommandHandler(options);
  });

// ============================================
// REFACTOR Command
// ============================================
program
  .command('refactor')
  .description('Run a refactoring session (processes next refactoring feature)')
  .option('-p, --project <path>', 'Project path (defaults to current directory)')
  .option('-m, --max-turns <n>', 'Maximum turns for Claude', '50')
  .option('-s, --supabase-ref <ref>', 'Supabase project ref (overrides SUPABASE_PROJECT_REF env)')
  .action(async (options) => {
    await runCommandHandler(options, 'refactoring');
  });

// ============================================
// FIX Command
// ============================================
program
  .command('fix')
  .description('Run a bugfix session (processes next bugfix feature)')
  .option('-p, --project <path>', 'Project path (defaults to current directory)')
  .option('-m, --max-turns <n>', 'Maximum turns for Claude', '50')
  .option('-s, --supabase-ref <ref>', 'Supabase project ref (overrides SUPABASE_PROJECT_REF env)')
  .action(async (options) => {
    await runCommandHandler(options, 'bugfix');
  });

// ============================================
// IMPROVE Command
// ============================================
program
  .command('improve')
  .description('Run an improvement session (processes next improvement feature)')
  .option('-p, --project <path>', 'Project path (defaults to current directory)')
  .option('-m, --max-turns <n>', 'Maximum turns for Claude', '50')
  .option('-s, --supabase-ref <ref>', 'Supabase project ref (overrides SUPABASE_PROJECT_REF env)')
  .action(async (options) => {
    await runCommandHandler(options, 'improvement');
  });

// ============================================
// DOCS Command
// ============================================
program
  .command('docs')
  .description('Run a documentation session (processes next docs feature)')
  .option('-p, --project <path>', 'Project path (defaults to current directory)')
  .option('-m, --max-turns <n>', 'Maximum turns for Claude', '50')
  .option('-s, --supabase-ref <ref>', 'Supabase project ref (overrides SUPABASE_PROJECT_REF env)')
  .action(async (options) => {
    await runCommandHandler(options, 'docs');
  });

// Valid targets for monorepo support
const VALID_TARGETS: TargetType[] = ['web', 'mobile', 'shared', 'full', 'backend', 'api'];

// ============================================
// Helper for ADD commands
// ============================================
async function addFeatureHandler(
  description: string,
  featureType: FeatureType,
  options: { project?: string; file?: string; atomize?: boolean; target?: string }
): Promise<void> {
  // Validate target if provided
  const target = options.target as TargetType | undefined;
  if (target && !VALID_TARGETS.includes(target)) {
    console.log(chalk.red(`✗ Invalid target: ${target}`));
    console.log(chalk.gray(`  Valid targets: ${VALID_TARGETS.join(', ')}`));
    process.exit(1);
  }

  // If --atomize flag is set, use atomizeFeatureHandler instead
  if (options.atomize) {
    return await atomizeFeatureHandler(description, featureType, { ...options, target });
  }

  if (!checkAuth()) {
    process.exit(1);
  }

  if (!description || description.trim().length === 0) {
    console.log(chalk.red('✗ Description is required'));
    console.log(chalk.gray('  Usage: harness add-bug "Description of the bug"'));
    process.exit(1);
  }

  const projectPath = options.project ? resolve(options.project) : process.cwd();

  // Check if we're in a valid project
  const featureListPath = join(projectPath, 'feature_list.json');
  if (!existsSync(featureListPath)) {
    console.log(chalk.red('✗ No feature_list.json found in project.'));
    console.log(chalk.gray(`  Looked in: ${featureListPath}`));
    console.log(
      chalk.cyan('\n  Run "harness init <name>" to create a new project first.')
    );
    process.exit(1);
  }

  const targetLabel = target ? ` [${target.toUpperCase()}]` : '';
  console.log(chalk.cyan('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log(chalk.cyan.bold(`  Adding ${featureType} feature...${targetLabel}`));
  console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));

  const agent = new FeatureAdderAgent(DEFAULT_AGENT_CONFIG);
  const formatter = createOutputFormatter();

  // Prepend target to description if specified
  const fullDescription = target
    ? `[${target.toUpperCase()}] ${description}`
    : description;

  const result = await agent.addFeature({
    workspacePath: projectPath,
    featureType,
    description: fullDescription,
    relatedFiles: options.file,
    target,
    onOutput: (text) => {
      const formatted = formatter.formatText(text);
      process.stdout.write(formatted);
    },
    onProgress: (msg) => {
      console.log(chalk.gray(`[Progress] ${msg}`));
    },
  });

  console.log('\n');
  console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));

  if (result.success && result.feature) {
    console.log(chalk.green.bold('✓ Feature added successfully!'));
    console.log(chalk.gray(`  ID: ${result.feature.id}`));
    console.log(chalk.gray(`  Title: ${result.feature.title}`));
    console.log(chalk.gray(`  Type: ${result.feature.type || 'feature'}`));
    console.log(
      chalk.cyan(
        `\n  Run "harness ${featureType === 'bugfix' ? 'fix' : featureType === 'refactoring' ? 'refactor' : featureType === 'improvement' ? 'improve' : featureType === 'docs' ? 'docs' : 'run'}" to implement this feature.`
      )
    );
  } else {
    console.log(chalk.red.bold('✗ Failed to add feature'));
    if (result.error) {
      console.log(chalk.red(`  Error: ${result.error}`));
    }
    process.exit(1);
  }

  console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));
}

// ============================================
// Helper for ADD-EPIC/ATOMIZE commands
// ============================================
async function atomizeFeatureHandler(
  description: string,
  featureType: FeatureType,
  options: { project?: string; target?: TargetType | undefined }
): Promise<void> {
  if (!checkAuth()) {
    process.exit(1);
  }

  if (!description || description.trim().length === 0) {
    console.log(chalk.red('✗ Description is required'));
    console.log(chalk.gray('  Usage: harness add-epic "Description of complex feature"'));
    process.exit(1);
  }

  const projectPath = options.project ? resolve(options.project) : process.cwd();
  const target = options.target;

  // Check if we're in a valid project
  const featureListPath = join(projectPath, 'feature_list.json');
  if (!existsSync(featureListPath)) {
    console.log(chalk.red('✗ No feature_list.json found in project.'));
    console.log(chalk.gray(`  Looked in: ${featureListPath}`));
    console.log(
      chalk.cyan('\n  Run "harness init <name>" to create a new project first.')
    );
    process.exit(1);
  }

  const targetLabel = target ? ` [${target.toUpperCase()}]` : '';
  console.log(chalk.cyan('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log(chalk.cyan.bold(`  Atomizing ${featureType} into multiple features...${targetLabel}`));
  console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));
  console.log(chalk.gray(`Complex feature: ${description}`));
  if (target) {
    console.log(chalk.gray(`Target: ${target}`));
  }
  console.log(chalk.gray('This will be broken down into 3-10 atomic, executable features.\n'));

  const agent = new FeatureAtomizerAgent(DEFAULT_AGENT_CONFIG);
  const formatter = createOutputFormatter();

  // Prepend target to description if specified
  const fullDescription = target
    ? `[${target.toUpperCase()}] ${description}`
    : description;

  const result = await agent.atomizeFeature({
    workspacePath: projectPath,
    featureType,
    description: fullDescription,
    target,
    onOutput: (text) => {
      const formatted = formatter.formatText(text);
      process.stdout.write(formatted);
    },
    onProgress: (msg) => {
      console.log(chalk.gray(`[Progress] ${msg}`));
    },
  });

  console.log('\n');
  console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));

  if (result.success && result.features) {
    console.log(chalk.green.bold(`✓ Successfully atomized into ${result.features.length} features!`));
    console.log(chalk.gray('\nAdded features:'));
    result.features.forEach((feature, index) => {
      console.log(chalk.gray(`  ${index + 1}. [${feature.id}] ${feature.title}`));
    });
    console.log(
      chalk.cyan(
        `\n  Run "harness ${featureType === 'bugfix' ? 'fix' : featureType === 'refactoring' ? 'refactor' : featureType === 'improvement' ? 'improve' : featureType === 'docs' ? 'docs' : 'run'}" to start implementing these features.`
      )
    );
  } else {
    console.log(chalk.red.bold('✗ Failed to atomize feature'));
    if (result.error) {
      console.log(chalk.red(`  Error: ${result.error}`));
    }
    process.exit(1);
  }

  console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));
}

// ============================================
// ADD-BUG Command
// ============================================
program
  .command('add-bug <description>')
  .description('Add a bugfix feature to the project')
  .option('-p, --project <path>', 'Project path (defaults to current directory)')
  .option('-f, --file <path>', 'Related file path (optional)')
  .option('-a, --atomize', 'Atomize complex bug into multiple features')
  .option('-t, --target <target>', 'Target: web, mobile, shared, full, backend, api')
  .action(async (description: string, options) => {
    await addFeatureHandler(description, 'bugfix', options);
  });

// ============================================
// ADD-REFACTOR Command
// ============================================
program
  .command('add-refactor <description>')
  .description('Add a refactoring feature to the project')
  .option('-p, --project <path>', 'Project path (defaults to current directory)')
  .option('-f, --file <path>', 'Related file path (optional)')
  .option('-a, --atomize', 'Atomize complex refactoring into multiple features')
  .option('-t, --target <target>', 'Target: web, mobile, shared, full, backend, api')
  .action(async (description: string, options) => {
    await addFeatureHandler(description, 'refactoring', options);
  });

// ============================================
// ADD-IMPROVEMENT Command
// ============================================
program
  .command('add-improvement <description>')
  .description('Add an improvement feature to the project')
  .option('-p, --project <path>', 'Project path (defaults to current directory)')
  .option('-f, --file <path>', 'Related file path (optional)')
  .option('-a, --atomize', 'Atomize complex improvement into multiple features')
  .option('-t, --target <target>', 'Target: web, mobile, shared, full, backend, api')
  .action(async (description: string, options) => {
    await addFeatureHandler(description, 'improvement', options);
  });

// ============================================
// ADD-DOCS Command
// ============================================
program
  .command('add-docs <description>')
  .description('Add a documentation feature to the project')
  .option('-p, --project <path>', 'Project path (defaults to current directory)')
  .option('-f, --file <path>', 'Related file path (optional)')
  .option('-a, --atomize', 'Atomize complex documentation into multiple features')
  .option('-t, --target <target>', 'Target: web, mobile, shared, full, backend, api')
  .action(async (description: string, options) => {
    await addFeatureHandler(description, 'docs', options);
  });

// ============================================
// ADD Command (generic)
// ============================================
program
  .command('add <description>')
  .description('Add a feature to the project (interactive type selection)')
  .option('-p, --project <path>', 'Project path (defaults to current directory)')
  .option('-f, --file <path>', 'Related file path (optional)')
  .option(
    '--type <type>',
    'Feature type (bugfix, refactoring, improvement, docs, feature)'
  )
  .option('-a, --atomize', 'Atomize complex feature into multiple features')
  .option('-t, --target <target>', 'Target: web, mobile, shared, full, backend, api')
  .action(async (description: string, options) => {
    let featureType = options.type as FeatureType | undefined;

    // If type not provided, ask interactively
    if (!featureType) {
      console.log(chalk.cyan('\nSelect feature type:'));
      console.log(chalk.gray('  1. bugfix'));
      console.log(chalk.gray('  2. refactoring'));
      console.log(chalk.gray('  3. improvement'));
      console.log(chalk.gray('  4. docs'));
      console.log(chalk.gray('  5. feature'));

      const answer = await askUser(chalk.cyan('\nEnter number (1-5): '));
      const typeMap: Record<string, FeatureType> = {
        '1': 'bugfix',
        '2': 'refactoring',
        '3': 'improvement',
        '4': 'docs',
        '5': 'feature',
      };

      featureType = typeMap[answer.trim()];
      if (!featureType) {
        console.log(chalk.red('✗ Invalid selection'));
        process.exit(1);
      }
    }

    // Validate type
    const validTypes: FeatureType[] = [
      'bugfix',
      'refactoring',
      'improvement',
      'docs',
      'feature',
    ];
    if (!validTypes.includes(featureType)) {
      console.log(
        chalk.red(`✗ Invalid type: ${featureType}`)
      );
      console.log(
        chalk.gray('  Valid types: bugfix, refactoring, improvement, docs, feature')
      );
      process.exit(1);
    }

    await addFeatureHandler(description, featureType, options);
  });

// ============================================
// ADD-EPIC Command
// ============================================
program
  .command('add-epic <description>')
  .description('Add a complex feature that will be atomized into multiple executable features')
  .option('-p, --project <path>', 'Project path (defaults to current directory)')
  .option(
    '--type <type>',
    'Feature type (bugfix, refactoring, improvement, docs, feature)',
    'feature'
  )
  .option('-t, --target <target>', 'Target: web, mobile, shared, full, backend, api')
  .action(async (description: string, options) => {
    let featureType = options.type as FeatureType;

    // Validate target if provided
    const target = options.target as TargetType | undefined;
    if (target && !VALID_TARGETS.includes(target)) {
      console.log(chalk.red(`✗ Invalid target: ${target}`));
      console.log(chalk.gray(`  Valid targets: ${VALID_TARGETS.join(', ')}`));
      process.exit(1);
    }

    // Validate type
    const validTypes: FeatureType[] = [
      'bugfix',
      'refactoring',
      'improvement',
      'docs',
      'feature',
    ];
    if (!validTypes.includes(featureType)) {
      console.log(chalk.red(`✗ Invalid type: ${featureType}`));
      console.log(
        chalk.gray('  Valid types: bugfix, refactoring, improvement, docs, feature')
      );
      process.exit(1);
    }

    await atomizeFeatureHandler(description, featureType, options);
  });

// ============================================
// ADOPT Command
// ============================================
program
  .command('adopt')
  .description('Adopt an existing project by creating a feature_list.json')
  .option('-p, --project <path>', 'Project path (defaults to current directory)')
  .option('-n, --name <name>', 'Project name (auto-detected from package.json or directory)')
  .option('-d, --description <desc>', 'Project description')
  .action(async (options: { project?: string; name?: string; description?: string }) => {
    const projectPath = options.project ? resolve(options.project) : process.cwd();
    const featureListPath = join(projectPath, 'feature_list.json');

    // Check if feature_list.json already exists
    if (existsSync(featureListPath)) {
      console.log(chalk.yellow('! feature_list.json already exists in this project.'));
      const answer = await askUser(chalk.cyan('Overwrite? [y/N]: '));
      if (answer.toLowerCase() !== 'y') {
        console.log(chalk.gray('Cancelled'));
        process.exit(0);
      }
    }

    // Try to detect project info from package.json
    let projectName = options.name;
    let projectDescription = options.description;
    let techStack: string[] = [];

    const packageJsonPath = join(projectPath, 'package.json');
    if (existsSync(packageJsonPath)) {
      try {
        const packageJson = JSON.parse(await import('node:fs/promises').then(fs => fs.readFile(packageJsonPath, 'utf-8')));

        if (!projectName && packageJson.name) {
          projectName = packageJson.name;
        }
        if (!projectDescription && packageJson.description) {
          projectDescription = packageJson.description;
        }

        // Detect tech stack from dependencies
        const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
        if (deps) {
          if (deps['react']) techStack.push('React');
          if (deps['next']) techStack.push('Next.js');
          if (deps['vue']) techStack.push('Vue');
          if (deps['angular']) techStack.push('Angular');
          if (deps['express']) techStack.push('Express');
          if (deps['typescript']) techStack.push('TypeScript');
          if (deps['tailwindcss']) techStack.push('TailwindCSS');
          if (deps['prisma']) techStack.push('Prisma');
          if (deps['@supabase/supabase-js']) techStack.push('Supabase');
        }
      } catch {
        // Ignore errors reading package.json
      }
    }

    // Fallback to directory name
    if (!projectName) {
      projectName = projectPath.split('/').pop() || 'my-project';
    }

    // Ask for description if not provided
    if (!projectDescription) {
      projectDescription = await askUser(chalk.cyan('Enter project description: '));
    }

    // Create feature_list.json
    const featureList = {
      project_name: projectName,
      description: projectDescription || 'Project adopted by harness',
      ...(techStack.length > 0 && { tech_stack: techStack }),
      features: [] as { id: string; title: string; description: string; acceptance_criteria: string[]; passes: boolean }[],
    };

    // Import types for FeatureList
    const fs = await import('node:fs/promises');
    await fs.writeFile(featureListPath, JSON.stringify(featureList, null, 2));

    console.log(chalk.green('\n✓ Project adopted successfully!'));
    console.log(chalk.gray(`  Created: ${featureListPath}`));
    console.log(chalk.gray(`  Name: ${projectName}`));
    if (techStack.length > 0) {
      console.log(chalk.gray(`  Tech stack: ${techStack.join(', ')}`));
    }
    console.log(chalk.cyan('\nNext steps:'));
    console.log(chalk.gray('  harness add-bug "description"      # Add a bug to fix'));
    console.log(chalk.gray('  harness add-improvement "desc"     # Add an improvement'));
    console.log(chalk.gray('  harness add-refactor "desc"        # Add a refactoring task'));
    console.log(chalk.gray('  harness add "desc"                 # Add any feature type'));
  });

// ============================================
// STATUS Command
// ============================================
program
  .command('status')
  .description('Show project progress status')
  .option('-p, --project <path>', 'Project path (defaults to current directory)')
  .action(async (options: { project?: string }) => {
    const projectPath = options.project
      ? resolve(options.project)
      : process.cwd();

    const featureListPath = join(projectPath, 'feature_list.json');
    if (!existsSync(featureListPath)) {
      console.log(
        chalk.red(
          '✗ No feature_list.json found. Are you in a project directory?'
        )
      );
      process.exit(1);
    }

    const contextBuilder = new ContextBuilder(projectPath);
    const featureList = await contextBuilder.loadFeatureList();
    const stats = await contextBuilder.getProgressStats();

    if (!featureList) {
      console.log(chalk.red('✗ Could not load feature list'));
      process.exit(1);
    }

    console.log(chalk.cyan('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    console.log(chalk.cyan.bold(`  Project: ${featureList.project_name}`));
    console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));

    console.log(chalk.gray(`Description: ${featureList.description}`));
    console.log(
      chalk.gray(`Tech stack: ${featureList.tech_stack?.join(', ') || 'Not specified'}`)
    );

    // Progress bar
    const barLength = 40;
    const filled = Math.round((stats.percentage / 100) * barLength);
    const empty = barLength - filled;
    const progressBar =
      chalk.green('█'.repeat(filled)) + chalk.gray('░'.repeat(empty));
    console.log(`\nProgress: [${progressBar}] ${stats.percentage}%`);
    console.log(
      chalk.gray(
        `          ${stats.completed} completed / ${stats.pending} pending / ${stats.total} total`
      )
    );

    // Type breakdown
    const statsByType = await contextBuilder.getProgressStatsByType();
    if (Object.keys(statsByType.byType).length > 0) {
      console.log(chalk.cyan('\n📊 Breakdown by type:'));
      for (const [type, typeStats] of Object.entries(statsByType.byType)) {
        const total = typeStats.completed + typeStats.pending;
        const typePercent =
          total > 0 ? Math.round((typeStats.completed / total) * 100) : 0;
        console.log(
          chalk.gray(
            `  ${type.padEnd(12)} ${typeStats.completed}/${total} (${typePercent}%)`
          )
        );
      }
    }

    console.log(chalk.cyan('\nFeatures:'));
    for (const feature of featureList.features) {
      const status = feature.passes
        ? chalk.green('✓')
        : chalk.gray('○');
      const title = feature.passes
        ? chalk.gray(feature.title)
        : chalk.white(feature.title);
      const typeLabel = feature.type ? chalk.gray(` [${feature.type}]`) : '';
      console.log(`  ${status} ${feature.id}: ${title}${typeLabel}`);
    }

    // Next feature
    const nextFeature = await contextBuilder.getNextFeature();
    if (nextFeature) {
      console.log(chalk.cyan(`\nNext feature: ${nextFeature.id} - ${nextFeature.title}`));
      console.log(chalk.gray(`  ${nextFeature.description}`));
    } else {
      console.log(chalk.green('\n✓ All features complete!'));
    }

    console.log(chalk.cyan('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));
  });

// ============================================
// LOOP Command
// ============================================
program
  .command('loop')
  .description('Run coding sessions in a loop until all features are complete')
  .option('-m, --max <n>', 'Maximum sessions', '100')
  .option('-t, --max-turns <n>', 'Maximum turns per session', '50')
  .option('-p, --project <path>', 'Project path (defaults to current directory)')
  .option('-s, --supabase-ref <ref>', 'Supabase project ref (overrides SUPABASE_PROJECT_REF env)')
  .option('--type <type>', 'Process only features of specific type')
  .action(async (options: { max?: string; maxTurns?: string; project?: string; supabaseRef?: string; type?: string }) => {
    if (!checkAuth()) {
      process.exit(1);
    }

    const projectPath = options.project
      ? resolve(options.project)
      : process.cwd();
    const maxSessions = parseInt(options.max || '100', 10);
    const maxTurns = parseInt(options.maxTurns || '50', 10);

    // Debug: log Supabase project ref
    if (options.supabaseRef) {
      console.log(chalk.gray(`[CLI] Supabase project ref from CLI: ${options.supabaseRef}`));
    }

    const featureListPath = join(projectPath, 'feature_list.json');
    if (!existsSync(featureListPath)) {
      console.log(
        chalk.red(
          '✗ No feature_list.json found. Are you in a project directory?'
        )
      );
      process.exit(1);
    }

    const contextBuilder = new ContextBuilder(projectPath);
    const formatter = createOutputFormatter();
    const featureType = options.type as FeatureType | undefined;
    let session = 0;

    if (featureType) {
      console.log(chalk.gray(`Filtering by type: ${featureType}\n`));
    }

    while (session < maxSessions) {
      session++;

      const feature = featureType
        ? await contextBuilder.getNextFeatureByType(featureType)
        : await contextBuilder.getNextFeature();
      if (!feature) {
        console.log(chalk.green('\n✓ All features are complete!'));
        break;
      }

      console.log(chalk.cyan(`\n${'═'.repeat(60)}`));
      console.log(chalk.cyan.bold(`  Session ${session}: ${feature.id} - ${feature.title}`));
      console.log(chalk.cyan(`${'═'.repeat(60)}\n`));

      // Reset formatter para nova sessão
      formatter.reset();

      const agent = new CodingAgent(DEFAULT_AGENT_CONFIG);
      const result = await agent.runSession({
        workspacePath: projectPath,
        maxTurns,
        supabaseProjectRef: options.supabaseRef,
        onOutput: (text) => {
          const formatted = formatter.formatText(text);
          process.stdout.write(formatted);
        },
      });

      if (result.success) {
        console.log(chalk.green(`\n✓ Session ${session} complete`));
      } else {
        console.log(chalk.yellow(`\n⚠ Session ${session} incomplete`));
        if (result.error) {
          console.log(chalk.red(`  Error: ${result.error}`));
        }
      }

      // Small delay between sessions
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    // Final status
    const stats = await contextBuilder.getProgressStats();
    console.log(chalk.cyan(`\n${'═'.repeat(60)}`));
    console.log(chalk.cyan.bold('  Final Status'));
    console.log(chalk.cyan(`${'═'.repeat(60)}`));
    console.log(
      chalk.gray(
        `  Sessions: ${session}\n  Completed: ${stats.completed}/${stats.total} features (${stats.percentage}%)`
      )
    );
    console.log(chalk.cyan(`${'═'.repeat(60)}\n`));
  });

// ============================================
// RESET Command
// ============================================
program
  .command('reset')
  .description('Reset all features to passes: false (keeps code)')
  .option('-p, --project <path>', 'Project path (defaults to current directory)')
  .action(async (options: { project?: string }) => {
    const projectPath = options.project
      ? resolve(options.project)
      : process.cwd();

    const contextBuilder = new ContextBuilder(projectPath);
    const featureList = await contextBuilder.loadFeatureList();

    if (!featureList) {
      console.log(chalk.red('✗ No feature list found'));
      process.exit(1);
    }

    const answer = await askUser(
      chalk.yellow(
        'This will reset all features to incomplete. Continue? [y/N]: '
      )
    );

    if (answer.toLowerCase() !== 'y') {
      console.log(chalk.gray('Cancelled'));
      process.exit(0);
    }

    for (const feature of featureList.features) {
      feature.passes = false;
    }

    await contextBuilder.saveFeatureList(featureList);
    console.log(chalk.green('✓ All features reset to incomplete'));
  });

// ============================================
// Main
// ============================================
program
  .name('harness')
  .description('Dev Agent Harness - AI-powered incremental development (uses Claude Agent SDK)')
  .version('1.0.0');

program.parse();
