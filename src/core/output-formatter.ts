import chalk from 'chalk';

/**
 * Seções de output do agente
 */
enum Section {
  EXPLORING = 'exploring',  // 🔍 Lendo arquivos, buscando código
  EDITING = 'editing',      // ✏️  Editando, criando arquivos
  RUNNING = 'running',      // 🚀 Executando comandos bash
  PLANNING = 'planning',    // 💭 Pensando, planejando
}

/**
 * Padrões regex para detectar cada tipo de seção no texto do Claude
 */
const SECTION_PATTERNS: Record<Section, RegExp[]> = {
  [Section.EXPLORING]: [
    /Let me (?:first |now )?(?:examine|read|check|look at|explore|search)/i,
    /I'll (?:first |now )?(?:examine|read|check|look at|explore|search)/i,
    /Reading|Examining|Exploring|Checking/i,
  ],
  [Section.EDITING]: [
    /Let me (?:now )?(?:edit|modify|update|change|create|write)/i,
    /I'll (?:now )?(?:edit|modify|update|change|create|write)/i,
    /(?:Creating|Editing|Modifying|Updating|Writing) (?:the |a )?file/i,
  ],
  [Section.RUNNING]: [
    /(?:Let me|I'll) (?:now )?(?:run|execute) (?:the )?command/i,
    /Running|Executing/i,
  ],
  [Section.PLANNING]: [
    /Let me (?:first )?(?:plan|think|consider|analyze)/i,
    /I'll (?:first )?(?:plan|outline|design)/i,
  ],
};

/**
 * Formatador de output streaming que detecta transições de contexto
 * e adiciona headers coloridos para organizar visualmente o terminal
 */
class OutputFormatter {
  private currentSection: Section | null = null;
  private buffer: string = '';
  private readonly MAX_BUFFER_SIZE = 500;

  /**
   * Formata um chunk de texto detectando transições de seção
   * @param chunk Chunk de texto recebido do streaming
   * @returns Texto formatado com headers de seção quando apropriado
   */
  formatText(chunk: string): string {
    // Adiciona ao buffer
    this.buffer += chunk;

    // Limita tamanho do buffer (mantém últimos 500 chars para performance)
    if (this.buffer.length > this.MAX_BUFFER_SIZE) {
      this.buffer = this.buffer.slice(-this.MAX_BUFFER_SIZE);
    }

    // Detecta seção atual baseado nos padrões
    const detectedSection = this.detectSection();

    // Se detectou nova seção diferente da atual, insere header
    if (detectedSection && detectedSection !== this.currentSection) {
      const header = this.getSectionHeader(detectedSection);
      this.currentSection = detectedSection;
      return header + chunk;
    }

    // Retorna chunk sem modificação
    return chunk;
  }

  /**
   * Detecta qual seção está ativa baseado nos padrões no buffer
   * @returns Seção detectada ou null se nenhuma match
   */
  private detectSection(): Section | null {
    // Testa cada padrão de cada seção
    for (const [section, patterns] of Object.entries(SECTION_PATTERNS)) {
      for (const pattern of patterns) {
        if (pattern.test(this.buffer)) {
          return section as Section;
        }
      }
    }
    return null;
  }

  /**
   * Gera header colorido para uma seção
   * @param section Seção para gerar header
   * @returns String com header formatado (cor + ícone + label)
   */
  private getSectionHeader(section: Section): string {
    const headers: Record<Section, string> = {
      [Section.EXPLORING]: chalk.cyan('\n\n🔍 Exploring\n'),
      [Section.EDITING]: chalk.green('\n\n✏️  Editing\n'),
      [Section.RUNNING]: chalk.blue('\n\n🚀 Running Commands\n'),
      [Section.PLANNING]: chalk.magenta('\n\n💭 Planning\n'),
    };

    return headers[section] || '';
  }

  /**
   * Reseta o estado do formatter (útil entre sessões)
   */
  reset(): void {
    this.currentSection = null;
    this.buffer = '';
  }
}

/**
 * Factory function para criar uma nova instância do OutputFormatter
 * @returns Nova instância de OutputFormatter
 */
export function createOutputFormatter(): OutputFormatter {
  return new OutputFormatter();
}
