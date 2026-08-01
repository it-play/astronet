import { BOARD_DIAGRAM_LAYOUTS, BOARD_GRID_LAYOUTS, BOARD_THEMES } from '../../src/content/board-registry';
import {
  DOCUMENT_ID_PATTERN,
  RESOURCE_ID_PATTERN,
  SECTION_ID_PATTERN,
  normalizeText,
} from '../../src/content/shared';
import { fail } from './diagnostics';
import {
  assertAttributes,
  assertNoMixedText,
  elementChildren,
  optionalAttribute,
  plainText,
  requiredAttribute,
  singleChild,
  type XmlElementNode,
  type XmlNode,
} from './xml';

interface Located {
  source: string;
  line: number;
  column: number;
}

export type InlineNode =
  | (Located & { type: 'text'; value: string })
  | (Located & { type: 'em' | 'strong' | 'code'; children: InlineNode[] })
  | (Located & { type: 'ref'; targetId: string; sectionId?: string; children: InlineNode[] })
  | (Located & { type: 'external'; href: string; children: InlineNode[] })
  | (Located & { type: 'footnote'; children: FootnoteInlineNode[] });

export type FootnoteInlineNode = Exclude<InlineNode, Located & { type: 'footnote' }>;

export interface SectionBlock extends Located {
  type: 'section';
  stableId?: string;
  title: string;
  blocks: BlockNode[];
}

export interface ParagraphBlock extends Located {
  type: 'paragraph';
  children: InlineNode[];
}

export interface ListBlock extends Located {
  type: 'list';
  ordered: boolean;
  items: InlineNode[][];
}

export interface QuoteBlock extends Located {
  type: 'quote';
  blocks: BlockNode[];
}

export interface CodeBlock extends Located {
  type: 'code-block';
  language?: string;
  code: string;
}

export interface TableBlock extends Located {
  type: 'table';
  head: InlineNode[][];
  rows: InlineNode[][][];
}

export interface FigureBlock extends Located {
  type: 'figure';
  assetId: string;
  alt: string;
  decorative: boolean;
  targetId?: string;
  caption?: InlineNode[];
}

export interface VideoBlock extends Located {
  type: 'video';
  label: string;
  assetId?: string;
  provider?: 'youtube' | 'vimeo';
  videoId?: string;
  directUrl?: string;
  posterId?: string;
  trackId?: string;
  caption?: InlineNode[];
}

export interface BoardIncludeBlock extends Located {
  type: 'board';
  boardId: string;
}

export interface RuleBlock extends Located {
  type: 'rule';
}

export type BlockNode =
  | SectionBlock
  | ParagraphBlock
  | ListBlock
  | QuoteBlock
  | CodeBlock
  | TableBlock
  | FigureBlock
  | VideoBlock
  | BoardIncludeBlock
  | RuleBlock;

export interface SourceDocument extends Located {
  id: string;
  title: string;
  aliases: string[];
  tags: string[];
  connections: string[];
  body: BlockNode[];
}

export interface BoardEntry extends Located {
  targetId: string;
  label?: string;
  assetId?: string;
  icon?: string;
  accent?: string;
  slot?: string;
  retired: boolean;
}

export interface BoardRow extends Located {
  label: string;
  entries: BoardEntry[];
}

export interface BoardSection extends Located {
  id: string;
  label: string;
  group: string;
  assetId?: string;
  layout: 'links' | 'grid' | 'table' | 'diagram';
  layoutName?: string;
  entries: BoardEntry[];
  rows: BoardRow[];
}

export interface SourceBoard extends Located {
  id: string;
  theme: string;
  title: string;
  subtitle?: string;
  headerAssetId?: string;
  sections: BoardSection[];
}

const KOREAN_PATTERN = /[가-힣ㄱ-ㅎㅏ-ㅣ]/;
const CODE_LANGUAGE_PATTERN = /^[a-z0-9][a-z0-9_+.-]{0,31}$/;
const MAX_CODE_BLOCK_LENGTH = 32 * 1024;
const INLINE_ELEMENTS = new Set(['em', 'strong', 'code', 'ref', 'external', 'footnote']);
const BLOCK_ELEMENTS = new Set([
  'section',
  'p',
  'ul',
  'ol',
  'quote',
  'blockquote',
  'code-block',
  'table',
  'figure',
  'video-figure',
  'include-board',
  'hr',
]);

export function parseDocument(root: XmlElementNode, source: string): SourceDocument {
  if (root.name !== 'document') {
    fail('Document source root must be <document>', location(root, source));
  }

  assertAttributes(root, source, ['id']);
  assertNoMixedText(root, source);
  const id = parseDocumentId(requiredAttribute(root, source, 'id'), root, source, 'id');
  const children = elementChildren(root);
  assertAllowedChildren(root, source, children, ['title', 'aliases', 'tags', 'connections', 'body']);
  assertChildOrder(root, source, children, ['title', 'aliases', 'tags', 'connections', 'body']);

  const titleElement = singleChild(root, source, 'title');
  assertAttributes(titleElement, source, []);
  const title = limitedText(plainText(titleElement, source), 160, titleElement, source);
  if (!KOREAN_PATTERN.test(title)) {
    fail('Document title must contain Korean text', location(titleElement, source));
  }

  const aliases = parseTextCollection(root, source, 'aliases', 'alias', 160);
  const tags = parseTextCollection(root, source, 'tags', 'tag', 64);
  const connectionsElement = optionalSingleChild(root, source, 'connections');
  const connections = connectionsElement ? parseConnections(connectionsElement, source) : [];
  const bodyElement = singleChild(root, source, 'body');
  assertAttributes(bodyElement, source, []);
  assertNoMixedText(bodyElement, source);
  const body = parseBlocks(elementChildren(bodyElement), source);
  const stableSectionIds = new Set<string>();

  visitBlocks(body, (block) => {
    if (block.type !== 'section' || !block.stableId) return;
    if (stableSectionIds.has(block.stableId)) {
      fail('Stable section ID is duplicated within the document', {
        source,
        line: block.line,
        column: block.column,
        element: 'section',
        attribute: 'id',
        target: block.stableId,
      });
    }
    stableSectionIds.add(block.stableId);
  });

  return {
    ...location(root, source),
    id,
    title,
    aliases: uniqueValues(aliases, 'Alias is duplicated', source, titleElement),
    tags: uniqueValues(tags, 'Tag is duplicated', source, titleElement),
    connections: uniqueValues(connections, 'Manual connection is duplicated', source, connectionsElement ?? root),
    body,
  };
}

export function parseBoard(root: XmlElementNode, source: string): SourceBoard {
  if (root.name !== 'navigation-board') {
    fail('Board source root must be <navigation-board>', location(root, source));
  }

  assertAttributes(root, source, ['id', 'theme']);
  assertNoMixedText(root, source);
  const id = parseDocumentId(requiredAttribute(root, source, 'id'), root, source, 'id');
  const theme = optionalAttribute(root, 'theme') ?? 'default';
  if (!BOARD_THEMES.has(theme)) {
    fail('Board theme is not registered in application code', {
      ...location(root, source),
      element: root.name,
      attribute: 'theme',
      target: theme,
    });
  }

  const children = elementChildren(root);
  assertAllowedChildren(root, source, children, ['header', 'body', 'section']);
  if (children[0]?.name !== 'header') {
    fail('Navigation board must begin with a <header>', location(root, source));
  }
  const header = singleChild(root, source, 'header');
  const bodies = children.filter((child) => child.name === 'body');
  const sectionElements = children.filter((child) => child.name === 'section');
  if (bodies.length > 1 || (bodies.length > 0 && sectionElements.length > 0)) {
    fail('Navigation board must use either one <body> or one or more <section> elements', location(root, source));
  }
  const sections = (bodies.length > 0 ? bodies : sectionElements).map((section) => parseBoardSection(section, source));
  if (sections.length === 0) {
    fail('Navigation board requires one body or at least one section', location(root, source));
  }

  const sectionIds = new Set<string>();
  for (const section of sections) {
    if (sectionIds.has(section.id)) {
      fail('Board section ID is duplicated', {
        source,
        line: section.line,
        column: section.column,
        element: 'section',
        attribute: 'id',
        target: section.id,
      });
    }
    sectionIds.add(section.id);
  }

  assertAttributes(header, source, ['asset']);
  assertNoMixedText(header, source);
  assertAllowedChildren(header, source, elementChildren(header), ['title', 'subtitle']);
  const title = limitedText(plainText(singleChild(header, source, 'title'), source), 160, header, source);
  const subtitleElement = optionalSingleChild(header, source, 'subtitle');

  return {
    ...location(root, source),
    id,
    theme,
    title,
    subtitle: subtitleElement ? limitedText(plainText(subtitleElement, source), 240, subtitleElement, source) : undefined,
    headerAssetId: parseOptionalResourceId(optionalAttribute(header, 'asset'), header, source, 'asset'),
    sections,
  };
}

function parseBlocks(elements: XmlElementNode[], source: string): BlockNode[] {
  return elements.map((element) => parseBlock(element, source));
}

function parseBlock(element: XmlElementNode, source: string): BlockNode {
  if (!BLOCK_ELEMENTS.has(element.name)) {
    fail('Element is not allowed as block content', location(element, source));
  }

  switch (element.name) {
    case 'section':
      return parseSection(element, source);
    case 'p':
      assertAttributes(element, source, []);
      return { ...location(element, source), type: 'paragraph', children: requiredInline(element, source, true) };
    case 'ul':
    case 'ol':
      return parseList(element, source);
    case 'quote':
    case 'blockquote': {
      assertAttributes(element, source, []);
      assertNoMixedText(element, source);
      const blocks = parseBlocks(elementChildren(element), source);
      if (blocks.length === 0) fail('Quotation cannot be empty', location(element, source));
      return { ...location(element, source), type: 'quote', blocks };
    }
    case 'code-block':
      return parseCodeBlock(element, source);
    case 'table':
      return parseTable(element, source);
    case 'figure':
      return parseFigure(element, source);
    case 'video-figure':
      return parseVideo(element, source);
    case 'include-board': {
      assertAttributes(element, source, ['ref']);
      assertEmptyElement(element, source);
      return {
        ...location(element, source),
        type: 'board',
        boardId: parseDocumentId(requiredAttribute(element, source, 'ref'), element, source, 'ref'),
      };
    }
    case 'hr':
      assertAttributes(element, source, []);
      assertEmptyElement(element, source);
      return { ...location(element, source), type: 'rule' };
    default:
      fail('Unsupported block element', location(element, source));
  }
}

function parseCodeBlock(element: XmlElementNode, source: string): CodeBlock {
  assertAttributes(element, source, ['language']);
  const nested = element.children.find((child) => child.type === 'element');
  if (nested) fail('Code block accepts text only', location(nested, source));

  const language = optionalAttribute(element, 'language');
  if (language && !CODE_LANGUAGE_PATTERN.test(language)) {
    fail('Code block language is malformed', {
      ...location(element, source),
      element: element.name,
      attribute: 'language',
      target: language,
    });
  }

  const lines = element.children
    .filter((child) => child.type === 'text')
    .map((child) => child.value)
    .join('')
    .replace(/\r\n?/g, '\n')
    .split('\n');

  while (lines[0]?.trim().length === 0) lines.shift();
  while (lines.at(-1)?.trim().length === 0) lines.pop();
  if (lines.length === 0) fail('Code block cannot be empty', location(element, source));

  const indentation = Math.min(
    ...lines
      .filter((line) => line.trim().length > 0)
      .map((line) => line.match(/^[ \t]*/)?.[0].length ?? 0),
  );
  const code = lines
    .map((line) => (line.trim().length === 0 ? '' : line.slice(indentation)))
    .join('\n');

  if (code.length > MAX_CODE_BLOCK_LENGTH) {
    fail(`Code block exceeds the ${MAX_CODE_BLOCK_LENGTH} character limit`, location(element, source));
  }

  return { ...location(element, source), type: 'code-block', language, code };
}

function parseSection(element: XmlElementNode, source: string): SectionBlock {
  assertAttributes(element, source, ['id']);
  assertNoMixedText(element, source);
  const children = elementChildren(element);
  assertAllowedChildren(element, source, children, ['title', ...BLOCK_ELEMENTS]);
  if (children[0]?.name !== 'title') {
    fail('Section must begin with a <title>', location(element, source));
  }
  const titleElement = singleChild(element, source, 'title');
  assertAttributes(titleElement, source, []);
  const stableId = optionalAttribute(element, 'id');
  if (stableId && !SECTION_ID_PATTERN.test(stableId)) {
    fail('Stable section ID is malformed', {
      ...location(element, source),
      element: element.name,
      attribute: 'id',
      target: stableId,
    });
  }

  return {
    ...location(element, source),
    type: 'section',
    stableId,
    title: limitedText(plainText(titleElement, source), 200, titleElement, source),
    blocks: parseBlocks(children.slice(1), source),
  };
}

function parseList(element: XmlElementNode, source: string): ListBlock {
  assertAttributes(element, source, []);
  assertNoMixedText(element, source);
  const items = elementChildren(element);
  if (items.length === 0 || items.some((item) => item.name !== 'li')) {
    fail('List must contain one or more <li> children', location(element, source));
  }

  return {
    ...location(element, source),
    type: 'list',
    ordered: element.name === 'ol',
    items: items.map((item) => {
      assertAttributes(item, source, []);
      return requiredInline(item, source, true);
    }),
  };
}

function parseTable(element: XmlElementNode, source: string): TableBlock {
  assertAttributes(element, source, []);
  assertNoMixedText(element, source);
  const children = elementChildren(element);
  assertAllowedChildren(element, source, children, ['thead', 'tbody']);
  const thead = singleChild(element, source, 'thead');
  const tbody = singleChild(element, source, 'tbody');
  const headRows = parseTableRows(thead, source, 'th');
  const rows = parseTableRows(tbody, source, 'td');

  if (headRows.length !== 1) {
    fail('Table header must contain exactly one row', location(thead, source));
  }
  const width = headRows[0].length;
  if (rows.some((row) => row.length !== width)) {
    fail('Every table row must have the same number of cells as the header', location(tbody, source));
  }

  return { ...location(element, source), type: 'table', head: headRows[0], rows };
}

function parseTableRows(container: XmlElementNode, source: string, cellName: 'th' | 'td'): InlineNode[][][] {
  assertAttributes(container, source, []);
  assertNoMixedText(container, source);
  const rows = elementChildren(container);
  if (rows.length === 0 || rows.some((row) => row.name !== 'tr')) {
    fail(`<${container.name}> must contain one or more <tr> children`, location(container, source));
  }

  return rows.map((row) => {
    assertAttributes(row, source, []);
    assertNoMixedText(row, source);
    const cells = elementChildren(row);
    if (cells.length === 0 || cells.some((cell) => cell.name !== cellName)) {
      fail(`<tr> must contain one or more <${cellName}> children`, location(row, source));
    }
    return cells.map((cell) => {
      assertAttributes(cell, source, []);
      return requiredInline(cell, source, false);
    });
  });
}

function parseFigure(element: XmlElementNode, source: string): FigureBlock {
  assertAttributes(element, source, ['asset', 'alt', 'decorative', 'target']);
  assertNoMixedText(element, source);
  assertAllowedChildren(element, source, elementChildren(element), ['caption']);
  const decorative = parseBoolean(optionalAttribute(element, 'decorative') ?? 'false', element, source, 'decorative');
  const alt = optionalAttribute(element, 'alt') ?? '';
  if (!decorative && (!alt || !KOREAN_PATTERN.test(alt))) {
    fail('Non-decorative figure requires Korean alternative text', {
      ...location(element, source),
      element: element.name,
      attribute: 'alt',
    });
  }
  if (decorative && alt) {
    fail('Decorative figure must not provide alternative text', {
      ...location(element, source),
      element: element.name,
      attribute: 'alt',
    });
  }
  const caption = optionalSingleChild(element, source, 'caption');

  return {
    ...location(element, source),
    type: 'figure',
    assetId: parseResourceId(requiredAttribute(element, source, 'asset'), element, source, 'asset'),
    alt,
    decorative,
    targetId: parseOptionalDocumentId(optionalAttribute(element, 'target'), element, source, 'target'),
    caption: caption ? requiredInline(caption, source, false) : undefined,
  };
}

function parseVideo(element: XmlElementNode, source: string): VideoBlock {
  assertAttributes(element, source, [
    'label',
    'asset',
    'provider',
    'video-id',
    'direct-url',
    'poster',
    'track',
  ]);
  assertNoMixedText(element, source);
  assertAllowedChildren(element, source, elementChildren(element), ['caption']);
  const assetId = parseOptionalResourceId(optionalAttribute(element, 'asset'), element, source, 'asset');
  const providerValue = optionalAttribute(element, 'provider');
  const provider = providerValue === undefined ? undefined : parseProvider(providerValue, element, source);
  const videoId = optionalAttribute(element, 'video-id');
  const directUrl = optionalAttribute(element, 'direct-url');
  const posterId = parseOptionalResourceId(optionalAttribute(element, 'poster'), element, source, 'poster');

  if (assetId && (provider || videoId || directUrl)) {
    fail('Video must use either a local asset or an external provider, not both', location(element, source));
  }
  if (!assetId && (!provider || !videoId || !directUrl)) {
    fail('External video requires provider, video-id, and direct-url', location(element, source));
  }
  if (!assetId && !posterId) {
    fail('External video requires a repository-owned poster image', {
      ...location(element, source),
      element: element.name,
      attribute: 'poster',
    });
  }
  if (directUrl) validateExternalUrl(directUrl, element, source, 'direct-url');
  const validVideoId = provider === 'youtube'
    ? /^[A-Za-z0-9_-]{11}$/.test(videoId ?? '')
    : provider === 'vimeo'
      ? /^\d{3,12}$/.test(videoId ?? '')
      : videoId === undefined;
  if (!validVideoId) {
    fail('External video ID is malformed', {
      ...location(element, source),
      element: element.name,
      attribute: 'video-id',
      target: videoId,
    });
  }
  const caption = optionalSingleChild(element, source, 'caption');

  return {
    ...location(element, source),
    type: 'video',
    label: limitedText(requiredAttribute(element, source, 'label'), 160, element, source),
    assetId,
    provider,
    videoId,
    directUrl,
    posterId,
    trackId: parseOptionalResourceId(optionalAttribute(element, 'track'), element, source, 'track'),
    caption: caption ? requiredInline(caption, source, false) : undefined,
  };
}

function parseInline(nodes: XmlNode[], source: string, allowFootnote: boolean, allowLinks = true): InlineNode[] {
  const parsed: InlineNode[] = [];

  for (const node of nodes) {
    if (node.type === 'text') {
      const value = node.value.replace(/\s+/g, ' ');
      if (value) parsed.push({ ...location(node, source), type: 'text', value });
      continue;
    }

    if (!INLINE_ELEMENTS.has(node.name)) {
      fail('Element is not allowed as inline content', location(node, source));
    }

    if (node.name === 'footnote') {
      if (!allowFootnote) fail('Nested footnotes are not allowed', location(node, source));
      assertAttributes(node, source, []);
      const children = trimInline(parseInline(node.children, source, false, true));
      if (children.length === 0) fail('Footnote cannot be empty', location(node, source));
      parsed.push({ ...location(node, source), type: 'footnote', children: children as FootnoteInlineNode[] });
      continue;
    }

    if (node.name === 'ref') {
      if (!allowLinks) fail('Links cannot be nested', location(node, source));
      assertAttributes(node, source, ['href']);
      const href = requiredAttribute(node, source, 'href');
      const target = parseInternalHref(href, node, source);
      const children = trimInline(parseInline(node.children, source, false, false));
      if (children.length === 0) fail('Internal reference requires visible text', location(node, source));
      parsed.push({ ...location(node, source), type: 'ref', ...target, children });
      continue;
    }

    if (node.name === 'external') {
      if (!allowLinks) fail('Links cannot be nested', location(node, source));
      assertAttributes(node, source, ['href']);
      const href = requiredAttribute(node, source, 'href');
      validateExternalUrl(href, node, source, 'href');
      const children = trimInline(parseInline(node.children, source, false, false));
      if (children.length === 0) fail('External link requires visible text', location(node, source));
      parsed.push({ ...location(node, source), type: 'external', href, children });
      continue;
    }

    assertAttributes(node, source, []);
    if (node.name === 'code' && elementChildren(node).length > 0) {
      fail('Inline code accepts text only', location(node, source));
    }
    const children = trimInline(parseInline(node.children, source, false, allowLinks));
    if (children.length === 0) fail(`Inline <${node.name}> cannot be empty`, location(node, source));
    parsed.push({ ...location(node, source), type: node.name as 'em' | 'strong' | 'code', children });
  }

  return trimInline(parsed);
}

function requiredInline(element: XmlElementNode, source: string, allowFootnote: boolean): InlineNode[] {
  const children = parseInline(element.children, source, allowFootnote);
  if (children.length === 0) fail('Inline content cannot be empty', location(element, source));
  return children;
}

function trimInline(nodes: InlineNode[]): InlineNode[] {
  const result = [...nodes];
  const first = result[0];
  const last = result.at(-1);
  if (first?.type === 'text') first.value = first.value.trimStart();
  if (last?.type === 'text') last.value = last.value.trimEnd();
  return result.filter((node) => node.type !== 'text' || node.value.length > 0);
}

function parseBoardSection(element: XmlElementNode, source: string): BoardSection {
  const isBody = element.name === 'body';
  assertAttributes(element, source, isBody ? ['label', 'group', 'asset'] : ['id', 'label', 'group', 'asset']);
  assertNoMixedText(element, source);
  const id = isBody ? 'body' : requiredAttribute(element, source, 'id');
  if (!SECTION_ID_PATTERN.test(id)) {
    fail('Board section ID is malformed', {
      ...location(element, source),
      element: element.name,
      attribute: 'id',
      target: id,
    });
  }
  const children = elementChildren(element);
  assertAllowedChildren(element, source, children, ['document-links', 'document-grid', 'document-table', 'diagram']);
  if (children.length !== 1) fail('Board section requires exactly one layout element', location(element, source));
  const layoutElement = children[0];
  const group = optionalAttribute(element, 'group') ?? id;
  if (!SECTION_ID_PATTERN.test(group)) {
    fail('Board relationship group is malformed', {
      ...location(element, source),
      element: element.name,
      attribute: 'group',
      target: group,
    });
  }
  const base = {
    ...location(element, source),
    id,
    label: limitedText(optionalAttribute(element, 'label') ?? (isBody ? '펼쳐보기' : requiredAttribute(element, source, 'label')), 120, element, source),
    group,
    assetId: parseOptionalResourceId(optionalAttribute(element, 'asset'), element, source, 'asset'),
  };

  if (layoutElement.name === 'document-table') {
    assertAttributes(layoutElement, source, []);
    assertNoMixedText(layoutElement, source);
    const rows = elementChildren(layoutElement).map((row) => parseBoardRow(row, source));
    if (rows.length === 0) fail('Board table requires at least one row', location(layoutElement, source));
    return { ...base, layout: 'table', entries: rows.flatMap((row) => row.entries), rows };
  }

  const allowedAttributes = layoutElement.name === 'document-links' ? [] : ['layout'];
  assertAttributes(layoutElement, source, allowedAttributes);
  assertNoMixedText(layoutElement, source);
  const entries = elementChildren(layoutElement).map((entry) => parseBoardEntry(entry, source, layoutElement.name === 'diagram'));
  if (entries.length === 0) fail('Board section layout requires at least one document', location(layoutElement, source));

  if (layoutElement.name === 'document-links') {
    return { ...base, layout: 'links', entries, rows: [] };
  }

  const layoutName = requiredAttribute(layoutElement, source, 'layout');
  const registry = layoutElement.name === 'document-grid' ? BOARD_GRID_LAYOUTS : BOARD_DIAGRAM_LAYOUTS;
  if (!registry.has(layoutName)) {
    fail('Board layout is not registered in application code', {
      ...location(layoutElement, source),
      element: layoutElement.name,
      attribute: 'layout',
      target: layoutName,
    });
  }

  return {
    ...base,
    layout: layoutElement.name === 'document-grid' ? 'grid' : 'diagram',
    layoutName,
    entries,
    rows: [],
  };
}

function parseBoardRow(element: XmlElementNode, source: string): BoardRow {
  if (element.name !== 'row') fail('Board table may contain only <row> elements', location(element, source));
  assertAttributes(element, source, ['label']);
  assertNoMixedText(element, source);
  const entries = elementChildren(element).map((entry) => parseBoardEntry(entry, source, false));
  if (entries.length === 0) fail('Board table row requires at least one document', location(element, source));
  return {
    ...location(element, source),
    label: limitedText(requiredAttribute(element, source, 'label'), 120, element, source),
    entries,
  };
}

function parseBoardEntry(element: XmlElementNode, source: string, requireSlot: boolean): BoardEntry {
  if (element.name !== 'document') fail('Board layout may contain only <document> entries', location(element, source));
  assertAttributes(element, source, ['target', 'asset', 'icon', 'accent', 'slot', 'retired']);
  const label = inlinePlainOptional(element, source);
  const slot = optionalAttribute(element, 'slot');
  if (requireSlot && !slot) {
    fail('Diagram document requires a semantic slot', {
      ...location(element, source),
      element: element.name,
      attribute: 'slot',
    });
  }
  for (const [name, value] of [
    ['icon', optionalAttribute(element, 'icon')],
    ['accent', optionalAttribute(element, 'accent')],
    ['slot', slot],
  ] as const) {
    if (value && !/^[a-z][a-z0-9-]{0,63}$/.test(value)) {
      fail('Board token is malformed', {
        ...location(element, source),
        element: element.name,
        attribute: name,
        target: value,
      });
    }
  }
  return {
    ...location(element, source),
    targetId: parseDocumentId(requiredAttribute(element, source, 'target'), element, source, 'target'),
    label,
    assetId: parseOptionalResourceId(optionalAttribute(element, 'asset'), element, source, 'asset'),
    icon: optionalAttribute(element, 'icon'),
    accent: optionalAttribute(element, 'accent'),
    slot,
    retired: parseBoolean(optionalAttribute(element, 'retired') ?? 'false', element, source, 'retired'),
  };
}

function parseTextCollection(
  root: XmlElementNode,
  source: string,
  containerName: string,
  itemName: string,
  maxLength: number,
): string[] {
  const container = optionalSingleChild(root, source, containerName);
  if (!container) return [];
  assertAttributes(container, source, []);
  assertNoMixedText(container, source);
  const items = elementChildren(container);
  if (items.some((item) => item.name !== itemName)) {
    fail(`<${containerName}> may contain only <${itemName}> elements`, location(container, source));
  }
  return items.map((item) => {
    assertAttributes(item, source, []);
    return limitedText(plainText(item, source), maxLength, item, source);
  });
}

function parseConnections(element: XmlElementNode, source: string): string[] {
  assertAttributes(element, source, []);
  assertNoMixedText(element, source);
  return elementChildren(element).map((connection) => {
    if (connection.name !== 'connection') {
      fail('<connections> may contain only <connection> elements', location(connection, source));
    }
    assertAttributes(connection, source, ['target']);
    assertEmptyElement(connection, source);
    return parseDocumentId(requiredAttribute(connection, source, 'target'), connection, source, 'target');
  });
}

function parseInternalHref(
  href: string,
  element: XmlElementNode,
  source: string,
): { targetId: string; sectionId?: string } {
  const match = /^doc:([A-Za-z0-9_-]{22})(?:#([a-z][a-z0-9_-]{0,63}))?$/.exec(href);
  if (!match) {
    fail('Internal reference must use doc:<immutable-id> with an optional stable section fragment', {
      ...location(element, source),
      element: element.name,
      attribute: 'href',
      target: href,
    });
  }
  return {
    targetId: parseDocumentId(match[1], element, source, 'href'),
    sectionId: match[2],
  };
}

function validateExternalUrl(value: string, element: XmlElementNode, source: string, attribute: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    fail('External URL is invalid', { ...location(element, source), element: element.name, attribute, target: value });
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    fail('External URL protocol is not allowed', {
      ...location(element, source),
      element: element.name,
      attribute,
      target: value,
    });
  }
  if (url.username || url.password) {
    fail('External URL must not contain credentials', {
      ...location(element, source),
      element: element.name,
      attribute,
      target: value,
    });
  }
}

function parseProvider(value: string, element: XmlElementNode, source: string): 'youtube' | 'vimeo' {
  if (value !== 'youtube' && value !== 'vimeo') {
    fail('External video provider is not allowlisted', {
      ...location(element, source),
      element: element.name,
      attribute: 'provider',
      target: value,
    });
  }
  return value;
}

function parseBoolean(value: string, element: XmlElementNode, source: string, attribute: string): boolean {
  if (value !== 'true' && value !== 'false') {
    fail('Boolean attribute must be true or false', {
      ...location(element, source),
      element: element.name,
      attribute,
      target: value,
    });
  }
  return value === 'true';
}

function parseDocumentId(
  value: string,
  element: XmlElementNode,
  source: string,
  attribute: string,
): string {
  if (!DOCUMENT_ID_PATTERN.test(value)) {
    fail('Document identifier must be the canonical unpadded base64url encoding of 128 bits', {
      ...location(element, source),
      element: element.name,
      attribute,
      target: value,
    });
  }
  return value;
}

function parseOptionalDocumentId(
  value: string | undefined,
  element: XmlElementNode,
  source: string,
  attribute: string,
): string | undefined {
  return value ? parseDocumentId(value, element, source, attribute) : undefined;
}

function parseResourceId(
  value: string,
  element: XmlElementNode,
  source: string,
  attribute: string,
): string {
  if (!RESOURCE_ID_PATTERN.test(value)) {
    fail('Resource identifier is malformed', {
      ...location(element, source),
      element: element.name,
      attribute,
      target: value,
    });
  }
  return value;
}

function parseOptionalResourceId(
  value: string | undefined,
  element: XmlElementNode,
  source: string,
  attribute: string,
): string | undefined {
  return value ? parseResourceId(value, element, source, attribute) : undefined;
}

function optionalSingleChild(root: XmlElementNode, source: string, name: string): XmlElementNode | undefined {
  const matches = elementChildren(root).filter((child) => child.name === name);
  if (matches.length > 1) {
    fail(`Expected at most one <${name}> child`, location(root, source));
  }
  return matches[0];
}

function assertAllowedChildren(
  root: XmlElementNode,
  source: string,
  children: XmlElementNode[],
  allowed: Iterable<string>,
): void {
  const allowedSet = new Set(allowed);
  const invalid = children.find((child) => !allowedSet.has(child.name));
  if (invalid) fail('Child element is not allowed here', location(invalid, source));
}

function assertChildOrder(
  root: XmlElementNode,
  source: string,
  children: XmlElementNode[],
  order: string[],
): void {
  let last = -1;
  for (const child of children) {
    const index = order.indexOf(child.name);
    if (index < last) fail('Child elements are out of schema order', location(child, source));
    last = index;
  }
  if (children[0]?.name !== 'title' || children.at(-1)?.name !== 'body') {
    fail('Document must begin with <title> and end with <body>', location(root, source));
  }
}

function assertEmptyElement(element: XmlElementNode, source: string): void {
  if (element.children.some((child) => child.type === 'element' || child.value.trim().length > 0)) {
    fail('Element must be empty', location(element, source));
  }
}

function inlinePlainOptional(element: XmlElementNode, source: string): string | undefined {
  const nested = element.children.find((child) => child.type === 'element');
  if (nested) fail('Board document label must be plain text', location(nested, source));
  const value = normalizeText(
    element.children
      .filter((child) => child.type === 'text')
      .map((child) => child.value)
      .join(''),
  );
  if (value.length > 160) {
    fail('Board document label exceeds the 160 character limit', location(element, source));
  }
  return value || undefined;
}

function limitedText(
  value: string,
  limit: number,
  element: XmlElementNode,
  source: string,
): string {
  if (value.length > limit) {
    fail(`Text exceeds the ${limit} character limit`, location(element, source));
  }
  return value;
}

function uniqueValues(
  values: string[],
  message: string,
  source: string,
  element: XmlElementNode,
): string[] {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) fail(message, { ...location(element, source), target: value });
    seen.add(value);
  }
  return values;
}

function visitBlocks(blocks: BlockNode[], visitor: (block: BlockNode) => void): void {
  for (const block of blocks) {
    visitor(block);
    if (block.type === 'section' || block.type === 'quote') visitBlocks(block.blocks, visitor);
  }
}

function location(node: { line: number; column: number }, source: string): Located {
  return { source, line: node.line, column: node.column };
}
