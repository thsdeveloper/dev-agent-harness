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

// Função auxiliar para obter o caminho do workspace
function getWorkspacePath(): string {
  return resolve(process.cwd(), 'workspace');
}

// Função auxiliar para prompts do usuário
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

// Verificar autenticação (token OAuth para assinatura Max, ou API key)
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
    console.log(chalk.green('✓ Usando assinatura Claude Max (sem custos de API)'));
  } else {
    console.log(chalk.yellow('! Usando API Key (custos se aplicam)'));
  }
  return true;
}

/**
 * Handler compartilhado para comandos de execução (suporta filtragem por tipo)
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

  // Validar feature_list.json
  const featureListPath = join(projectPath, 'feature_list.json');
  if (!existsSync(featureListPath)) {
    console.log(chalk.red('✗ Arquivo feature_list.json não encontrado no projeto.'));
    console.log(chalk.gray(`  Procurado em: ${featureListPath}`));
    console.log(
      chalk.cyan('\n  Execute "harness init <nome>" para criar um novo projeto primeiro.')
    );
    process.exit(1);
  }

  // Carregar próxima feature (filtrada por tipo se especificado)
  const contextBuilder = new ContextBuilder(projectPath);
  const feature = featureType
    ? await contextBuilder.getNextFeatureByType(featureType)
    : await contextBuilder.getNextFeature();

  if (!feature) {
    const typeMsg = featureType ? ` do tipo "${featureType}"` : '';
    console.log(
      chalk.green(`✓ Nenhuma feature pendente${typeMsg} encontrada. Todas as features podem estar completas!`)
    );
    console.log(chalk.cyan('\n  Execute "harness status" para ver o status do projeto.'));
    process.exit(0);
  }

  console.log(chalk.cyan('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log(
    chalk.cyan.bold(`  Iniciando sessão para: ${feature.id} - ${feature.title}`)
  );
  if (feature.type) {
    console.log(chalk.gray(`  Tipo: ${feature.type}`));
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
      console.log(chalk.gray(`\n[Progresso] ${msg}`));
    },
  });

  console.log('\n');
  console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));

  if (result.success) {
    console.log(chalk.green.bold(`✓ Feature ${result.featureId} completada com sucesso!`));
    if (result.commitHash) {
      console.log(chalk.gray(`  Commit: ${result.commitHash}`));
    }
  } else {
    console.log(chalk.yellow.bold(`⚠ Feature ${result.featureId} incompleta`));
    if (result.error) {
      console.log(chalk.red(`  Erro: ${result.error}`));
    }
  }

  // Mostrar progresso
  const stats = await contextBuilder.getProgressStats();
  console.log(
    chalk.gray(
      `\n  Progresso: ${stats.completed}/${stats.total} features (${stats.percentage}%)`
    )
  );
  console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));
}

// ============================================
// Comando INIT
// ============================================
program
  .command('init <nome>')
  .description('Inicializar um novo projeto com lista de features gerada por IA')
  .option('-d, --description <desc>', 'Descrição do projeto')
  .option('-t, --tech <stack>', 'Stack tecnológica separada por vírgulas')
  .action(async (name: string, options: { description?: string; tech?: string }) => {
    if (!checkAuth()) {
      process.exit(1);
    }

    const spinner = ora('Inicializando projeto...').start();

    try {
      // Obter descrição interativamente se não fornecida
      let description = options.description;
      if (!description) {
        spinner.stop();
        description = await askUser(
          chalk.cyan('Digite a descrição do projeto: ')
        );
        spinner.start();
      }

      const techStack = options.tech?.split(',').map((t) => t.trim());
      const workspacePath = getWorkspacePath();

      const agent = new InitializerAgent(DEFAULT_AGENT_CONFIG);
      const formatter = createOutputFormatter();

      spinner.stop();
      console.log(chalk.cyan('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
      console.log(chalk.cyan.bold('  Claude Agent SDK: Gerando lista de features...'));
      console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));

      const result = await agent.initialize({
        projectName: name,
        description,
        techStack,
        workspacePath,
        onProgress: (msg) => {
          console.log(chalk.gray(`[Progresso] ${msg}`));
        },
        onOutput: (text) => {
          const formatted = formatter.formatText(text);
          process.stdout.write(formatted);
        },
      });

      if (result.success && result.featureList) {
        console.log(chalk.green('\n✓ Projeto inicializado com sucesso!'));
        console.log(chalk.gray(`  Localização: ${join(workspacePath, name)}`));
        console.log(
          chalk.gray(
            `  Features: ${result.featureList.features.length} features geradas`
          )
        );
        console.log(
          chalk.gray(`  Stack tecnológica: ${result.featureList.tech_stack?.join(', ') || 'Não especificada'}`)
        );
        if (result.totalCostUsd) {
          console.log(chalk.gray(`  Custo: $${result.totalCostUsd.toFixed(4)}`));
        }

        console.log(chalk.cyan('\nFeatures geradas:'));
        for (const feature of result.featureList.features) {
          console.log(chalk.gray(`  ${feature.id}: ${feature.title}`));
        }

        console.log(
          chalk.cyan(`\nPróximos passos:\n  cd workspace/${name}\n  harness run`)
        );
      } else {
        console.log(chalk.red(`\n✗ Falha ao inicializar: ${result.error}`));
        process.exit(1);
      }
    } catch (error) {
      spinner.stop();
      console.log(
        chalk.red(
          `\n✗ Erro: ${error instanceof Error ? error.message : error}`
        )
      );
      process.exit(1);
    }
  });

// ============================================
// Comando RUN
// ============================================
program
  .command('run')
  .description('Executar uma sessão de codificação para implementar a próxima feature')
  .option('-p, --project <path>', 'Caminho do projeto (padrão: diretório atual)')
  .option('-m, --max-turns <n>', 'Máximo de turnos para o Claude', '50')
  .option('-s, --supabase-ref <ref>', 'Ref do projeto Supabase (sobrescreve SUPABASE_PROJECT_REF)')
  .action(async (options) => {
    await runCommandHandler(options);
  });

// ============================================
// Comando REFACTOR
// ============================================
program
  .command('refactor')
  .description('Executar uma sessão de refatoração (processa próxima feature de refatoração)')
  .option('-p, --project <path>', 'Caminho do projeto (padrão: diretório atual)')
  .option('-m, --max-turns <n>', 'Máximo de turnos para o Claude', '50')
  .option('-s, --supabase-ref <ref>', 'Ref do projeto Supabase (sobrescreve SUPABASE_PROJECT_REF)')
  .action(async (options) => {
    await runCommandHandler(options, 'refactoring');
  });

// ============================================
// Comando FIX
// ============================================
program
  .command('fix')
  .description('Executar uma sessão de correção de bugs (processa próximo bugfix)')
  .option('-p, --project <path>', 'Caminho do projeto (padrão: diretório atual)')
  .option('-m, --max-turns <n>', 'Máximo de turnos para o Claude', '50')
  .option('-s, --supabase-ref <ref>', 'Ref do projeto Supabase (sobrescreve SUPABASE_PROJECT_REF)')
  .action(async (options) => {
    await runCommandHandler(options, 'bugfix');
  });

// ============================================
// Comando IMPROVE
// ============================================
program
  .command('improve')
  .description('Executar uma sessão de melhorias (processa próxima melhoria)')
  .option('-p, --project <path>', 'Caminho do projeto (padrão: diretório atual)')
  .option('-m, --max-turns <n>', 'Máximo de turnos para o Claude', '50')
  .option('-s, --supabase-ref <ref>', 'Ref do projeto Supabase (sobrescreve SUPABASE_PROJECT_REF)')
  .action(async (options) => {
    await runCommandHandler(options, 'improvement');
  });

// ============================================
// Comando DOCS
// ============================================
program
  .command('docs')
  .description('Executar uma sessão de documentação (processa próxima feature de docs)')
  .option('-p, --project <path>', 'Caminho do projeto (padrão: diretório atual)')
  .option('-m, --max-turns <n>', 'Máximo de turnos para o Claude', '50')
  .option('-s, --supabase-ref <ref>', 'Ref do projeto Supabase (sobrescreve SUPABASE_PROJECT_REF)')
  .action(async (options) => {
    await runCommandHandler(options, 'docs');
  });

// Targets válidos para suporte a monorepo
const VALID_TARGETS: TargetType[] = ['web', 'mobile', 'shared', 'full', 'backend', 'api'];

// ============================================
// Helper para comandos ADD
// ============================================
async function addFeatureHandler(
  description: string,
  featureType: FeatureType,
  options: { project?: string; file?: string; atomize?: boolean; target?: string }
): Promise<void> {
  // Validar target se fornecido
  const target = options.target as TargetType | undefined;
  if (target && !VALID_TARGETS.includes(target)) {
    console.log(chalk.red(`✗ Target inválido: ${target}`));
    console.log(chalk.gray(`  Targets válidos: ${VALID_TARGETS.join(', ')}`));
    process.exit(1);
  }

  // Se flag --atomize estiver definida, usar atomizeFeatureHandler
  if (options.atomize) {
    return await atomizeFeatureHandler(description, featureType, { ...options, target });
  }

  if (!checkAuth()) {
    process.exit(1);
  }

  if (!description || description.trim().length === 0) {
    console.log(chalk.red('✗ Descrição é obrigatória'));
    console.log(chalk.gray('  Uso: harness add-bug "Descrição do bug"'));
    process.exit(1);
  }

  const projectPath = options.project ? resolve(options.project) : process.cwd();

  // Verificar se estamos em um projeto válido
  const featureListPath = join(projectPath, 'feature_list.json');
  if (!existsSync(featureListPath)) {
    console.log(chalk.red('✗ Arquivo feature_list.json não encontrado no projeto.'));
    console.log(chalk.gray(`  Procurado em: ${featureListPath}`));
    console.log(
      chalk.cyan('\n  Execute "harness init <nome>" para criar um novo projeto primeiro.')
    );
    process.exit(1);
  }

  const targetLabel = target ? ` [${target.toUpperCase()}]` : '';
  console.log(chalk.cyan('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log(chalk.cyan.bold(`  Adicionando feature ${featureType}...${targetLabel}`));
  console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));

  const agent = new FeatureAdderAgent(DEFAULT_AGENT_CONFIG);
  const formatter = createOutputFormatter();

  // Adicionar target à descrição se especificado
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
      console.log(chalk.gray(`[Progresso] ${msg}`));
    },
  });

  console.log('\n');
  console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));

  if (result.success && result.feature) {
    console.log(chalk.green.bold('✓ Feature adicionada com sucesso!'));
    console.log(chalk.gray(`  ID: ${result.feature.id}`));
    console.log(chalk.gray(`  Título: ${result.feature.title}`));
    console.log(chalk.gray(`  Tipo: ${result.feature.type || 'feature'}`));
    console.log(
      chalk.cyan(
        `\n  Execute "harness ${featureType === 'bugfix' ? 'fix' : featureType === 'refactoring' ? 'refactor' : featureType === 'improvement' ? 'improve' : featureType === 'docs' ? 'docs' : 'run'}" para implementar esta feature.`
      )
    );
  } else {
    console.log(chalk.red.bold('✗ Falha ao adicionar feature'));
    if (result.error) {
      console.log(chalk.red(`  Erro: ${result.error}`));
    }
    process.exit(1);
  }

  console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));
}

// ============================================
// Helper para comandos ADD-EPIC/ATOMIZE
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
    console.log(chalk.red('✗ Descrição é obrigatória'));
    console.log(chalk.gray('  Uso: harness add-epic "Descrição da feature complexa"'));
    process.exit(1);
  }

  const projectPath = options.project ? resolve(options.project) : process.cwd();
  const target = options.target;

  // Verificar se estamos em um projeto válido
  const featureListPath = join(projectPath, 'feature_list.json');
  if (!existsSync(featureListPath)) {
    console.log(chalk.red('✗ Arquivo feature_list.json não encontrado no projeto.'));
    console.log(chalk.gray(`  Procurado em: ${featureListPath}`));
    console.log(
      chalk.cyan('\n  Execute "harness init <nome>" para criar um novo projeto primeiro.')
    );
    process.exit(1);
  }

  const targetLabel = target ? ` [${target.toUpperCase()}]` : '';
  console.log(chalk.cyan('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log(chalk.cyan.bold(`  Atomizando ${featureType} em múltiplas features...${targetLabel}`));
  console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));
  console.log(chalk.gray(`Feature complexa: ${description}`));
  if (target) {
    console.log(chalk.gray(`Target: ${target}`));
  }
  console.log(chalk.gray('Isso será dividido em 3-10 features atômicas e executáveis.\n'));

  const agent = new FeatureAtomizerAgent(DEFAULT_AGENT_CONFIG);
  const formatter = createOutputFormatter();

  // Adicionar target à descrição se especificado
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
      console.log(chalk.gray(`[Progresso] ${msg}`));
    },
  });

  console.log('\n');
  console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));

  if (result.success && result.features) {
    console.log(chalk.green.bold(`✓ Atomizado com sucesso em ${result.features.length} features!`));
    console.log(chalk.gray('\nFeatures adicionadas:'));
    result.features.forEach((feature, index) => {
      console.log(chalk.gray(`  ${index + 1}. [${feature.id}] ${feature.title}`));
    });
    console.log(
      chalk.cyan(
        `\n  Execute "harness ${featureType === 'bugfix' ? 'fix' : featureType === 'refactoring' ? 'refactor' : featureType === 'improvement' ? 'improve' : featureType === 'docs' ? 'docs' : 'run'}" para começar a implementar estas features.`
      )
    );
  } else {
    console.log(chalk.red.bold('✗ Falha ao atomizar feature'));
    if (result.error) {
      console.log(chalk.red(`  Erro: ${result.error}`));
    }
    process.exit(1);
  }

  console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));
}

// ============================================
// Comando ADD-BUG
// ============================================
program
  .command('add-bug <descricao>')
  .description('Adicionar uma feature de correção de bug ao projeto')
  .option('-p, --project <path>', 'Caminho do projeto (padrão: diretório atual)')
  .option('-f, --file <path>', 'Caminho do arquivo relacionado (opcional)')
  .option('-a, --atomize', 'Atomizar bug complexo em múltiplas features')
  .option('-t, --target <target>', 'Target: web, mobile, shared, full, backend, api')
  .action(async (description: string, options) => {
    await addFeatureHandler(description, 'bugfix', options);
  });

// ============================================
// Comando ADD-REFACTOR
// ============================================
program
  .command('add-refactor <descricao>')
  .description('Adicionar uma feature de refatoração ao projeto')
  .option('-p, --project <path>', 'Caminho do projeto (padrão: diretório atual)')
  .option('-f, --file <path>', 'Caminho do arquivo relacionado (opcional)')
  .option('-a, --atomize', 'Atomizar refatoração complexa em múltiplas features')
  .option('-t, --target <target>', 'Target: web, mobile, shared, full, backend, api')
  .action(async (description: string, options) => {
    await addFeatureHandler(description, 'refactoring', options);
  });

// ============================================
// Comando ADD-IMPROVEMENT
// ============================================
program
  .command('add-improvement <descricao>')
  .description('Adicionar uma feature de melhoria ao projeto')
  .option('-p, --project <path>', 'Caminho do projeto (padrão: diretório atual)')
  .option('-f, --file <path>', 'Caminho do arquivo relacionado (opcional)')
  .option('-a, --atomize', 'Atomizar melhoria complexa em múltiplas features')
  .option('-t, --target <target>', 'Target: web, mobile, shared, full, backend, api')
  .action(async (description: string, options) => {
    await addFeatureHandler(description, 'improvement', options);
  });

// ============================================
// Comando ADD-DOCS
// ============================================
program
  .command('add-docs <descricao>')
  .description('Adicionar uma feature de documentação ao projeto')
  .option('-p, --project <path>', 'Caminho do projeto (padrão: diretório atual)')
  .option('-f, --file <path>', 'Caminho do arquivo relacionado (opcional)')
  .option('-a, --atomize', 'Atomizar documentação complexa em múltiplas features')
  .option('-t, --target <target>', 'Target: web, mobile, shared, full, backend, api')
  .action(async (description: string, options) => {
    await addFeatureHandler(description, 'docs', options);
  });

// ============================================
// Comando ADD (genérico)
// ============================================
program
  .command('add <descricao>')
  .description('Adicionar uma feature ao projeto (seleção interativa de tipo)')
  .option('-p, --project <path>', 'Caminho do projeto (padrão: diretório atual)')
  .option('-f, --file <path>', 'Caminho do arquivo relacionado (opcional)')
  .option(
    '--type <type>',
    'Tipo da feature (bugfix, refactoring, improvement, docs, feature)'
  )
  .option('-a, --atomize', 'Atomizar feature complexa em múltiplas features')
  .option('-t, --target <target>', 'Target: web, mobile, shared, full, backend, api')
  .action(async (description: string, options) => {
    let featureType = options.type as FeatureType | undefined;

    // Se tipo não fornecido, perguntar interativamente
    if (!featureType) {
      console.log(chalk.cyan('\nSelecione o tipo da feature:'));
      console.log(chalk.gray('  1. bugfix (correção de bug)'));
      console.log(chalk.gray('  2. refactoring (refatoração)'));
      console.log(chalk.gray('  3. improvement (melhoria)'));
      console.log(chalk.gray('  4. docs (documentação)'));
      console.log(chalk.gray('  5. feature (funcionalidade)'));

      const answer = await askUser(chalk.cyan('\nDigite o número (1-5): '));
      const typeMap: Record<string, FeatureType> = {
        '1': 'bugfix',
        '2': 'refactoring',
        '3': 'improvement',
        '4': 'docs',
        '5': 'feature',
      };

      featureType = typeMap[answer.trim()];
      if (!featureType) {
        console.log(chalk.red('✗ Seleção inválida'));
        process.exit(1);
      }
    }

    // Validar tipo
    const validTypes: FeatureType[] = [
      'bugfix',
      'refactoring',
      'improvement',
      'docs',
      'feature',
    ];
    if (!validTypes.includes(featureType)) {
      console.log(
        chalk.red(`✗ Tipo inválido: ${featureType}`)
      );
      console.log(
        chalk.gray('  Tipos válidos: bugfix, refactoring, improvement, docs, feature')
      );
      process.exit(1);
    }

    await addFeatureHandler(description, featureType, options);
  });

// ============================================
// Comando ADD-EPIC
// ============================================
program
  .command('add-epic <descricao>')
  .description('Adicionar uma feature complexa que será atomizada em múltiplas features executáveis')
  .option('-p, --project <path>', 'Caminho do projeto (padrão: diretório atual)')
  .option(
    '--type <type>',
    'Tipo da feature (bugfix, refactoring, improvement, docs, feature)',
    'feature'
  )
  .option('-t, --target <target>', 'Target: web, mobile, shared, full, backend, api')
  .action(async (description: string, options) => {
    let featureType = options.type as FeatureType;

    // Validar target se fornecido
    const target = options.target as TargetType | undefined;
    if (target && !VALID_TARGETS.includes(target)) {
      console.log(chalk.red(`✗ Target inválido: ${target}`));
      console.log(chalk.gray(`  Targets válidos: ${VALID_TARGETS.join(', ')}`));
      process.exit(1);
    }

    // Validar tipo
    const validTypes: FeatureType[] = [
      'bugfix',
      'refactoring',
      'improvement',
      'docs',
      'feature',
    ];
    if (!validTypes.includes(featureType)) {
      console.log(chalk.red(`✗ Tipo inválido: ${featureType}`));
      console.log(
        chalk.gray('  Tipos válidos: bugfix, refactoring, improvement, docs, feature')
      );
      process.exit(1);
    }

    await atomizeFeatureHandler(description, featureType, options);
  });

// ============================================
// Comando ADOPT
// ============================================
program
  .command('adopt')
  .description('Adotar um projeto existente criando um feature_list.json')
  .option('-p, --project <path>', 'Caminho do projeto (padrão: diretório atual)')
  .option('-n, --name <name>', 'Nome do projeto (auto-detectado do package.json ou diretório)')
  .option('-d, --description <desc>', 'Descrição do projeto')
  .action(async (options: { project?: string; name?: string; description?: string }) => {
    const projectPath = options.project ? resolve(options.project) : process.cwd();
    const featureListPath = join(projectPath, 'feature_list.json');

    // Verificar se feature_list.json já existe
    if (existsSync(featureListPath)) {
      console.log(chalk.yellow('! feature_list.json já existe neste projeto.'));
      const answer = await askUser(chalk.cyan('Sobrescrever? [s/N]: '));
      if (answer.toLowerCase() !== 's' && answer.toLowerCase() !== 'y') {
        console.log(chalk.gray('Cancelado'));
        process.exit(0);
      }
    }

    // Tentar detectar informações do projeto do package.json
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

        // Detectar stack tecnológica das dependências
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
        // Ignorar erros ao ler package.json
      }
    }

    // Fallback para nome do diretório
    if (!projectName) {
      projectName = projectPath.split('/').pop() || 'meu-projeto';
    }

    // Perguntar descrição se não fornecida
    if (!projectDescription) {
      projectDescription = await askUser(chalk.cyan('Digite a descrição do projeto: '));
    }

    // Criar feature_list.json
    const featureList = {
      project_name: projectName,
      description: projectDescription || 'Projeto adotado pelo harness',
      ...(techStack.length > 0 && { tech_stack: techStack }),
      features: [] as { id: string; title: string; description: string; acceptance_criteria: string[]; passes: boolean }[],
    };

    // Importar tipos para FeatureList
    const fs = await import('node:fs/promises');
    await fs.writeFile(featureListPath, JSON.stringify(featureList, null, 2));

    console.log(chalk.green('\n✓ Projeto adotado com sucesso!'));
    console.log(chalk.gray(`  Criado: ${featureListPath}`));
    console.log(chalk.gray(`  Nome: ${projectName}`));
    if (techStack.length > 0) {
      console.log(chalk.gray(`  Stack tecnológica: ${techStack.join(', ')}`));
    }
    console.log(chalk.cyan('\nPróximos passos:'));
    console.log(chalk.gray('  harness add-bug "descrição"        # Adicionar um bug para corrigir'));
    console.log(chalk.gray('  harness add-improvement "desc"     # Adicionar uma melhoria'));
    console.log(chalk.gray('  harness add-refactor "desc"        # Adicionar uma refatoração'));
    console.log(chalk.gray('  harness add "desc"                 # Adicionar qualquer tipo de feature'));
  });

// ============================================
// Comando STATUS
// ============================================
program
  .command('status')
  .description('Mostrar status de progresso do projeto')
  .option('-p, --project <path>', 'Caminho do projeto (padrão: diretório atual)')
  .action(async (options: { project?: string }) => {
    const projectPath = options.project
      ? resolve(options.project)
      : process.cwd();

    const featureListPath = join(projectPath, 'feature_list.json');
    if (!existsSync(featureListPath)) {
      console.log(
        chalk.red(
          '✗ Arquivo feature_list.json não encontrado. Você está em um diretório de projeto?'
        )
      );
      process.exit(1);
    }

    const contextBuilder = new ContextBuilder(projectPath);
    const featureList = await contextBuilder.loadFeatureList();
    const stats = await contextBuilder.getProgressStats();

    if (!featureList) {
      console.log(chalk.red('✗ Não foi possível carregar a lista de features'));
      process.exit(1);
    }

    console.log(chalk.cyan('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    console.log(chalk.cyan.bold(`  Projeto: ${featureList.project_name}`));
    console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));

    console.log(chalk.gray(`Descrição: ${featureList.description}`));
    console.log(
      chalk.gray(`Stack tecnológica: ${featureList.tech_stack?.join(', ') || 'Não especificada'}`)
    );

    // Barra de progresso
    const barLength = 40;
    const filled = Math.round((stats.percentage / 100) * barLength);
    const empty = barLength - filled;
    const progressBar =
      chalk.green('█'.repeat(filled)) + chalk.gray('░'.repeat(empty));
    console.log(`\nProgresso: [${progressBar}] ${stats.percentage}%`);
    console.log(
      chalk.gray(
        `           ${stats.completed} completas / ${stats.pending} pendentes / ${stats.total} total`
      )
    );

    // Detalhamento por tipo
    const statsByType = await contextBuilder.getProgressStatsByType();
    if (Object.keys(statsByType.byType).length > 0) {
      console.log(chalk.cyan('\n📊 Detalhamento por tipo:'));
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

    // Próxima feature
    const nextFeature = await contextBuilder.getNextFeature();
    if (nextFeature) {
      console.log(chalk.cyan(`\nPróxima feature: ${nextFeature.id} - ${nextFeature.title}`));
      console.log(chalk.gray(`  ${nextFeature.description}`));
    } else {
      console.log(chalk.green('\n✓ Todas as features completas!'));
    }

    console.log(chalk.cyan('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));
  });

// ============================================
// Comando LOOP
// ============================================
program
  .command('loop')
  .description('Executar sessões de codificação em loop até todas as features estarem completas')
  .option('-m, --max <n>', 'Máximo de sessões', '100')
  .option('-t, --max-turns <n>', 'Máximo de turnos por sessão', '50')
  .option('-p, --project <path>', 'Caminho do projeto (padrão: diretório atual)')
  .option('-s, --supabase-ref <ref>', 'Ref do projeto Supabase (sobrescreve SUPABASE_PROJECT_REF)')
  .option('--type <type>', 'Processar apenas features de um tipo específico')
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
      console.log(chalk.gray(`[CLI] Ref do projeto Supabase via CLI: ${options.supabaseRef}`));
    }

    const featureListPath = join(projectPath, 'feature_list.json');
    if (!existsSync(featureListPath)) {
      console.log(
        chalk.red(
          '✗ Arquivo feature_list.json não encontrado. Você está em um diretório de projeto?'
        )
      );
      process.exit(1);
    }

    const contextBuilder = new ContextBuilder(projectPath);
    const formatter = createOutputFormatter();
    const featureType = options.type as FeatureType | undefined;
    let session = 0;

    if (featureType) {
      console.log(chalk.gray(`Filtrando por tipo: ${featureType}\n`));
    }

    while (session < maxSessions) {
      session++;

      const feature = featureType
        ? await contextBuilder.getNextFeatureByType(featureType)
        : await contextBuilder.getNextFeature();
      if (!feature) {
        console.log(chalk.green('\n✓ Todas as features estão completas!'));
        break;
      }

      console.log(chalk.cyan(`\n${'═'.repeat(60)}`));
      console.log(chalk.cyan.bold(`  Sessão ${session}: ${feature.id} - ${feature.title}`));
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
        console.log(chalk.green(`\n✓ Sessão ${session} completa`));
      } else {
        console.log(chalk.yellow(`\n⚠ Sessão ${session} incompleta`));
        if (result.error) {
          console.log(chalk.red(`  Erro: ${result.error}`));
        }
      }

      // Pequeno delay entre sessões
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    // Status final
    const stats = await contextBuilder.getProgressStats();
    console.log(chalk.cyan(`\n${'═'.repeat(60)}`));
    console.log(chalk.cyan.bold('  Status Final'));
    console.log(chalk.cyan(`${'═'.repeat(60)}`));
    console.log(
      chalk.gray(
        `  Sessões: ${session}\n  Completas: ${stats.completed}/${stats.total} features (${stats.percentage}%)`
      )
    );
    console.log(chalk.cyan(`${'═'.repeat(60)}\n`));
  });

// ============================================
// Comando RESET
// ============================================
program
  .command('reset')
  .description('Resetar todas as features para passes: false (mantém o código)')
  .option('-p, --project <path>', 'Caminho do projeto (padrão: diretório atual)')
  .action(async (options: { project?: string }) => {
    const projectPath = options.project
      ? resolve(options.project)
      : process.cwd();

    const contextBuilder = new ContextBuilder(projectPath);
    const featureList = await contextBuilder.loadFeatureList();

    if (!featureList) {
      console.log(chalk.red('✗ Lista de features não encontrada'));
      process.exit(1);
    }

    const answer = await askUser(
      chalk.yellow(
        'Isso vai resetar todas as features para incompletas. Continuar? [s/N]: '
      )
    );

    if (answer.toLowerCase() !== 's' && answer.toLowerCase() !== 'y') {
      console.log(chalk.gray('Cancelado'));
      process.exit(0);
    }

    for (const feature of featureList.features) {
      feature.passes = false;
    }

    await contextBuilder.saveFeatureList(featureList);
    console.log(chalk.green('✓ Todas as features resetadas para incompletas'));
  });

// ============================================
// Principal
// ============================================
program
  .name('harness')
  .description('Dev Agent Harness - Desenvolvimento incremental com IA (usa Claude Agent SDK)')
  .version('1.0.0');

program.parse();
