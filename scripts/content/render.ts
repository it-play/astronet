import { createHash } from 'node:crypto';
import { articleUrl, slugifyTitle } from '../../src/content/shared';
import type { CompiledArticle, RelatedDocument, TocItem } from '../../src/content/types';
import type { MediaAsset } from './media';
import { requireMedia } from './media';
import type {
  BlockNode,
  BoardEntry,
  BoardSection,
  FootnoteInlineNode,
  InlineNode,
  SourceBoard,
  SourceDocument,
} from './model';

interface RenderInput {
  document: SourceDocument;
  documents: Map<string, SourceDocument>;
  boards: Map<string, SourceBoard>;
  media: Map<string, MediaAsset>;
  related: RelatedDocument[];
}

interface FootnoteRecord {
  number: number;
  noteId: string;
  markerId: string;
  html: string;
}

interface RenderContext extends RenderInput {
  sectionSequence: number;
  footnotes: FootnoteRecord[];
  toc: TocItem[];
  boardIds: Set<string>;
}

type BoardRenderContext = Pick<RenderInput, 'documents' | 'media'>;

export interface RenderedNavigationBoard {
  fullHtml: string;
  shellHtml: string;
  sections: Record<string, string>;
}

export function renderDocument(input: RenderInput): CompiledArticle {
  const context: RenderContext = {
    ...input,
    sectionSequence: 0,
    footnotes: [],
    toc: [],
    boardIds: new Set(),
  };
  const body = renderBlocks(input.document.body, context, [], context.toc);
  const notes = renderNotes(context.footnotes);
  const slug = slugifyTitle(input.document.title);
  const url = articleUrl(input.document.id, input.document.title);
  const html = `${body}${notes}`;
  const boardIds = [...context.boardIds].sort();
  const integrity = createHash('sha256')
    .update(
      JSON.stringify({
        id: input.document.id,
        title: input.document.title,
        slug,
        url,
        html,
        toc: context.toc,
        boardIds,
        related: input.related,
      }),
    )
    .digest('base64url');

  return {
    id: input.document.id,
    title: input.document.title,
    slug,
    url,
    html,
    toc: context.toc,
    boardIds,
    related: input.related,
    integrity,
  };
}

export function extractDocumentText(document: SourceDocument): string {
  const pieces: string[] = [];
  collectBlockText(document.body, pieces);
  return pieces.join(' ').replace(/\s+/g, ' ').trim();
}

function renderBlocks(
  blocks: BlockNode[],
  context: RenderContext,
  numberPrefix: number[],
  tocTarget: TocItem[],
): string {
  let sectionIndex = 0;
  return blocks
    .map((block) => {
      switch (block.type) {
        case 'section': {
          sectionIndex += 1;
          context.sectionSequence += 1;
          const numberParts = [...numberPrefix, sectionIndex];
          const number = numberParts.join('.');
          const id = block.stableId ?? `section-${context.sectionSequence}`;
          const children: TocItem[] = [];
          tocTarget.push({ id, number, title: block.title, depth: numberParts.length, children });
          const headingLevel = Math.min(6, numberParts.length + 1);
          return `<section class="article-section" aria-labelledby="${escapeAttribute(id)}-title"><h${headingLevel} id="${escapeAttribute(id)}"><a class="section-heading" id="${escapeAttribute(id)}-title" href="#${escapeAttribute(id)}"><span class="section-number" aria-hidden="true">${escapeHtml(number)}</span><span>${escapeHtml(block.title)}</span></a></h${headingLevel}>${renderBlocks(block.blocks, context, numberParts, children)}</section>`;
        }
        case 'paragraph':
          return `<p>${renderInline(block.children, context, true)}</p>`;
        case 'list': {
          const tag = block.ordered ? 'ol' : 'ul';
          return `<${tag}>${block.items.map((item) => `<li>${renderInline(item, context, true)}</li>`).join('')}</${tag}>`;
        }
        case 'quote':
          return `<blockquote class="article-quote">${renderBlocks(block.blocks, context, numberPrefix, [])}</blockquote>`;
        case 'code-block':
          return `<pre class="article-code-block" tabindex="0"${block.language ? ` data-language="${escapeAttribute(block.language)}"` : ''}><code>${escapeHtml(block.code)}</code></pre>`;
        case 'table':
          return `<div class="article-table-scroll" tabindex="0"><table><thead><tr>${block.head.map((cell) => `<th scope="col">${renderInline(cell, context, true)}</th>`).join('')}</tr></thead><tbody>${block.rows.map((row) => `<tr>${row.map((cell) => `<td>${renderInline(cell, context, true)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
        case 'figure':
          return renderFigure(block, context);
        case 'video':
          return renderVideo(block, context);
        case 'board': {
          const board = context.boards.get(block.boardId);
          if (!board) return '';
          context.boardIds.add(board.id);
          return `<div data-board-include="${escapeAttribute(board.id)}"></div>`;
        }
        case 'rule':
          return '<hr />';
      }
    })
    .join('');
}

function renderInline(nodes: readonly InlineNode[], context: RenderContext, recordFootnotes: boolean): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case 'text':
          return escapeHtml(node.value);
        case 'em':
          return `<em>${renderInline(node.children, context, false)}</em>`;
        case 'strong':
          return `<strong>${renderInline(node.children, context, false)}</strong>`;
        case 'code':
          return `<code>${renderInline(node.children, context, false)}</code>`;
        case 'ref': {
          const target = context.documents.get(node.targetId);
          if (!target) return '';
          const fragment = node.sectionId ? `#${encodeURIComponent(node.sectionId)}` : '';
          return `<a class="internal-link" href="${escapeAttribute(articleUrl(target.id, target.title) + fragment)}">${renderInline(node.children, context, false)}</a>`;
        }
        case 'external':
          return `<a class="external-link" href="${escapeAttribute(node.href)}" rel="noopener noreferrer">${renderInline(node.children, context, false)}</a>`;
        case 'footnote':
          return recordFootnotes ? renderFootnote(node.children, context) : renderInline(node.children, context, false);
      }
    })
    .join('');
}

function renderFootnote(nodes: readonly FootnoteInlineNode[], context: RenderContext): string {
  const number = context.footnotes.length + 1;
  const noteId = `note-${number}`;
  const markerId = `note-ref-${number}`;
  const previewId = `note-preview-${number}`;
  const html = renderInline(nodes, context, false);
  context.footnotes.push({ number, noteId, markerId, html });
  return `<span class="footnote"><button class="footnote-marker" id="${markerId}" type="button" aria-label="각주 ${number} 미리보기" aria-expanded="false" aria-controls="${previewId}" data-footnote-marker="${noteId}"><sup>${number}</sup></button><span class="footnote-preview" id="${previewId}" role="dialog" aria-label="각주 ${number}" hidden><span class="footnote-preview__content">${html}</span><a href="#${noteId}" data-footnote-jump>각주로 이동</a></span></span>`;
}

function renderNotes(footnotes: FootnoteRecord[]): string {
  if (footnotes.length === 0) return '';
  return `<section class="article-notes" aria-labelledby="article-notes-title"><h2 id="article-notes-title">각주</h2><ol>${footnotes.map((note) => `<li id="${note.noteId}">${note.html} <a class="note-return" href="#${note.markerId}" aria-label="본문의 각주 ${note.number}으로 돌아가기">↩</a></li>`).join('')}</ol></section>`;
}

function renderFigure(block: Extract<BlockNode, { type: 'figure' }>, context: RenderContext): string {
  const asset = requireMedia(context.media, block.assetId, 'image', block.source);
  const image = `<img src="${escapeAttribute(asset.publicPath)}" width="${asset.width}" height="${asset.height}" alt="${escapeAttribute(block.alt)}" loading="lazy" decoding="async" />`;
  const captionHtml = block.caption ? renderInline(block.caption, context, true) : '';
  const captionText = block.caption ? inlineText(block.caption) : '';
  let content: string;
  if (block.targetId) {
    const target = context.documents.get(block.targetId);
    content = target ? `<a class="linked-figure" href="${escapeAttribute(articleUrl(target.id, target.title))}">${image}</a>` : image;
  } else {
    content = `<button class="figure-open" type="button" data-image-src="${escapeAttribute(asset.publicPath)}" data-image-alt="${escapeAttribute(block.alt)}" data-image-caption="${escapeAttribute(captionText)}" aria-label="이미지 크게 보기: ${escapeAttribute(block.alt || captionText || '이미지')}">${image}</button>`;
  }
  const caption = captionHtml ? `<figcaption>${captionHtml}</figcaption>` : '';
  return `<figure>${content}${caption}</figure>`;
}

function renderVideo(block: Extract<BlockNode, { type: 'video' }>, context: RenderContext): string {
  const poster = block.posterId ? requireMedia(context.media, block.posterId, 'image', block.source) : undefined;
  const posterAttribute = poster ? ` poster="${escapeAttribute(poster.publicPath)}"` : '';
  let player: string;

  if (block.assetId) {
    const video = requireMedia(context.media, block.assetId, 'video', block.source);
    const track = block.trackId ? requireMedia(context.media, block.trackId, 'track', block.source) : undefined;
    player = `<video controls preload="metadata" aria-label="${escapeAttribute(block.label)}"${posterAttribute}><source src="${escapeAttribute(video.publicPath)}" />${track ? `<track kind="captions" srclang="ko" label="한국어" src="${escapeAttribute(track.publicPath)}" default />` : ''}<p>이 브라우저에서는 영상을 재생할 수 없습니다.</p></video><a class="video-direct-link" href="${escapeAttribute(video.publicPath)}">영상 파일 열기</a>`;
  } else {
    const posterImage = poster
      ? `<img src="${escapeAttribute(poster.publicPath)}" width="${poster.width}" height="${poster.height}" alt="" loading="lazy" />`
      : '';
    player = `<div class="external-video" data-external-video><button type="button" data-video-provider="${escapeAttribute(block.provider ?? '')}" data-video-id="${escapeAttribute(block.videoId ?? '')}" aria-label="${escapeAttribute(block.label)} 재생">${posterImage}<span>재생</span></button><a href="${escapeAttribute(block.directUrl ?? '')}" rel="noopener noreferrer">외부에서 열기</a></div>`;
  }

  const caption = block.caption ? `<figcaption>${renderInline(block.caption, context, true)}</figcaption>` : '';
  return `<figure class="video-figure">${player}${caption}</figure>`;
}

export function renderNavigationBoard(board: SourceBoard, context: BoardRenderContext): RenderedNavigationBoard {
  const sections = Object.fromEntries(
    board.sections.map((section) => [section.id, renderBoardSectionContent(section, context)]),
  );
  return {
    fullHtml: renderBoardContainer(board, context, sections, false),
    shellHtml: renderBoardContainer(board, context, sections, true),
    sections,
  };
}

function renderBoardContainer(
  board: SourceBoard,
  context: BoardRenderContext,
  sections: Record<string, string>,
  lazy: boolean,
): string {
  const headerAsset = board.headerAssetId ? requireMedia(context.media, board.headerAssetId, 'image', board.source) : undefined;
  return `<aside class="navigation-board navigation-board--${escapeAttribute(board.theme)}" data-board-root="${escapeAttribute(board.id)}" data-board-theme="${escapeAttribute(board.theme)}" aria-labelledby="board-${escapeAttribute(board.id)}-title"><header class="navigation-board__header">${headerAsset ? `<img src="${escapeAttribute(headerAsset.publicPath)}" width="${headerAsset.width}" height="${headerAsset.height}" alt="" loading="lazy" />` : ''}<div><h2 id="board-${escapeAttribute(board.id)}-title">${escapeHtml(board.title)}</h2>${board.subtitle ? `<p>${escapeHtml(board.subtitle)}</p>` : ''}</div></header><div class="navigation-board__sections">${board.sections.map((section) => renderBoardSection(board, section, context, sections[section.id] ?? '', lazy)).join('')}</div></aside>`;
}

function renderBoardSection(
  board: SourceBoard,
  section: BoardSection,
  context: BoardRenderContext,
  content: string,
  lazy: boolean,
): string {
  const id = `board-${board.id}-${section.id}`;
  const sectionAsset = section.assetId ? requireMedia(context.media, section.assetId, 'image', section.source) : undefined;
  return `<details class="navigation-board__section" data-board-section="${escapeAttribute(section.id)}"><summary aria-controls="${escapeAttribute(id)}">${sectionAsset ? `<img src="${escapeAttribute(sectionAsset.publicPath)}" width="${sectionAsset.width}" height="${sectionAsset.height}" alt="" loading="lazy" />` : ''}<span>${escapeHtml(section.label)}</span></summary><div id="${escapeAttribute(id)}" data-board-section-body>${lazy ? '' : content}</div></details>`;
}

function renderBoardSectionContent(section: BoardSection, context: BoardRenderContext): string {
  let content: string;
  if (section.layout === 'table') {
    content = `<div class="navigation-board__table-scroll" tabindex="0"><table><tbody>${section.rows.map((row) => `<tr><th scope="row">${escapeHtml(row.label)}</th><td>${row.entries.map((entry) => renderBoardEntry(entry, context)).join('')}</td></tr>`).join('')}</tbody></table></div>`;
  } else {
    content = `<ul class="navigation-board__${section.layout}"${section.layoutName ? ` data-layout="${escapeAttribute(section.layoutName)}"` : ''}>${section.entries.map((entry) => `<li${entry.slot ? ` data-slot="${escapeAttribute(entry.slot)}"` : ''}>${renderBoardEntry(entry, context)}</li>`).join('')}</ul>`;
  }
  return content;
}

function renderBoardEntry(entry: BoardEntry, context: BoardRenderContext): string {
  const target = context.documents.get(entry.targetId);
  if (!target) return '';
  const media = entry.assetId ? requireMedia(context.media, entry.assetId, 'image', entry.source) : undefined;
  const label = entry.label ?? target.title;
  const renderedLabel = entry.retired ? `<s>${escapeHtml(label)}</s>` : `<span>${escapeHtml(label)}</span>`;
  return `<a href="${escapeAttribute(articleUrl(target.id, target.title))}"${entry.accent ? ` data-accent="${escapeAttribute(entry.accent)}"` : ''}${entry.retired ? ` aria-label="${escapeAttribute(`${label} (퇴역)`)}"` : ''}>${media ? `<img src="${escapeAttribute(media.publicPath)}" width="${media.width}" height="${media.height}" alt="" loading="lazy" />` : ''}${entry.icon ? `<span class="board-icon board-icon--${escapeAttribute(entry.icon)}" aria-hidden="true"></span>` : ''}${renderedLabel}</a>`;
}

function collectBlockText(blocks: BlockNode[], pieces: string[]): void {
  for (const block of blocks) {
    switch (block.type) {
      case 'section':
        pieces.push(block.title);
        collectBlockText(block.blocks, pieces);
        break;
      case 'paragraph':
        pieces.push(inlineText(block.children));
        break;
      case 'list':
        pieces.push(...block.items.map(inlineText));
        break;
      case 'quote':
        collectBlockText(block.blocks, pieces);
        break;
      case 'code-block':
        pieces.push(block.code);
        break;
      case 'table':
        pieces.push(...block.head.map(inlineText), ...block.rows.flat().map(inlineText));
        break;
      case 'figure':
        if (block.alt) pieces.push(block.alt);
        if (block.caption) pieces.push(inlineText(block.caption));
        break;
      case 'video':
        pieces.push(block.label);
        if (block.caption) pieces.push(inlineText(block.caption));
        break;
      case 'board':
      case 'rule':
        break;
    }
  }
}

function inlineText(nodes: readonly InlineNode[]): string {
  return nodes
    .map((node) => (node.type === 'text' ? node.value : inlineText(node.children)))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

function escapeAttribute(value: string): string {
  return escapeHtml(value);
}
