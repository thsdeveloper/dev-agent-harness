import { exec, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile, unlink, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AgentConfig } from '../types/index.js';

const execAsync = promisify(exec);

export interface ClaudeCodeOptions {
  systemPrompt: string;
  workingDirectory: string;
  allowedTools?: string[] | undefined;
  onOutput?: ((text: string) => void) | undefined;
  maxTurns?: number | undefined;
}

export interface ClaudeCodeResult {
  success: boolean;
  output: string;
  error?: string | undefined;
}

/**
 * Client that uses Claude Code CLI as the backend.
 * This leverages your Claude Max subscription instead of API credits.
 */
export class ClaudeCodeClient {
  private config: AgentConfig;

  constructor(config: AgentConfig) {
    this.config = config;
  }

  /**
   * Run Claude Code with the given prompt and options.
   * Creates a temp script to handle complex prompts properly.
   */
  async run(
    prompt: string,
    options: ClaudeCodeOptions
  ): Promise<ClaudeCodeResult> {
    const {
      systemPrompt,
      workingDirectory,
      onOutput,
    } = options;

    // Create temp files
    const tempId = randomUUID().slice(0, 8);
    const systemPromptFile = join(tmpdir(), `claude-sys-${tempId}.txt`);
    const promptFile = join(tmpdir(), `claude-prompt-${tempId}.txt`);
    const scriptFile = join(tmpdir(), `claude-run-${tempId}.sh`);

    try {
      // Write prompts to temp files
      await writeFile(systemPromptFile, systemPrompt, 'utf-8');
      await writeFile(promptFile, prompt, 'utf-8');

      // Create a bash script that runs claude
      // Note: Remove --dangerously-skip-permissions if you want tool approval prompts
      const script = `#!/bin/bash
set -e
cd "${workingDirectory}"
SYSTEM_PROMPT=$(cat "${systemPromptFile}")
USER_PROMPT=$(cat "${promptFile}")
exec claude --print --output-format text --append-system-prompt "$SYSTEM_PROMPT" "$USER_PROMPT"
`;
      await writeFile(scriptFile, script, 'utf-8');
      await chmod(scriptFile, 0o755);

      if (onOutput) {
        onOutput('[Harness] Starting Claude Code session...\n');
      }

      return new Promise((resolve) => {
        const proc = spawn('bash', [scriptFile], {
          cwd: workingDirectory,
          stdio: ['pipe', 'pipe', 'pipe'],
          env: process.env,
        });

        let output = '';
        let errorOutput = '';

        proc.stdout.on('data', (data: Buffer) => {
          const text = data.toString();
          output += text;
          if (onOutput) {
            onOutput(text);
          }
        });

        proc.stderr.on('data', (data: Buffer) => {
          const text = data.toString();
          errorOutput += text;
        });

        proc.on('close', async (code) => {
          await this.cleanupTempFiles(systemPromptFile, promptFile, scriptFile);

          if (code === 0) {
            resolve({
              success: true,
              output: output.trim(),
            });
          } else {
            resolve({
              success: false,
              output: output.trim(),
              error: errorOutput || `Process exited with code ${code}`,
            });
          }
        });

        proc.on('error', async (err) => {
          await this.cleanupTempFiles(systemPromptFile, promptFile, scriptFile);
          resolve({
            success: false,
            output: '',
            error: `Failed to run script: ${err.message}`,
          });
        });
      });
    } catch (error) {
      await this.cleanupTempFiles(systemPromptFile, promptFile, scriptFile);
      return {
        success: false,
        output: '',
        error: `Setup failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  private async cleanupTempFiles(...files: string[]): Promise<void> {
    for (const file of files) {
      try {
        await unlink(file);
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}

/**
 * Check if Claude Code CLI is available.
 */
export async function isClaudeCodeAvailable(): Promise<boolean> {
  try {
    await execAsync('claude --version');
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if we're running inside a Claude Code session.
 * This can cause issues when trying to spawn another claude process.
 */
export async function isInsideClaudeSession(): Promise<boolean> {
  // Check for Claude Code environment variable (most reliable)
  if (process.env['CLAUDE_CODE_ENTRY_POINT']) {
    return true;
  }

  // Check if parent process is claude (indicates we're spawned from claude)
  try {
    const ppid = process.ppid;
    const { stdout } = await execAsync(`ps -p ${ppid} -o comm= 2>/dev/null`);
    const parentName = stdout.trim().toLowerCase();
    if (parentName.includes('claude')) {
      return true;
    }
  } catch {
    // Ignore errors
  }

  return false;
}
