// ============================================
// Feature & Project Types
// ============================================

export type FeatureType = 'feature' | 'refactoring' | 'bugfix' | 'improvement' | 'docs';

export type TargetType = 'web' | 'mobile' | 'shared' | 'full' | 'backend' | 'api';

export interface Feature {
  id: string;
  title: string;
  description: string;
  acceptance_criteria: string[];
  passes: boolean;
  type?: FeatureType; // Optional for backward compatibility
  target?: TargetType; // Optional: web, mobile, shared, full, backend, api
}

export interface FeatureList {
  project_name: string;
  description: string;
  tech_stack?: string[];
  features: Feature[];
}

export interface ProjectConfig {
  name: string;
  description: string;
  workspacePath: string;
  featureListPath: string;
  progressLogPath: string;
}

// ============================================
// Session & Context Types
// ============================================

export interface SessionContext {
  feature: Feature;
  progressLog: string;
  gitLog: string;
  projectStructure: string;
  relevantFiles: FileContent[];
}

export interface FileContent {
  path: string;
  content: string;
}

export interface SessionResult {
  success: boolean;
  featureId: string;
  commitHash?: string | undefined;
  error?: string | undefined;
  progressEntry: string;
}

// ============================================
// Agent Types
// ============================================

export interface AgentConfig {
  model: string;
  maxTokens: number;
  temperature?: number | undefined;
}

export const DEFAULT_AGENT_CONFIG: AgentConfig = {
  model: 'claude-sonnet-4-20250514', // Not used directly, but for reference
  maxTokens: 8192,
  temperature: 0,
};

// ============================================
// CLI Types
// ============================================

export interface InitOptions {
  description: string;
  techStack?: string[] | undefined;
}

export interface RunOptions {
  maxTurns?: number | undefined;
}

export interface LoopOptions {
  maxSessions?: number | undefined;
  maxTurns?: number | undefined;
}
