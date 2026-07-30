import { SaxesParser } from 'saxes';
import { ContentError, fail } from './diagnostics';

export interface XmlTextNode {
  type: 'text';
  value: string;
  line: number;
  column: number;
}

export interface XmlElementNode {
  type: 'element';
  name: string;
  attributes: Record<string, string>;
  children: XmlNode[];
  line: number;
  column: number;
}

export type XmlNode = XmlTextNode | XmlElementNode;

const MAX_XML_BYTES = 2 * 1024 * 1024;

export function parseXml(source: string, sourcePath: string): XmlElementNode {
  if (Buffer.byteLength(source, 'utf8') > MAX_XML_BYTES) {
    fail(`XML source exceeds the ${MAX_XML_BYTES} byte limit`, { source: sourcePath });
  }

  const parser = new SaxesParser({ xmlns: false, position: true });
  const roots: XmlElementNode[] = [];
  const stack: XmlElementNode[] = [];
  let parserError: Error | undefined;
  let rejectedConstruct: ContentError | undefined;

  parser.on('doctype', () => {
    rejectedConstruct = new ContentError('DOCTYPE declarations are not allowed', {
      source: sourcePath,
      line: parser.line,
      column: parser.column,
    });
  });

  parser.on('processinginstruction', () => {
    rejectedConstruct = new ContentError('Processing instructions are not allowed', {
      source: sourcePath,
      line: parser.line,
      column: parser.column,
    });
  });

  parser.on('cdata', () => {
    rejectedConstruct = new ContentError('CDATA sections are not allowed', {
      source: sourcePath,
      line: parser.line,
      column: parser.column,
    });
  });

  parser.on('opentag', (tag) => {
    const attributes: Record<string, string> = {};

    for (const [name, rawValue] of Object.entries(tag.attributes)) {
      const value = typeof rawValue === 'string' ? rawValue : String(rawValue);
      assertNfc(value, sourcePath, parser.line, parser.column, tag.name, name);
      attributes[name] = value;
    }

    const element: XmlElementNode = {
      type: 'element',
      name: tag.name,
      attributes,
      children: [],
      line: parser.line,
      column: parser.column,
    };

    const parent = stack.at(-1);
    if (parent) {
      parent.children.push(element);
    } else {
      roots.push(element);
    }

    stack.push(element);
  });

  parser.on('text', (value) => {
    assertNfc(value, sourcePath, parser.line, parser.column);
    const parent = stack.at(-1);

    if (!parent) {
      if (value.trim().length > 0) {
        rejectedConstruct = new ContentError('Text outside the root element is not allowed', {
          source: sourcePath,
          line: parser.line,
          column: parser.column,
        });
      }
      return;
    }

    parent.children.push({
      type: 'text',
      value,
      line: parser.line,
      column: parser.column,
    });
  });

  parser.on('closetag', () => {
    stack.pop();
  });

  parser.on('error', (error) => {
    parserError = error;
  });

  parser.write(source).close();

  if (rejectedConstruct) {
    throw rejectedConstruct;
  }

  if (parserError) {
    throw new ContentError(parserError.message, {
      source: sourcePath,
      line: parser.line,
      column: parser.column,
    });
  }

  if (roots.length !== 1) {
    fail('XML source must contain exactly one root element', { source: sourcePath });
  }

  return roots[0];
}

function assertNfc(
  value: string,
  source: string,
  line: number,
  column: number,
  element?: string,
  attribute?: string,
): void {
  if (value !== value.normalize('NFC')) {
    fail('Text must be normalized to Unicode NFC', { source, line, column, element, attribute });
  }
}

export function elementChildren(element: XmlElementNode): XmlElementNode[] {
  return element.children.filter((child): child is XmlElementNode => child.type === 'element');
}

export function assertNoMixedText(element: XmlElementNode, source: string): void {
  const invalidText = element.children.find((child) => child.type === 'text' && child.value.trim().length > 0);
  if (invalidText) {
    fail('Text is not allowed at this location', {
      source,
      line: invalidText.line,
      column: invalidText.column,
      element: element.name,
    });
  }
}

export function assertAttributes(element: XmlElementNode, source: string, allowed: readonly string[]): void {
  for (const name of Object.keys(element.attributes)) {
    if (!allowed.includes(name)) {
      fail('Attribute is not allowed', {
        source,
        line: element.line,
        column: element.column,
        element: element.name,
        attribute: name,
      });
    }
  }
}

export function requiredAttribute(element: XmlElementNode, source: string, name: string): string {
  const value = element.attributes[name]?.trim();
  if (!value) {
    fail('Required attribute is missing or empty', {
      source,
      line: element.line,
      column: element.column,
      element: element.name,
      attribute: name,
    });
  }
  return value;
}

export function optionalAttribute(element: XmlElementNode, name: string): string | undefined {
  const value = element.attributes[name]?.trim();
  return value || undefined;
}

export function plainText(element: XmlElementNode, source: string): string {
  const nested = element.children.find((child) => child.type === 'element');
  if (nested) {
    fail('Nested elements are not allowed here', {
      source,
      line: nested.line,
      column: nested.column,
      element: element.name,
    });
  }

  const value = element.children
    .filter((child): child is XmlTextNode => child.type === 'text')
    .map((child) => child.value)
    .join('')
    .replace(/\s+/g, ' ')
    .trim();

  if (!value) {
    fail('Text content is required', {
      source,
      line: element.line,
      column: element.column,
      element: element.name,
    });
  }

  return value;
}

export function singleChild(element: XmlElementNode, source: string, name: string): XmlElementNode {
  const matches = elementChildren(element).filter((child) => child.name === name);
  if (matches.length !== 1) {
    fail(`Expected exactly one <${name}> child`, {
      source,
      line: element.line,
      column: element.column,
      element: element.name,
    });
  }
  return matches[0];
}
