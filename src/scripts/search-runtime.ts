import type { BuildManifest } from '../content/types';

interface SearchResultItem {
  id: string;
  title: string;
  url: string;
  excerpt: string;
}

interface SearchResponse {
  type: 'result' | 'error';
  requestId: number;
  query: string;
  page: number;
  pageCount: number;
  total: number;
  results: SearchResultItem[];
  highlightTerms: string[];
  message?: string;
}

const manifest = readManifest();
const form = document.querySelector<HTMLFormElement>('.search-field');
const input = requiredElement<HTMLInputElement>('search-query');
const state = requiredElement<HTMLElement>('search-state');
const stateTitle = requiredElement<HTMLElement>('search-state-title');
const resultsRegion = requiredElement<HTMLElement>('search-results');
const resultCount = requiredElement<HTMLElement>('search-result-count');
const resultsList = requiredElement<HTMLOListElement>('search-result-list');
const pagination = requiredElement<HTMLElement>('search-pagination');
const worker = createSearchWorker();
const pageSize = 20;
let requestId = 0;
let debounceTimer: number | undefined;
let activeQuery = '';

const initial = new URL(window.location.href);
input.value = initial.searchParams.get('q') ?? '';
void search(input.value, parsePage(initial.searchParams.get('page')));

input.addEventListener('input', () => {
  window.clearTimeout(debounceTimer);
  debounceTimer = window.setTimeout(() => {
    updateUrl(input.value, 1, 'replace');
    void search(input.value, 1);
  }, 180);
});

form?.addEventListener('submit', (event) => {
  event.preventDefault();
  window.clearTimeout(debounceTimer);
  updateUrl(input.value, 1, 'push');
  void search(input.value, 1);
});

pagination.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const button = target.closest<HTMLButtonElement>('[data-page]');
  if (!button) return;
  const page = Number.parseInt(button.dataset.page ?? '', 10);
  if (!Number.isFinite(page)) return;
  updateUrl(activeQuery, page, 'push');
  void search(activeQuery, page);
  input.focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

window.addEventListener('popstate', () => {
  const url = new URL(window.location.href);
  input.value = url.searchParams.get('q') ?? '';
  void search(input.value, parsePage(url.searchParams.get('page')));
});

worker?.addEventListener('message', (event: MessageEvent<SearchResponse>) => {
  const response = event.data;
  if (response.requestId !== requestId) return;
  if (response.type === 'error') {
    showState(response.message ?? '검색 결과를 불러오지 못했습니다.');
    return;
  }
  if (response.message) {
    showState(response.message);
    return;
  }
  if (!response.query.trim()) {
    showState('검색어를 입력해 주세요');
    return;
  }
  if (response.total === 0) {
    showState('검색 결과가 없습니다');
    return;
  }
  renderResults(response);
});

worker?.addEventListener('error', () => {
  showState('검색 결과를 불러오지 못했습니다.');
});

async function search(query: string, page: number): Promise<void> {
  activeQuery = query;
  requestId += 1;
  showState(query.trim() ? '검색 중입니다.' : '검색어를 입력해 주세요');
  if (!worker) {
    if (query.trim()) showState('이 브라우저에서는 검색 인덱스를 불러올 수 없습니다.');
    return;
  }
  if (!query.trim()) {
    worker.postMessage({ type: 'cancel', requestId });
    return;
  }
  worker.postMessage({
    type: 'search',
    requestId,
    manifest,
    query,
    page,
    pageSize,
  });
}

function createSearchWorker(): Worker | undefined {
  if (!('Worker' in window)) return undefined;
  try {
    return new Worker(new URL('./search-worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return undefined;
  }
}

function renderResults(response: SearchResponse): void {
  updateUrl(activeQuery, response.page, 'replace');
  state.hidden = true;
  resultsRegion.hidden = false;
  resultCount.textContent = `${response.total.toLocaleString('ko-KR')}개 문서`;
  resultsList.replaceChildren(
    ...response.results.map((result) => {
      const item = document.createElement('li');
      const heading = document.createElement('h2');
      const anchor = document.createElement('a');
      anchor.href = result.url;
      anchor.textContent = result.title;
      heading.append(anchor);
      item.append(heading);
      if (result.excerpt) {
        const excerpt = document.createElement('p');
        appendHighlightedText(excerpt, result.excerpt, response.highlightTerms);
        item.append(excerpt);
      }
      return item;
    }),
  );
  renderPagination(response.page, response.pageCount);
}

function renderPagination(current: number, pageCount: number): void {
  pagination.replaceChildren();
  if (pageCount <= 1) {
    pagination.hidden = true;
    return;
  }
  const pages = visiblePages(current, pageCount);
  const label = document.createElement('span');
  label.className = 'visually-hidden';
  label.textContent = '검색 결과 페이지';
  pagination.append(label);
  for (const page of pages) {
    if (page === null) {
      const ellipsis = document.createElement('span');
      ellipsis.textContent = '…';
      ellipsis.setAttribute('aria-hidden', 'true');
      pagination.append(ellipsis);
      continue;
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.page = String(page);
    button.textContent = String(page);
    button.setAttribute('aria-label', `${page}페이지`);
    if (page === current) button.setAttribute('aria-current', 'page');
    pagination.append(button);
  }
  pagination.hidden = false;
}

function visiblePages(current: number, total: number): Array<number | null> {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);
  const values = new Set([1, total, current - 1, current, current + 1]);
  const pages = [...values].filter((page) => page >= 1 && page <= total).sort((left, right) => left - right);
  const result: Array<number | null> = [];
  pages.forEach((page, index) => {
    const previous = pages[index - 1];
    if (previous !== undefined && page - previous > 1) result.push(null);
    result.push(page);
  });
  return result;
}

function appendHighlightedText(container: HTMLElement, text: string, terms: string[]): void {
  const usableTerms = [...new Set(terms.filter(Boolean))].sort((left, right) => right.length - left.length);
  if (usableTerms.length === 0) {
    container.textContent = text;
    return;
  }
  const expression = new RegExp(`(${usableTerms.map(escapeRegExp).join('|')})`, 'giu');
  let cursor = 0;
  for (const match of text.matchAll(expression)) {
    const index = match.index ?? 0;
    if (index > cursor) container.append(document.createTextNode(text.slice(cursor, index)));
    const mark = document.createElement('mark');
    mark.textContent = match[0];
    container.append(mark);
    cursor = index + match[0].length;
  }
  if (cursor < text.length) container.append(document.createTextNode(text.slice(cursor)));
}

function showState(message: string): void {
  resultsRegion.hidden = true;
  pagination.hidden = true;
  stateTitle.textContent = message;
  state.hidden = false;
}

function updateUrl(query: string, page: number, mode: 'push' | 'replace'): void {
  const url = new URL(window.location.href);
  const trimmed = query.trim();
  if (trimmed) {
    url.searchParams.set('q', trimmed);
    url.searchParams.set('page', String(page));
  } else {
    url.searchParams.delete('q');
    url.searchParams.delete('page');
  }
  const method = mode === 'push' ? 'pushState' : 'replaceState';
  history[method]({}, '', `${url.pathname}${url.search}`);
}

function parsePage(value: string | null): number {
  const page = Number.parseInt(value ?? '1', 10);
  return Number.isFinite(page) && page > 0 ? page : 1;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function readManifest(): BuildManifest {
  const element = document.getElementById('astronet-build');
  if (!element?.textContent) throw new Error('Build manifest is missing');
  return JSON.parse(element.textContent) as BuildManifest;
}

function requiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Required search element is missing: ${id}`);
  return element as T;
}
