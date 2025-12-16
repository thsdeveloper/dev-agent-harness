# Dev Agent Harness

A harness for long-running AI coding agents, inspired by [Anthropic's engineering blog post](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) and the [autonomous-coding quickstart](https://github.com/anthropics/claude-quickstarts/tree/main/autonomous-coding).

## Overview

This harness enables AI agents to work on complex software projects incrementally across multiple sessions. The key insight is that agents can maintain progress through **external memory artifacts**:

- `feature_list.json` - Ordered list of features to implement
- `progress.log` - History of completed work
- Git history - Code changes and commits

## Features

### 🎨 Atomic Design Methodology

The harness enforces **Atomic Design** for all UI components, ensuring scalable and maintainable code:

- **Atoms** (`components/atoms/` or `components/ui/`): Basic building blocks (buttons, inputs, labels)
- **Molecules** (`components/molecules/`): Simple combinations (form fields, search bars)
- **Organisms** (`components/organisms/`): Complex sections (forms, navigation, headers)
- **Templates** (`components/templates/`): Page-level layouts
- **Pages** (`app/` or `pages/`): Actual pages with real data

**How it works:**
1. Initializer agent automatically generates an "Atomic Design Setup" feature for UI projects
2. Coding agent follows the hierarchy when building components
3. shadcn/ui components are treated as atoms, ready to compose into higher-level components

## Architecture

Uses the official **[Claude Agent SDK](https://platform.claude.com/docs/en/api/agent-sdk/overview)** for TypeScript, providing:
- Full Claude Code capabilities (file editing, bash, search, etc.)
- Streaming responses
- Tool permission control
- Session management

## Prerequisites

- Node.js >= 20
- Autenticação (uma das opções abaixo)

## Autenticação

### Usando arquivo .env (Recomendado)

Copie `.env.example` para `.env` e configure suas credenciais:

```bash
cp .env.example .env
```

Edite o arquivo `.env`:

```bash
# Opção 1: Claude Max (sem custos adicionais)
CLAUDE_CODE_OAUTH_TOKEN=<token-gerado-com-claude-setup-token>

# Opção 2: API Key (custos por uso)
# ANTHROPIC_API_KEY=sua-api-key

# Supabase (opcional)
SUPABASE_ACCESS_TOKEN=sbp_...
SUPABASE_PROJECT_REF=ycjaijhrjtrsfvuncfcv
```

### Usando variáveis de ambiente

Alternativamente, exporte as variáveis no shell:

**Opção 1: Claude Max (Recomendado - Sem custos adicionais)**

```bash
# Gerar token de autenticação (uma vez)
claude setup-token

# Exportar
export CLAUDE_CODE_OAUTH_TOKEN="<token-gerado>"
```

**Opção 2: API Key (Custos por uso)**

```bash
export ANTHROPIC_API_KEY="sua-api-key"
```

Obtenha sua API key em [console.anthropic.com](https://console.anthropic.com/)

## Installation

```bash
cd dev-agent-harness
pnpm install
pnpm build
```

## Usage

### 1. Initialize a new project

```bash
npx tsx src/cli.ts init my-app
# or after build:
node dist/cli.js init my-app
```

You'll be prompted to describe your project. The Initializer Agent will generate a feature list using Claude Code.

### 2. Run a coding session

```bash
cd workspace/my-app
npx tsx ../src/cli.ts run
```

The Coding Agent (via Claude Code) will:
1. Find the next incomplete feature
2. Create an implementation plan
3. Write code, run commands, etc.
4. Update the feature list
5. Commit changes

### 3. Check status

```bash
npx tsx src/cli.ts status
```

### 4. Run in loop mode

```bash
npx tsx src/cli.ts loop
```

This runs sessions continuously until all features are complete.

## Commands

| Command | Description |
|---------|-------------|
| `init <name>` | Initialize a new project |
| `run` | Run a single coding session |
| `status` | Show project progress |
| `loop` | Run sessions until complete |
| `reset` | Reset all features to incomplete |

### Options

#### `init <name>`
| Flag | Alias | Description |
|------|-------|-------------|
| `--description <desc>` | `-d` | Project description |
| `--tech <stack>` | `-t` | Comma-separated tech stack |

```bash
harness init my-app -d "A todo app with React and TypeScript"
harness init my-app -d "E-commerce site" -t "Next.js,Prisma,PostgreSQL"
```

#### `run`
| Flag | Alias | Description |
|------|-------|-------------|
| `--project <path>` | `-p` | Project path (defaults to current directory) |
| `--max-turns <n>` | `-m` | Maximum turns for Claude (default: 50) |
| `--supabase-ref <ref>` | `-s` | Supabase project ref (overrides `SUPABASE_PROJECT_REF` env) |

```bash
harness run
harness run -p ./workspace/my-app
harness run --max-turns 100
harness run -s shqbwmcffoxzvmorudna  # With Supabase project
```

#### `loop`
| Flag | Alias | Description |
|------|-------|-------------|
| `--project <path>` | `-p` | Project path (defaults to current directory) |
| `--max <n>` | `-m` | Maximum sessions (default: 100) |
| `--max-turns <n>` | `-t` | Maximum turns per session (default: 50) |
| `--supabase-ref <ref>` | `-s` | Supabase project ref (overrides `SUPABASE_PROJECT_REF` env) |

```bash
harness loop
harness loop --max 50 --max-turns 30
harness loop -s shqbwmcffoxzvmorudna  # With Supabase project
```

#### `status`
| Flag | Alias | Description |
|------|-------|-------------|
| `--project <path>` | `-p` | Project path (defaults to current directory) |

```bash
harness status
harness status -p ./workspace/my-app
```

#### `reset`
| Flag | Alias | Description |
|------|-------|-------------|
| `--project <path>` | `-p` | Project path (defaults to current directory) |

```bash
harness reset
harness reset -p ./workspace/my-app
```

### Environment Variables

| Variable | Description |
|----------|-------------|
| `CLAUDE_CODE_OAUTH_TOKEN` | OAuth token for Claude Max subscription (preferred) |
| `ANTHROPIC_API_KEY` | API key for pay-per-use |
| `SUPABASE_ACCESS_TOKEN` | Personal Access Token for Supabase MCP |
| `SUPABASE_PROJECT_REF` | Default Supabase project ref (can be overridden via CLI) |

### MCP Servers

The harness includes built-in [MCP (Model Context Protocol)](https://modelcontextprotocol.io/) servers that extend agent capabilities:

#### shadcn/ui MCP (always enabled)

Provides access to the [shadcn/ui](https://ui.shadcn.com/) component registry:

| Capability | Description |
|------------|-------------|
| **Browse components** | List all available shadcn/ui components |
| **Search components** | Find components by name or functionality |
| **Install components** | Add components to the project via natural language |

The agent automatically uses shadcn/ui components when implementing UI features:

```
Agent: "I need a button and a dialog for this feature"
→ Automatically runs: npx shadcn add button dialog
```

#### Supabase MCP (conditional)

Enabled when `SUPABASE_ACCESS_TOKEN` is configured. Provides direct database access:

| Capability | Description |
|------------|-------------|
| **Database operations** | Create tables, run queries, manage schema |
| **Execute SQL** | Run SQL commands directly on the database |
| **List projects** | See available Supabase projects |
| **Manage auth** | Configure authentication settings |

```bash
# Setup Supabase MCP
export SUPABASE_ACCESS_TOKEN="sbp_your_token_here"

# Run with specific project
harness run -s your-project-ref
```

The agent can create database structures as part of feature implementation:

```
Feature: "Add user tasks table"
→ Agent uses MCP: CREATE TABLE tasks (id uuid, user_id uuid, title text, ...)
→ Agent writes code: const { data } = await supabase.from('tasks').select('*')
```

## How It Works

### Initializer Agent
Takes a project description and generates an ordered feature list with:
- Project setup and configuration
- Core data models
- Basic infrastructure
- Core features → Secondary features → Polish

### Coding Agent
For each session:
1. Reads the next incomplete feature from `feature_list.json`
2. Reviews `progress.log` and git history for context
3. Creates a detailed implementation plan
4. Uses Claude Code's tools (Read, Write, Edit, Bash, etc.)
5. Verifies the implementation works
6. Marks feature as complete
7. Commits changes to git

### External Memory Artifacts

```
workspace/my-app/
├── feature_list.json    # Ordered feature list
├── progress.log         # Session history
├── .git/               # Code changes
└── src/                # Your project code
```

## Architecture

```
src/
├── cli.ts                    # CLI commands
├── index.ts                  # Public exports
├── core/
│   ├── agent-sdk-client.ts   # Claude Agent SDK wrapper + MCP configuration
│   ├── claude-code-client.ts # Claude Code CLI wrapper (legacy)
│   └── context-builder.ts    # Session context builder
├── agents/
│   ├── initializer.ts        # Project initialization agent
│   └── coding-agent.ts       # Feature implementation agent
├── prompts/
│   ├── initializer.ts        # Initializer system prompt
│   └── coding-agent.ts       # Coding agent system prompt (includes MCP instructions)
└── types/
    └── index.ts              # TypeScript types
```

## Programmatic Usage

```typescript
import {
  InitializerAgent,
  CodingAgent,
  DEFAULT_AGENT_CONFIG,
  buildMCPServers,
} from 'dev-agent-harness';

// Initialize a project
const initializer = new InitializerAgent(DEFAULT_AGENT_CONFIG);
await initializer.initialize({
  projectName: 'my-app',
  description: 'A todo app with React',
  workspacePath: './workspace',
  onOutput: (text) => console.log(text),
});

// Run a coding session
const agent = new CodingAgent(DEFAULT_AGENT_CONFIG);
const result = await agent.runSession({
  workspacePath: './workspace/my-app',
  maxTurns: 50,
  supabaseProjectRef: 'your-project-ref', // Optional: Supabase project
  onOutput: (text) => console.log(text),
});

console.log(result.success ? 'Feature completed!' : 'Feature incomplete');

// Custom MCP configuration
const mcpServers = buildMCPServers({
  supabaseProjectRef: 'custom-project-ref',
});
```

## Tips

1. **Start small**: Begin with simple projects to understand the flow
2. **Review progress.log**: Check what Claude did in previous sessions
3. **Use reset sparingly**: Only reset if you want to re-implement features
4. **Monitor sessions**: Watch the output to catch any issues early

## Troubleshooting

### "ANTHROPIC_API_KEY not found"
Make sure your API key is set:
```bash
export ANTHROPIC_API_KEY="your-api-key-here"
```

### "No feature_list.json found"
Make sure you're in a project directory created with `harness init`.

### Features not being marked complete
The agent should update `feature_list.json` automatically. Check the progress.log for details.

## License

MIT
