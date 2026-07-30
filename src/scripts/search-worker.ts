/// <reference lib="webworker" />

import { normalizeSearchText, searchRecordBucket, searchShardKey, titleSearchShardKey } from '../content/shared';
import type {
  BuildManifest,
  SearchPosting,
  SearchRecord,
  SearchRecordPack,
  SearchShard,
  TitleSearchEntry,
  TitleSearchShard,
} from '../content/types';

interface SearchRequest {
  type: 'search';
  requestId: number;
  manifest: BuildManifest;
  query: string;
  page: number;
  pageSize: number;
}

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

const scope = self as unknown as DedicatedWorkerGlobalScope;
const assetCache = new Map<string, Promise<unknown>>();

scope.addEventListener('message', (event: MessageEvent<SearchRequest>) => {
  if (event.data.type !== 'search') return;
  void executeSearch(event.data).then(
    (response) => scope.postMessage(response),
    () => {
      const response: SearchResponse = {
        type: 'error',
        requestId: event.data.requestId,
        query: event.data.query,
        page: 1,
        pageCount: 0,
        total: 0,
        results: [],
        highlightTerms: [],
        message: '검색 결과를 불러오지 못했습니다.',
      };
      scope.postMessage(response);
    },
  );
});

async function executeSearch(request: SearchRequest): Promise<SearchResponse> {
  const parsed = parseQuery(request.query);
  if (parsed.error) {
    return responseFor(request, { message: parsed.error });
  }
  if (!parsed.value) return responseFor(request);

  const scores = new Map<string, number>();
  const exactTitleIds = new Set<string>();
  const exactEntries = await loadTitleEntries(request.manifest, new Set([`=${parsed.normalized}`]));
  for (const entry of exactEntries.values()) {
    exactTitleIds.add(entry[0]);
    const score = entry[1] === 'title' ? 10_000 : 9_000;
    scores.set(entry[0], Math.max(scores.get(entry[0]) ?? 0, score));
  }
  if (!parsed.quoted && parsed.normalized.length >= 2) {
    const prefixEntries = await loadTitleEntries(request.manifest, new Set([`^${parsed.normalized}`]));
    for (const entry of prefixEntries.values()) {
      const score = entry[1] === 'title' ? 7_000 : 6_500;
      scores.set(entry[0], Math.max(scores.get(entry[0]) ?? 0, score));
    }
    const typoKeys = new Set([`~${parsed.normalized}`, ...deletions(parsed.normalized).map((value) => `~${value}`)]);
    const typoEntries = await loadTitleEntries(request.manifest, typoKeys);
    for (const entry of typoEntries.values()) {
      const score = entry[1] === 'title' ? 5_000 : 4_500;
      scores.set(entry[0], Math.max(scores.get(entry[0]) ?? 0, score));
    }
  }

  const postingsByTerm = new Map<string, SearchPosting[]>();
  if (parsed.normalized.length >= 2) {
    await Promise.all(
      parsed.terms.map(async (term) => {
        const shardPath = request.manifest.search.termShards[searchShardKey(term)];
        if (!shardPath) return;
        const shard = await fetchAsset<SearchShard>(shardPath, request.manifest.buildId);
        const postings = shard.terms[term] ?? [];
        postingsByTerm.set(term, postings);
        for (const posting of postings) {
          scores.set(posting.id, (scores.get(posting.id) ?? 0) + posting.weight * 24);
        }
      }),
    );
  }

  if (parsed.quoted && parsed.terms.length > 0) {
    const phraseIds = new Set<string>();
    for (const id of scores.keys()) {
      if (hasPhraseAtConsecutivePositions(id, parsed.terms, postingsByTerm)) {
        phraseIds.add(id);
        scores.set(id, (scores.get(id) ?? 0) + 3_000);
      }
    }
    for (const id of scores.keys()) {
      if (!exactTitleIds.has(id) && !phraseIds.has(id)) scores.delete(id);
    }
  } else if (parsed.quoted) {
    for (const id of scores.keys()) {
      if (!exactTitleIds.has(id)) scores.delete(id);
    }
  }

  const ranked = [...scores]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([id]) => id);
  const pageCount = Math.ceil(ranked.length / request.pageSize);
  const page = Math.min(Math.max(1, request.page), Math.max(1, pageCount));
  const visibleIds = ranked.slice((page - 1) * request.pageSize, page * request.pageSize);
  const records = await loadRecords(request.manifest, visibleIds);
  const results = visibleIds
    .map((id) => records.get(id))
    .filter((record): record is SearchRecord => Boolean(record))
    .map((record) => ({
      id: record.id,
      title: record.title,
      url: record.url,
      excerpt: excerptFor(record.text, parsed.highlightTerms),
    }));

  return {
    type: 'result',
    requestId: request.requestId,
    query: request.query,
    page,
    pageCount,
    total: ranked.length,
    results,
    highlightTerms: parsed.highlightTerms,
  };
}

function parseQuery(rawQuery: string): {
  value: string;
  normalized: string;
  quoted: boolean;
  terms: string[];
  highlightTerms: string[];
  error?: string;
} {
  const value = rawQuery.normalize('NFC').trim();
  if (!value) return { value: '', normalized: '', quoted: false, terms: [], highlightTerms: [] };
  if (value.length > 120) {
    return { value, normalized: '', quoted: false, terms: [], highlightTerms: [], error: '검색어를 조금 짧게 입력해 주세요.' };
  }
  const beginsQuote = value.startsWith('"');
  const endsQuote = value.endsWith('"');
  if (beginsQuote !== endsQuote || (beginsQuote && value.length < 3)) {
    return { value, normalized: '', quoted: false, terms: [], highlightTerms: [], error: '따옴표를 닫아 주세요.' };
  }
  const quoted = beginsQuote && endsQuote;
  const content = quoted ? value.slice(1, -1).trim() : value;
  const normalized = normalizeSearchText(content);
  const terms = tokenize(content);
  const highlightTerms = [...new Set([content, ...terms].filter((term) => term.length >= 2))].sort(
    (left, right) => right.length - left.length,
  );
  return { value: content, normalized, quoted, terms, highlightTerms };
}

async function loadTitleEntries(
  manifest: BuildManifest,
  keys: Set<string>,
): Promise<Map<string, TitleSearchEntry>> {
  const byShard = new Map<string, string[]>();
  for (const key of keys) {
    if (!key) continue;
    const shard = titleSearchShardKey(key);
    const values = byShard.get(shard) ?? [];
    values.push(key);
    byShard.set(shard, values);
  }
  const entries = new Map<string, TitleSearchEntry>();
  await Promise.all(
    [...byShard].map(async ([shardKey, shardKeys]) => {
      const path = manifest.search.titleShards[shardKey];
      if (!path) return;
      const shard = await fetchAsset<TitleSearchShard>(path, manifest.buildId);
      for (const key of shardKeys) {
        for (const entry of shard.keys[key] ?? []) entries.set(`${entry[0]}:${entry[1]}`, entry);
      }
    }),
  );
  return entries;
}

async function loadRecords(manifest: BuildManifest, ids: string[]): Promise<Map<string, SearchRecord>> {
  const byBucket = new Map<string, string[]>();
  for (const id of ids) {
    const bucket = searchRecordBucket(id);
    const values = byBucket.get(bucket) ?? [];
    values.push(id);
    byBucket.set(bucket, values);
  }
  const records = new Map<string, SearchRecord>();
  await Promise.all(
    [...byBucket].map(async ([bucket, bucketIds]) => {
      const path = manifest.search.recordPacks[bucket];
      if (!path) return;
      const pack = await fetchAsset<SearchRecordPack>(path, manifest.buildId);
      for (const id of bucketIds) {
        const record = pack.records[id];
        if (record) records.set(id, record);
      }
    }),
  );
  return records;
}

async function fetchAsset<T extends { buildId: string }>(path: string, buildId: string): Promise<T> {
  const cached = assetCache.get(path);
  if (cached) return (await cached) as T;
  const request = fetch(path, { cache: 'force-cache' }).then(async (response) => {
    if (!response.ok) throw new Error('Search asset request failed');
    const value = (await response.json()) as T;
    if (value.buildId !== buildId) throw new Error('Search asset build mismatch');
    return value;
  });
  assetCache.set(path, request);
  try {
    return await request;
  } catch (cause) {
    assetCache.delete(path);
    throw cause;
  }
}

function hasPhraseAtConsecutivePositions(
  id: string,
  terms: string[],
  postingsByTerm: Map<string, SearchPosting[]>,
): boolean {
  const positions = terms.map((term) => postingsByTerm.get(term)?.find((posting) => posting.id === id)?.positions ?? []);
  if (positions.some((values) => values.length === 0)) return false;
  const following = positions.slice(1).map((values) => new Set(values));
  return positions[0]?.some((start) => following.every((values, index) => values.has(start + index + 1))) ?? false;
}

function excerptFor(text: string, terms: string[]): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  if (!compact) return '';
  const normalized = compact.toLocaleLowerCase('ko-KR');
  const positions = terms
    .map((term) => normalized.indexOf(term.toLocaleLowerCase('ko-KR')))
    .filter((position) => position >= 0);
  const match = positions.length > 0 ? Math.min(...positions) : 0;
  const start = Math.max(0, match - 56);
  const end = Math.min(compact.length, Math.max(180, match + 124));
  return `${start > 0 ? '…' : ''}${compact.slice(start, end).trim()}${end < compact.length ? '…' : ''}`;
}

function tokenize(text: string): string[] {
  const segmenter = new Intl.Segmenter('ko', { granularity: 'word' });
  const tokens: string[] = [];
  for (const segment of segmenter.segment(text.normalize('NFC').toLocaleLowerCase('ko-KR'))) {
    const token = segment.segment.replace(/[^0-9a-z가-힣ㄱ-ㅎㅏ-ㅣ]/g, '');
    if (!segment.isWordLike || token.length < 2 || token.length > 64) continue;
    tokens.push(token);
  }
  return [...new Set(tokens)];
}

function deletions(value: string): string[] {
  if (value.length < 2 || value.length > 64) return [];
  return [...new Set([...value].map((_, index) => value.slice(0, index) + value.slice(index + 1)))];
}

function responseFor(request: SearchRequest, options: { message?: string } = {}): SearchResponse {
  return {
    type: 'result',
    requestId: request.requestId,
    query: request.query,
    page: 1,
    pageCount: 0,
    total: 0,
    results: [],
    highlightTerms: [],
    message: options.message,
  };
}
