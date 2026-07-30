import { articleBucket, DOCUMENT_ID_PATTERN } from '../content/shared';
import type { ArticlePack, BuildManifest, CompiledArticle, TocItem } from '../content/types';

interface ArticleLocation {
  id: string;
  slug: string;
}

const manifest = readManifest();
const route = requiredElement<HTMLElement>('article-route');
const missingPage = document.getElementById('not-found');
const loading = requiredElement<HTMLElement>('article-loading');
const error = requiredElement<HTMLElement>('article-error');
const errorTitle = requiredElement<HTMLElement>('article-error-title');
const errorMessage = requiredElement<HTMLElement>('article-error-message');
const retry = requiredElement<HTMLButtonElement>('article-retry');
const page = requiredElement<HTMLElement>('article-page');
const title = requiredElement<HTMLElement>('article-title');
const body = requiredElement<HTMLElement>('article-body');
const related = requiredElement<HTMLElement>('article-related');
const relatedList = requiredElement<HTMLUListElement>('article-related-list');
const graphLink = requiredElement<HTMLAnchorElement>('article-graph-link');
const desktopToc = requiredElement<HTMLElement>('article-toc');
const mobileToc = requiredElement<HTMLDetailsElement>('article-toc-mobile');
const imageViewer = requiredElement<HTMLDialogElement>('image-viewer');
const imageViewerImage = requiredElement<HTMLImageElement>('image-viewer-image');
const imageViewerCaption = requiredElement<HTMLElement>('image-viewer-caption');
const imageViewerClose = requiredElement<HTMLButtonElement>('image-viewer-close');
const packCache = new Map<string, Promise<ArticlePack>>();
let activeRequest = 0;
let currentLocation: ArticleLocation | undefined;
let headingObserver: IntersectionObserver | undefined;
let activeFootnoteMarker: HTMLButtonElement | undefined;
let imageTrigger: HTMLButtonElement | undefined;

const initialLocation = parseArticlePath(window.location.pathname);
if (window.location.pathname.startsWith('/wiki/')) {
  missingPage?.setAttribute('hidden', '');
  route.hidden = false;
  if (initialLocation) {
    void loadArticle(initialLocation);
  } else {
    showError('문서 주소가 올바르지 않습니다.', '주소를 확인하거나 검색에서 문서를 찾아보세요.', false);
  }
}

retry.addEventListener('click', () => {
  const location = currentLocation ?? parseArticlePath(window.location.pathname);
  if (location) void loadArticle(location, true);
});

window.addEventListener('popstate', () => {
  const location = parseArticlePath(window.location.pathname);
  if (location) void loadArticle(location);
});

document.addEventListener('click', (event) => {
  const mouseEvent = event as MouseEvent;
  if (mouseEvent.defaultPrevented || mouseEvent.button !== 0 || mouseEvent.metaKey || mouseEvent.ctrlKey || mouseEvent.shiftKey || mouseEvent.altKey) return;
  const target = mouseEvent.target;
  if (!(target instanceof Element)) return;
  const anchor = target.closest<HTMLAnchorElement>('a[href]');
  if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) return;
  const url = new URL(anchor.href, window.location.href);
  if (url.origin !== window.location.origin) return;
  if (url.pathname === window.location.pathname && url.search === window.location.search && url.hash) return;
  const next = parseArticlePath(url.pathname);
  if (!next) return;
  event.preventDefault();
  closeFootnote(false);
  history.pushState({}, '', `${url.pathname}${url.search}${url.hash}`);
  void loadArticle(next);
});

body.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;

  const marker = target.closest<HTMLButtonElement>('[data-footnote-marker]');
  if (marker) {
    toggleFootnote(marker);
    return;
  }

  if (target.closest('[data-footnote-jump]')) {
    closeFootnote(false);
    return;
  }

  const figureButton = target.closest<HTMLButtonElement>('.figure-open');
  if (figureButton) {
    openImage(figureButton);
    return;
  }

  const videoButton = target.closest<HTMLButtonElement>('[data-video-provider]');
  if (videoButton) loadExternalVideo(videoButton);
});

document.addEventListener('pointerdown', (event) => {
  if (!activeFootnoteMarker) return;
  const target = event.target;
  const preview = activeFootnoteMarker.parentElement?.querySelector('.footnote-preview');
  if (target instanceof Node && !activeFootnoteMarker.contains(target) && !preview?.contains(target)) closeFootnote(false);
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && activeFootnoteMarker) closeFootnote(true);
});

imageViewerClose.addEventListener('click', () => imageViewer.close());
imageViewer.addEventListener('click', (event) => {
  if (event.target === imageViewer) imageViewer.close();
});
imageViewer.addEventListener('close', () => {
  imageViewerImage.src = '';
  imageTrigger?.focus();
  imageTrigger = undefined;
});

async function loadArticle(location: ArticleLocation, force = false): Promise<void> {
  const request = ++activeRequest;
  currentLocation = location;
  showLoading();

  try {
    const bucket = articleBucket(location.id, manifest.bucketCount);
    const packPath = manifest.articlePacks[bucket];
    if (!packPath) {
      showError('문서를 찾을 수 없습니다.', '존재하지 않거나 아직 공개되지 않은 문서입니다.', false);
      return;
    }
    if (force) packCache.delete(packPath);
    const pack = await fetchPack(packPath);
    if (request !== activeRequest) return;
    const article = pack.articles[location.id];
    if (!article || !(await hasValidIntegrity(article))) {
      showError(
        article ? '문서 데이터를 확인할 수 없습니다.' : '문서를 찾을 수 없습니다.',
        article ? '페이지를 새로고침한 뒤 다시 시도해 주세요.' : '존재하지 않거나 아직 공개되지 않은 문서입니다.',
        Boolean(article),
      );
      return;
    }
    renderArticle(article);
  } catch {
    if (request !== activeRequest) return;
    showError('문서를 불러오지 못했습니다.', '연결 상태를 확인한 뒤 다시 시도해 주세요.', true);
  }
}

async function fetchPack(path: string): Promise<ArticlePack> {
  const existing = packCache.get(path);
  if (existing) return existing;
  const request = fetch(path, { cache: 'force-cache' }).then(async (response) => {
    if (!response.ok) throw new Error('Article pack request failed');
    const value = (await response.json()) as ArticlePack;
    if (value.buildId !== manifest.buildId) throw new Error('Article pack build mismatch');
    return value;
  });
  packCache.set(path, request);
  try {
    return await request;
  } catch (cause) {
    packCache.delete(path);
    throw cause;
  }
}

function renderArticle(article: CompiledArticle): void {
  closeFootnote(false);
  headingObserver?.disconnect();
  title.textContent = article.title;
  body.innerHTML = article.html;
  graphLink.href = `/graph?focus=${encodeURIComponent(article.id)}`;
  document.title = `${article.title} — Astronet`;
  renderRelated(article);
  renderTableOfContents(article.toc);

  const canonicalPath = article.url;
  if (window.location.pathname !== canonicalPath) {
    history.replaceState(history.state, '', `${canonicalPath}${window.location.search}${window.location.hash}`);
  }

  loading.hidden = true;
  error.hidden = true;
  page.hidden = false;
  setupHeadingObserver(article.toc);

  requestAnimationFrame(() => {
    if (window.location.hash) {
      const id = decodeURIComponent(window.location.hash.slice(1));
      document.getElementById(id)?.scrollIntoView();
    } else {
      window.scrollTo({ top: 0, behavior: 'instant' });
    }
  });
}

function renderRelated(article: CompiledArticle): void {
  relatedList.replaceChildren();
  for (const item of article.related) {
    const listItem = document.createElement('li');
    const anchor = document.createElement('a');
    anchor.href = item.url;
    anchor.textContent = item.title;
    listItem.append(anchor);
    relatedList.append(listItem);
  }
  related.hidden = article.related.length === 0;
}

function renderTableOfContents(items: TocItem[]): void {
  const navs = document.querySelectorAll<HTMLElement>('[data-toc]');
  for (const nav of navs) nav.replaceChildren(createTocList(items));
  const hidden = items.length === 0;
  desktopToc.hidden = hidden;
  mobileToc.hidden = hidden;
  if (hidden) mobileToc.open = false;
}

function createTocList(items: TocItem[]): HTMLUListElement {
  const list = document.createElement('ul');
  for (const item of items) {
    const listItem = document.createElement('li');
    const anchor = document.createElement('a');
    anchor.href = `#${encodeURIComponent(item.id)}`;
    anchor.dataset.tocTarget = item.id;
    anchor.textContent = `${item.number} ${item.title}`;
    listItem.append(anchor);
    if (item.children.length > 0) listItem.append(createTocList(item.children));
    list.append(listItem);
  }
  return list;
}

function setupHeadingObserver(items: TocItem[]): void {
  if (!('IntersectionObserver' in window) || items.length === 0) return;
  const sectionIds = flattenToc(items).map((item) => item.id);
  const headings = sectionIds
    .map((id) => document.getElementById(id))
    .filter((element): element is HTMLElement => Boolean(element));
  headingObserver = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((left, right) => left.boundingClientRect.top - right.boundingClientRect.top)[0];
      if (!visible) return;
      document.querySelectorAll('[data-toc-target]').forEach((anchor) => anchor.removeAttribute('aria-current'));
      document.querySelectorAll(`[data-toc-target="${CSS.escape(visible.target.id)}"]`).forEach((anchor) => {
        anchor.setAttribute('aria-current', 'location');
      });
    },
    { rootMargin: '-72px 0px -72% 0px', threshold: 0 },
  );
  headings.forEach((heading) => headingObserver?.observe(heading));
}

function flattenToc(items: TocItem[]): TocItem[] {
  return items.flatMap((item) => [item, ...flattenToc(item.children)]);
}

function showLoading(): void {
  page.hidden = true;
  error.hidden = true;
  loading.hidden = false;
}

function showError(nextTitle: string, message: string, canRetry: boolean): void {
  loading.hidden = true;
  page.hidden = true;
  errorTitle.textContent = nextTitle;
  errorMessage.textContent = message;
  retry.hidden = !canRetry;
  error.hidden = false;
  document.title = `${nextTitle} — Astronet`;
}

function toggleFootnote(marker: HTMLButtonElement): void {
  if (activeFootnoteMarker === marker) {
    closeFootnote(true);
    return;
  }
  closeFootnote(false);
  const preview = marker.parentElement?.querySelector<HTMLElement>('.footnote-preview');
  if (!preview) return;
  preview.hidden = false;
  marker.setAttribute('aria-expanded', 'true');
  activeFootnoteMarker = marker;
}

function closeFootnote(restoreFocus: boolean): void {
  const marker = activeFootnoteMarker;
  if (!marker) return;
  const preview = marker.parentElement?.querySelector<HTMLElement>('.footnote-preview');
  if (preview) preview.hidden = true;
  marker.setAttribute('aria-expanded', 'false');
  activeFootnoteMarker = undefined;
  if (restoreFocus) marker.focus();
}

function openImage(button: HTMLButtonElement): void {
  const src = button.dataset.imageSrc;
  if (!src) return;
  const alt = button.dataset.imageAlt ?? '';
  imageTrigger = button;
  imageViewerImage.src = src;
  imageViewerImage.alt = alt;
  imageViewerCaption.textContent = alt;
  imageViewer.showModal();
  imageViewerClose.focus();
}

function loadExternalVideo(button: HTMLButtonElement): void {
  const provider = button.dataset.videoProvider;
  const videoId = button.dataset.videoId;
  const container = button.closest<HTMLElement>('[data-external-video]');
  if (!provider || !videoId || !container) return;
  const iframe = document.createElement('iframe');
  iframe.title = button.getAttribute('aria-label') ?? '외부 영상';
  iframe.allow = 'accelerometer; autoplay; encrypted-media; picture-in-picture';
  iframe.allowFullscreen = true;
  iframe.referrerPolicy = 'strict-origin-when-cross-origin';
  if (provider === 'youtube') {
    iframe.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?autoplay=1`;
  } else if (provider === 'vimeo') {
    iframe.src = `https://player.vimeo.com/video/${encodeURIComponent(videoId)}?autoplay=1`;
  } else {
    return;
  }
  button.replaceWith(iframe);
}

async function hasValidIntegrity(article: CompiledArticle): Promise<boolean> {
  if (!window.crypto?.subtle) return true;
  const serialized = JSON.stringify({
    id: article.id,
    title: article.title,
    slug: article.slug,
    html: article.html,
    related: article.related,
  });
  const digest = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(serialized));
  const encoded = bytesToBase64Url(new Uint8Array(digest));
  return encoded === article.integrity;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function parseArticlePath(pathname: string): ArticleLocation | undefined {
  const match = /^\/wiki\/([^/]+)\/([^/]+)\/?$/.exec(pathname);
  if (!match) return undefined;
  const id = match[1];
  const slug = match[2];
  if (!id || !slug || !DOCUMENT_ID_PATTERN.test(id)) return undefined;
  return { id, slug };
}

function readManifest(): BuildManifest {
  const element = document.getElementById('astronet-build');
  if (!element?.textContent) throw new Error('Build manifest is missing');
  return JSON.parse(element.textContent) as BuildManifest;
}

function requiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Required article element is missing: ${id}`);
  return element as T;
}
