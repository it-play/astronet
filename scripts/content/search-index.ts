import {
  articleUrl,
  normalizeSearchText,
  searchRecordBucket,
  searchShardKey,
  slugifyTitle,
  titleSearchShardKey,
} from '../../src/content/shared';
import type {
  SearchPosting,
  SearchRecordPack,
  SearchShard,
  TitleSearchEntry,
  TitleSearchShard,
} from '../../src/content/types';
import { tokenizeText } from './analysis';
import type { SourceDocument } from './model';

export interface SearchArtifacts {
  recordPacks: Map<string, SearchRecordPack>;
  termShards: Map<string, SearchShard>;
  titleShards: Map<string, TitleSearchShard>;
}

export function buildSearchArtifacts(
  buildId: string,
  documents: Map<string, SourceDocument>,
  documentText: Map<string, string>,
): SearchArtifacts {
  const recordPacks = new Map<string, SearchRecordPack>();
  const termMaps = new Map<string, Map<string, Map<string, SearchPosting>>>();
  const titleMaps = new Map<string, Map<string, Map<string, TitleSearchEntry>>>();

  for (const document of [...documents.values()].sort((left, right) => left.id.localeCompare(right.id))) {
    const bucket = searchRecordBucket(document.id);
    const recordPack = recordPacks.get(bucket) ?? { buildId, bucket, records: {} };
    recordPack.records[document.id] = {
      id: document.id,
      title: document.title,
      slug: slugifyTitle(document.title),
      url: articleUrl(document.id, document.title),
      text: documentText.get(document.id) ?? '',
    };
    recordPacks.set(bucket, recordPack);

    indexBodyTerms(termMaps, document.id, documentText.get(document.id) ?? '');
    indexWeightedTerms(termMaps, document.id, document.title, 12);
    document.aliases.forEach((alias) => indexWeightedTerms(termMaps, document.id, alias, 9));
    indexTitleValue(titleMaps, document.id, document.title, 'title');
    document.aliases.forEach((alias) => indexTitleValue(titleMaps, document.id, alias, 'alias'));
  }

  const termShards = new Map<string, SearchShard>();
  for (const [shard, terms] of termMaps) {
    termShards.set(shard, {
      buildId,
      terms: Object.fromEntries(
        [...terms]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([term, postings]) => [
            term,
            [...postings.values()].sort((left, right) => right.weight - left.weight || left.id.localeCompare(right.id)),
          ]),
      ),
    });
  }

  const titleShards = new Map<string, TitleSearchShard>();
  for (const [shard, keys] of titleMaps) {
    titleShards.set(shard, {
      buildId,
      keys: Object.fromEntries(
        [...keys]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, entries]) => [key, [...entries.values()].sort((left, right) => left[0].localeCompare(right[0]))]),
      ),
    });
  }

  return { recordPacks, termShards, titleShards };
}

function indexBodyTerms(
  shards: Map<string, Map<string, Map<string, SearchPosting>>>,
  id: string,
  text: string,
): void {
  const positionsByTerm = new Map<string, number[]>();
  tokenizeText(text).forEach((term, position) => {
    const positions = positionsByTerm.get(term) ?? [];
    positions.push(position);
    positionsByTerm.set(term, positions);
  });
  for (const [term, positions] of positionsByTerm) addPosting(shards, term, id, positions, 1);
}

function indexWeightedTerms(
  shards: Map<string, Map<string, Map<string, SearchPosting>>>,
  id: string,
  value: string,
  weight: number,
): void {
  for (const term of new Set(tokenizeText(value))) addPosting(shards, term, id, [], weight);
}

function addPosting(
  shards: Map<string, Map<string, Map<string, SearchPosting>>>,
  term: string,
  id: string,
  positions: number[],
  weight: number,
): void {
  const shardKey = searchShardKey(term);
  const shard = shards.get(shardKey) ?? new Map<string, Map<string, SearchPosting>>();
  const postings = shard.get(term) ?? new Map<string, SearchPosting>();
  const previous = postings.get(id);
  postings.set(id, {
    id,
    positions: previous ? [...new Set([...previous.positions, ...positions])] : positions,
    weight: (previous?.weight ?? 0) + weight,
  });
  shard.set(term, postings);
  shards.set(shardKey, shard);
}

function indexTitleValue(
  shards: Map<string, Map<string, Map<string, TitleSearchEntry>>>,
  id: string,
  rawValue: string,
  field: 'title' | 'alias',
): void {
  const value = normalizeSearchText(rawValue);
  if (!value) return;
  const keys = new Set<string>([`=${value}`]);
  for (let length = 1; length < Math.min(32, value.length); length += 1) keys.add(`^${value.slice(0, length)}`);
  if (value.length <= 64) {
    for (let index = 0; index < value.length; index += 1) {
      keys.add(`~${value.slice(0, index) + value.slice(index + 1)}`);
    }
  }
  for (const key of keys) {
    const shardKey = titleSearchShardKey(key);
    const shard = shards.get(shardKey) ?? new Map<string, Map<string, TitleSearchEntry>>();
    const entries = shard.get(key) ?? new Map<string, TitleSearchEntry>();
    entries.set(`${id}:${field}`, [id, field]);
    shard.set(key, entries);
    shards.set(shardKey, shard);
  }
}
