export interface DiagnosticContext {
  source: string;
  line?: number;
  column?: number;
  element?: string;
  attribute?: string;
  target?: string;
}

export class ContentError extends Error {
  readonly context: DiagnosticContext;

  constructor(message: string, context: DiagnosticContext) {
    super(message);
    this.name = 'ContentError';
    this.context = context;
  }

  format(): string {
    const { source, line, column, element, attribute, target } = this.context;
    const position = line === undefined ? source : `${source}:${line}:${column ?? 1}`;
    const details = [
      element ? `element=<${element}>` : undefined,
      attribute ? `attribute=${attribute}` : undefined,
      target ? `target=${target}` : undefined,
    ].filter(Boolean);

    return `${position} ${this.message}${details.length > 0 ? ` (${details.join(', ')})` : ''}`;
  }
}

export function fail(message: string, context: DiagnosticContext): never {
  throw new ContentError(message, context);
}
