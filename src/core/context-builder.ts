import { readFile, readdir, stat } from 'node:fs/promises';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import type { Feature, FeatureList, SessionContext } from '../types/index.js';

const execAsync = promisify(exec);

export class ContextBuilder {
  private workspacePath: string;

  constructor(workspacePath: string) {
    this.workspacePath = workspacePath;
  }

  get featureListPath(): string {
    return join(this.workspacePath, 'feature_list.json');
  }

  get progressLogPath(): string {
    return join(this.workspacePath, 'progress.log');
  }

  async loadFeatureList(): Promise<FeatureList | null> {
    const path = this.featureListPath;
    if (!existsSync(path)) {
      return null;
    }

    try {
      const content = await readFile(path, 'utf-8');
      return JSON.parse(content) as FeatureList;
    } catch {
      return null;
    }
  }

  async saveFeatureList(featureList: FeatureList): Promise<void> {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(
      this.featureListPath,
      JSON.stringify(featureList, null, 2),
      'utf-8'
    );
  }

  async getNextFeature(): Promise<Feature | null> {
    const featureList = await this.loadFeatureList();
    if (!featureList) {
      return null;
    }

    return featureList.features.find((f) => !f.passes) ?? null;
  }

  /**
   * Get next incomplete feature of specific type
   */
  async getNextFeatureByType(type: string): Promise<Feature | null> {
    const featureList = await this.loadFeatureList();
    if (!featureList) {
      return null;
    }

    return (
      featureList.features.find(
        (f) => !f.passes && (f.type === type || (!f.type && type === 'feature'))
      ) ?? null
    );
  }

  async getProgressStats(): Promise<{
    total: number;
    completed: number;
    pending: number;
    percentage: number;
  }> {
    const featureList = await this.loadFeatureList();
    if (!featureList) {
      return { total: 0, completed: 0, pending: 0, percentage: 0 };
    }

    const total = featureList.features.length;
    const completed = featureList.features.filter((f) => f.passes).length;
    const pending = total - completed;
    const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;

    return { total, completed, pending, percentage };
  }

  /**
   * Get progress statistics with type breakdown
   */
  async getProgressStatsByType(): Promise<{
    total: number;
    completed: number;
    pending: number;
    percentage: number;
    byType: Record<string, { completed: number; pending: number }>;
  }> {
    const featureList = await this.loadFeatureList();
    if (!featureList) {
      return {
        total: 0,
        completed: 0,
        pending: 0,
        percentage: 0,
        byType: {},
      };
    }

    const total = featureList.features.length;
    const completed = featureList.features.filter((f) => f.passes).length;
    const pending = total - completed;
    const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;

    // Build type breakdown
    const byType: Record<string, { completed: number; pending: number }> = {};

    for (const feature of featureList.features) {
      const type = feature.type || 'feature';
      if (!byType[type]) {
        byType[type] = { completed: 0, pending: 0 };
      }
      if (feature.passes) {
        byType[type].completed++;
      } else {
        byType[type].pending++;
      }
    }

    return { total, completed, pending, percentage, byType };
  }

  async getProgressLog(lastN: number = 10): Promise<string> {
    const path = this.progressLogPath;
    if (!existsSync(path)) {
      return '';
    }

    try {
      const content = await readFile(path, 'utf-8');
      const lines = content.trim().split('\n\n');
      return lines.slice(-lastN).join('\n\n');
    } catch {
      return '';
    }
  }

  async getGitLog(lastN: number = 10): Promise<string> {
    try {
      const { stdout } = await execAsync(
        `git log --oneline -${lastN}`,
        { cwd: this.workspacePath }
      );
      return stdout.trim();
    } catch {
      return '(no git history)';
    }
  }

  async getProjectStructure(maxDepth: number = 3): Promise<string> {
    const lines: string[] = [];

    const walk = async (dir: string, depth: number, prefix: string) => {
      if (depth > maxDepth) return;

      try {
        const entries = await readdir(dir, { withFileTypes: true });

        // Sort: directories first, then files
        const sorted = entries.sort((a, b) => {
          if (a.isDirectory() && !b.isDirectory()) return -1;
          if (!a.isDirectory() && b.isDirectory()) return 1;
          return a.name.localeCompare(b.name);
        });

        for (let i = 0; i < sorted.length; i++) {
          const entry = sorted[i];
          if (!entry) continue;

          // Skip common non-essential directories
          if (['node_modules', '.git', 'dist', '.next', '__pycache__'].includes(entry.name)) {
            continue;
          }

          const isLast = i === sorted.length - 1;
          const connector = isLast ? '└── ' : '├── ';
          const extension = isLast ? '    ' : '│   ';

          if (entry.isDirectory()) {
            lines.push(`${prefix}${connector}${entry.name}/`);
            await walk(join(dir, entry.name), depth + 1, prefix + extension);
          } else {
            lines.push(`${prefix}${connector}${entry.name}`);
          }
        }
      } catch {
        // Ignore permission errors
      }
    };

    lines.push('./');
    await walk(this.workspacePath, 1, '');

    return lines.join('\n');
  }

  async buildSessionContext(): Promise<SessionContext | null> {
    const feature = await this.getNextFeature();
    if (!feature) {
      return null;
    }

    const [progressLog, gitLog, projectStructure] = await Promise.all([
      this.getProgressLog(10),
      this.getGitLog(10),
      this.getProjectStructure(3),
    ]);

    return {
      feature,
      progressLog,
      gitLog,
      projectStructure,
      relevantFiles: [], // Can be populated if needed
    };
  }

  async appendToProgressLog(entry: string): Promise<void> {
    const { appendFile, writeFile } = await import('node:fs/promises');
    const path = this.progressLogPath;

    if (!existsSync(path)) {
      await writeFile(path, entry, 'utf-8');
    } else {
      await appendFile(path, '\n\n' + entry, 'utf-8');
    }
  }

  async initializeGit(): Promise<void> {
    const gitDir = join(this.workspacePath, '.git');
    if (existsSync(gitDir)) {
      return;
    }

    await execAsync('git init', { cwd: this.workspacePath });
    await execAsync('git add -A', { cwd: this.workspacePath });
    await execAsync('git commit -m "Initial commit: project setup"', {
      cwd: this.workspacePath,
    });
  }
}
