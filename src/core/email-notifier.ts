/**
 * Email Notifier Module
 * Envia notificações por e-mail quando processos do harness são concluídos
 */

import { createTransport, type Transporter } from 'nodemailer';
import type { SessionResult, FeatureList, Feature } from '../types/index.js';

// ============================================
// Tipos
// ============================================

export interface EmailConfig {
  host: string;
  port: number;
  secure: boolean;
  auth: {
    user: string;
    pass: string;
  };
  from: string;
  to: string;
}

export interface RunCompletionData {
  type: 'run';
  projectName: string;
  projectPath: string;
  result: SessionResult;
  feature: Feature;
  stats: {
    completed: number;
    total: number;
    percentage: number;
  };
  duration?: number;
}

export interface LoopCompletionData {
  type: 'loop';
  projectName: string;
  projectPath: string;
  totalSessions: number;
  successfulSessions: number;
  failedSessions: number;
  stats: {
    completed: number;
    total: number;
    percentage: number;
  };
  duration?: number | undefined;
  stoppedReason: 'all_complete' | 'max_sessions' | 'error';
  lastError?: string | undefined;
}

export type CompletionData = RunCompletionData | LoopCompletionData;

// ============================================
// Configuração
// ============================================

/**
 * Verifica se a configuração de e-mail está disponível
 */
export function isEmailConfigured(): boolean {
  return !!(
    process.env['SMTP_HOST'] &&
    process.env['SMTP_USER'] &&
    process.env['SMTP_PASS'] &&
    process.env['NOTIFICATION_EMAIL']
  );
}

/**
 * Obtém a configuração de e-mail das variáveis de ambiente
 */
export function getEmailConfig(): EmailConfig | null {
  const host = process.env['SMTP_HOST'];
  const port = parseInt(process.env['SMTP_PORT'] || '587', 10);
  const secure = process.env['SMTP_SECURE'] === 'true';
  const user = process.env['SMTP_USER'];
  const pass = process.env['SMTP_PASS'];
  const from = process.env['SMTP_FROM'] || user;
  const to = process.env['NOTIFICATION_EMAIL'];

  if (!host || !user || !pass || !to || !from) {
    return null;
  }

  return {
    host,
    port,
    secure,
    auth: { user, pass },
    from,
    to,
  };
}

// ============================================
// Email Notifier Class
// ============================================

export class EmailNotifier {
  private transporter: Transporter | null = null;
  private config: EmailConfig | null = null;

  constructor() {
    this.config = getEmailConfig();
    if (this.config) {
      this.transporter = createTransport({
        host: this.config.host,
        port: this.config.port,
        secure: this.config.secure,
        auth: this.config.auth,
      });
    }
  }

  /**
   * Verifica se o notificador está configurado
   */
  isConfigured(): boolean {
    return this.transporter !== null && this.config !== null;
  }

  /**
   * Envia notificação de conclusão do comando run
   */
  async notifyRunCompletion(data: RunCompletionData): Promise<boolean> {
    if (!this.isConfigured() || !this.config) {
      return false;
    }

    const statusEmoji = data.result.success ? '✅' : '⚠️';
    const statusText = data.result.success ? 'Sucesso' : 'Incompleta';

    const subject = `${statusEmoji} Harness Run: ${data.feature.id} - ${statusText}`;

    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: ${data.result.success ? '#10b981' : '#f59e0b'}; color: white; padding: 20px; border-radius: 8px 8px 0 0; }
    .content { background: #f9fafb; padding: 20px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px; }
    .stat { display: inline-block; margin-right: 20px; }
    .stat-value { font-size: 24px; font-weight: bold; color: #1f2937; }
    .stat-label { font-size: 12px; color: #6b7280; text-transform: uppercase; }
    .feature-box { background: white; padding: 15px; border-radius: 6px; margin: 15px 0; border: 1px solid #e5e7eb; }
    .progress-bar { background: #e5e7eb; border-radius: 4px; height: 8px; margin: 10px 0; }
    .progress-fill { background: #10b981; height: 100%; border-radius: 4px; }
    code { background: #f3f4f6; padding: 2px 6px; border-radius: 4px; font-size: 13px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1 style="margin: 0;">${statusEmoji} Sessão ${statusText}</h1>
      <p style="margin: 10px 0 0 0; opacity: 0.9;">${data.projectName}</p>
    </div>
    <div class="content">
      <div class="feature-box">
        <h3 style="margin: 0 0 10px 0;">Feature: ${data.feature.id}</h3>
        <p style="margin: 0; font-weight: 500;">${data.feature.title}</p>
        <p style="margin: 10px 0 0 0; color: #6b7280; font-size: 14px;">${data.feature.description}</p>
        ${data.result.commitHash ? `<p style="margin: 10px 0 0 0;"><code>Commit: ${data.result.commitHash}</code></p>` : ''}
        ${data.result.error ? `<p style="margin: 10px 0 0 0; color: #dc2626;">Erro: ${data.result.error}</p>` : ''}
      </div>

      <h3>Progresso do Projeto</h3>
      <div class="progress-bar">
        <div class="progress-fill" style="width: ${data.stats.percentage}%;"></div>
      </div>
      <p style="color: #6b7280; margin: 5px 0;">
        ${data.stats.completed} de ${data.stats.total} features completas (${data.stats.percentage}%)
      </p>

      ${data.duration ? `<p style="color: #6b7280; font-size: 14px;">Duração: ${formatDuration(data.duration)}</p>` : ''}

      <p style="color: #9ca3af; font-size: 12px; margin-top: 20px;">
        Projeto: <code>${data.projectPath}</code>
      </p>
    </div>
  </div>
</body>
</html>
    `;

    const text = `
Harness Run ${statusText}
========================

Projeto: ${data.projectName}
Feature: ${data.feature.id} - ${data.feature.title}
Status: ${statusText}
${data.result.commitHash ? `Commit: ${data.result.commitHash}` : ''}
${data.result.error ? `Erro: ${data.result.error}` : ''}

Progresso: ${data.stats.completed}/${data.stats.total} features (${data.stats.percentage}%)
${data.duration ? `Duração: ${formatDuration(data.duration)}` : ''}

Caminho: ${data.projectPath}
    `;

    return await this.sendEmail(subject, html, text);
  }

  /**
   * Envia notificação de conclusão do comando loop
   */
  async notifyLoopCompletion(data: LoopCompletionData): Promise<boolean> {
    if (!this.isConfigured() || !this.config) {
      return false;
    }

    const allComplete = data.stoppedReason === 'all_complete';
    const statusEmoji = allComplete ? '🎉' : data.stoppedReason === 'error' ? '❌' : '⏹️';
    const statusText = allComplete ? 'Todas as Features Completas!' :
                       data.stoppedReason === 'error' ? 'Erro no Loop' :
                       'Limite de Sessões Atingido';

    const subject = `${statusEmoji} Harness Loop Concluído - ${data.projectName}`;

    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: ${allComplete ? '#10b981' : '#6366f1'}; color: white; padding: 20px; border-radius: 8px 8px 0 0; }
    .content { background: #f9fafb; padding: 20px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px; }
    .stats-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; margin: 20px 0; }
    .stat-box { background: white; padding: 15px; border-radius: 6px; text-align: center; border: 1px solid #e5e7eb; }
    .stat-value { font-size: 28px; font-weight: bold; color: #1f2937; }
    .stat-label { font-size: 12px; color: #6b7280; text-transform: uppercase; margin-top: 5px; }
    .progress-bar { background: #e5e7eb; border-radius: 4px; height: 10px; margin: 10px 0; }
    .progress-fill { background: #10b981; height: 100%; border-radius: 4px; }
    .success { color: #10b981; }
    .warning { color: #f59e0b; }
    .error { color: #dc2626; }
    code { background: #f3f4f6; padding: 2px 6px; border-radius: 4px; font-size: 13px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1 style="margin: 0;">${statusEmoji} ${statusText}</h1>
      <p style="margin: 10px 0 0 0; opacity: 0.9;">${data.projectName}</p>
    </div>
    <div class="content">
      <div class="stats-grid">
        <div class="stat-box">
          <div class="stat-value">${data.totalSessions}</div>
          <div class="stat-label">Sessões</div>
        </div>
        <div class="stat-box">
          <div class="stat-value success">${data.successfulSessions}</div>
          <div class="stat-label">Sucesso</div>
        </div>
        <div class="stat-box">
          <div class="stat-value ${data.failedSessions > 0 ? 'warning' : ''}">${data.failedSessions}</div>
          <div class="stat-label">Incompletas</div>
        </div>
      </div>

      <h3>Progresso Final</h3>
      <div class="progress-bar">
        <div class="progress-fill" style="width: ${data.stats.percentage}%;"></div>
      </div>
      <p style="color: #6b7280; margin: 5px 0;">
        ${data.stats.completed} de ${data.stats.total} features completas (${data.stats.percentage}%)
      </p>

      ${data.lastError ? `<p class="error" style="margin-top: 15px;">Último erro: ${data.lastError}</p>` : ''}
      ${data.duration ? `<p style="color: #6b7280; font-size: 14px; margin-top: 15px;">Duração total: ${formatDuration(data.duration)}</p>` : ''}

      <p style="color: #9ca3af; font-size: 12px; margin-top: 20px;">
        Projeto: <code>${data.projectPath}</code>
      </p>
    </div>
  </div>
</body>
</html>
    `;

    const text = `
Harness Loop Concluído
======================

${statusText}

Projeto: ${data.projectName}
Sessões executadas: ${data.totalSessions}
Sessões com sucesso: ${data.successfulSessions}
Sessões incompletas: ${data.failedSessions}

Progresso Final: ${data.stats.completed}/${data.stats.total} features (${data.stats.percentage}%)
${data.lastError ? `Último erro: ${data.lastError}` : ''}
${data.duration ? `Duração total: ${formatDuration(data.duration)}` : ''}

Caminho: ${data.projectPath}
    `;

    return await this.sendEmail(subject, html, text);
  }

  /**
   * Envia um e-mail
   */
  private async sendEmail(subject: string, html: string, text: string): Promise<boolean> {
    if (!this.transporter || !this.config) {
      return false;
    }

    try {
      await this.transporter.sendMail({
        from: this.config.from,
        to: this.config.to,
        subject,
        text,
        html,
      });
      return true;
    } catch (error) {
      console.error('Erro ao enviar e-mail:', error instanceof Error ? error.message : error);
      return false;
    }
  }

  /**
   * Testa a conexão SMTP
   */
  async testConnection(): Promise<boolean> {
    if (!this.transporter) {
      return false;
    }

    try {
      await this.transporter.verify();
      return true;
    } catch {
      return false;
    }
  }
}

// ============================================
// Helpers
// ============================================

/**
 * Formata duração em milissegundos para string legível
 */
function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

// ============================================
// Singleton Instance
// ============================================

let notifierInstance: EmailNotifier | null = null;

/**
 * Obtém a instância do notificador de e-mail
 */
export function getEmailNotifier(): EmailNotifier {
  if (!notifierInstance) {
    notifierInstance = new EmailNotifier();
  }
  return notifierInstance;
}
