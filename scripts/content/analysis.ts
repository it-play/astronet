import { createHash } from 'node:crypto';
import type { GraphEdge } from '../../src/content/types';
import { fail } from './diagnostics';
import type { MediaAsset } from './media';
import { requireMedia } from './media';
import type {
  BlockNode,
  BoardEntry,
  InlineNode,
  SourceBoard,
  SourceDocument,
} from './model';

export const RELATIONSHIP_ALGORITHM_VERSION = 'lexical-v2';
const WEAK_NEIGHBOR_LIMIT = 8;
const WEAK_SIMILARITY_THRESHOLD = 0.08;
const RELATED_THRESHOLD = 3;
const TWO_HOP_NEIGHBOR_LIMIT = 32;
const TWO_HOP_CANDIDATE_LIMIT = 32;
const BOARD_AFFINITY_NEIGHBOR_LIMIT = 8;
const KOREAN_WORD_SEGMENTER = new Intl.Segmenter('ko', { granularity: 'word' });

interface LocatedReference {
  targetId: string;
  sectionId?: string;
  source: string;
  line: number;
  column: number;
}

export interface BoardHub {
  id: string;
  boardId: string;
  group: string;
  members: string[];
}

export interface RelationshipAnalysis {
  strongEdges: GraphEdge[];
  weakEdges: GraphEdge[];
  boardHubs: BoardHub[];
  relatedScores: Map<string, Array<{ id: string; score: number }>>;
  lexicalTerms: Map<string, Map<string, number>>;
}

export function validateSemantics(
  documents: Map<string, SourceDocument>,
  boards: Map<string, SourceBoard>,
  media: Map<string, MediaAsset>,
): Set<string> {
  const referencedMedia = new Set<string>();
  const sectionsByDocument = new Map<string, Set<string>>();

  for (const document of documents.values()) {
    const sections = new Set<string>();
    visitBlocks(document.body, (block) => {
      if (block.type === 'section' && block.stableId) sections.add(block.stableId);
    });
    sectionsByDocument.set(document.id, sections);
  }

  for (const document of documents.values()) {
    const includedBoards = new Set<string>();
    for (const targetId of document.connections) {
      if (targetId === document.id) {
        semanticError('Manual connection cannot target its own document', document.source, targetId);
      }
      requireDocument(documents, targetId, document.source);
    }

    visitBlocks(document.body, (block) => {
      if (block.type === 'board') {
        if (!boards.has(block.boardId)) semanticError('Included navigation board does not exist', block.source, block.boardId);
        if (includedBoards.has(block.boardId)) {
          semanticError('Navigation board cannot be included more than once in one document', block.source, block.boardId);
        }
        includedBoards.add(block.boardId);
      }
      if (block.type === 'figure') {
        requireMedia(media, block.assetId, 'image', block.source);
        referencedMedia.add(block.assetId);
        if (block.targetId) requireDocument(documents, block.targetId, block.source);
      }
      if (block.type === 'video') {
        if (block.assetId) {
          requireMedia(media, block.assetId, 'video', block.source);
          referencedMedia.add(block.assetId);
        }
        if (block.posterId) {
          requireMedia(media, block.posterId, 'image', block.source);
          referencedMedia.add(block.posterId);
        }
        if (block.trackId) {
          requireMedia(media, block.trackId, 'track', block.source);
          referencedMedia.add(block.trackId);
        }
        validateProviderUrl(block.provider, block.videoId, block.directUrl, block.source);
      }
      for (const reference of referencesInBlock(block)) {
        requireDocument(documents, reference.targetId, reference.source);
        if (reference.sectionId && !sectionsByDocument.get(reference.targetId)?.has(reference.sectionId)) {
          semanticError('Internal reference targets a missing stable section', reference.source, `${reference.targetId}#${reference.sectionId}`);
        }
      }
    });
  }

  for (const board of boards.values()) {
    if (board.headerAssetId) {
      requireMedia(media, board.headerAssetId, 'image', board.source);
      referencedMedia.add(board.headerAssetId);
    }
    for (const section of board.sections) {
      if (section.assetId) {
        requireMedia(media, section.assetId, 'image', section.source);
        referencedMedia.add(section.assetId);
      }
      for (const entry of section.entries) {
        requireDocument(documents, entry.targetId, entry.source);
        if (entry.assetId) {
          requireMedia(media, entry.assetId, 'image', entry.source);
          referencedMedia.add(entry.assetId);
        }
      }
    }
  }

  return referencedMedia;
}

export function analyzeRelationships(
  documents: Map<string, SourceDocument>,
  boards: Map<string, SourceBoard>,
  documentText: Map<string, string>,
): RelationshipAnalysis {
  const strong = new Map<string, GraphEdge>();
  const adjacency = new Map<string, Set<string>>();

  for (const document of documents.values()) {
    const targets = new Set(document.connections);
    visitBlocks(document.body, (block) => {
      for (const reference of referencesInBlock(block)) targets.add(reference.targetId);
    });
    for (const targetId of targets) {
      if (targetId === document.id) continue;
      const [source, target] = canonicalPair(document.id, targetId);
      strong.set(`${source}\0${target}`, { source, target, strength: 'strong', weight: 1 });
      addNeighbor(adjacency, source, target);
      addNeighbor(adjacency, target, source);
    }
  }

  const boardHubs = buildBoardHubs(boards);
  const lexicalTerms = new Map<string, Map<string, number>>();
  for (const [id, text] of documentText) lexicalTerms.set(id, termCounts(text));
  const weak = buildWeakEdges(lexicalTerms, strong);
  const weakPairs = new Set(weak.map((edge) => pairKey(edge.source, edge.target)));
  const scoreByPair = new Map<string, number>();

  for (const edge of strong.values()) scoreByPair.set(pairKey(edge.source, edge.target), 100);
  for (const edge of weak) scoreByPair.set(pairKey(edge.source, edge.target), edge.weight * 20);

  const boundedAdjacency = new Map<string, string[]>();
  const boundedNeighbors = (id: string): string[] => {
    const existing = boundedAdjacency.get(id);
    if (existing) return existing;
    const selected = [...(adjacency.get(id) ?? [])]
      .sort((left, right) => (adjacency.get(left)?.size ?? 0) - (adjacency.get(right)?.size ?? 0) || left.localeCompare(right))
      .slice(0, TWO_HOP_NEIGHBOR_LIMIT);
    boundedAdjacency.set(id, selected);
    return selected;
  };
  for (const [source, neighbors] of adjacency) {
    const candidates = new Set<string>();
    for (const middle of boundedNeighbors(source)) {
      for (const target of boundedNeighbors(middle)) {
        if (source === target || neighbors.has(target)) continue;
        candidates.add(target);
      }
    }
    for (const target of [...candidates]
      .sort((left, right) => (adjacency.get(right)?.size ?? 0) - (adjacency.get(left)?.size ?? 0) || left.localeCompare(right))
      .slice(0, TWO_HOP_CANDIDATE_LIMIT)) {
      const key = pairKey(source, target);
      scoreByPair.set(key, Math.max(scoreByPair.get(key) ?? 0, 15));
    }
  }

  const groupsByDocument = new Map<string, Set<string>>();
  const groupSizes = new Map<string, number>();
  for (const hub of boardHubs) {
    groupSizes.set(hub.id, hub.members.length);
    for (const member of hub.members) {
      const groups = groupsByDocument.get(member) ?? new Set<string>();
      groups.add(hub.id);
      groupsByDocument.set(member, groups);
    }
    for (const [source, target] of boundedBoardPairs(hub)) {
      const key = pairKey(source, target);
      if (!scoreByPair.has(key)) scoreByPair.set(key, 0);
    }
  }

  for (const [key, score] of scoreByPair) {
    const [source, target] = key.split('\0');
    const sharedGroups = [...(groupsByDocument.get(source) ?? [])].filter((group) => groupsByDocument.get(target)?.has(group));
    const boardBoost = sharedGroups.reduce((sum, group) => sum + 8 / Math.max(1, Math.log2((groupSizes.get(group) ?? 1) + 1)), 0);
    const sourceTags = new Set(documents.get(source)?.tags ?? []);
    const sharedTag = (documents.get(target)?.tags ?? []).some((tag) => sourceTags.has(tag));
    const weakCandidate = weakPairs.has(key);
    scoreByPair.set(key, score + boardBoost + (sharedTag && weakCandidate ? 2 : 0));
  }

  const relatedScores = new Map<string, Array<{ id: string; score: number }>>();
  for (const [key, score] of scoreByPair) {
    if (score < RELATED_THRESHOLD) continue;
    const [source, target] = key.split('\0');
    pushRelated(relatedScores, source, target, score);
    pushRelated(relatedScores, target, source, score);
  }
  for (const [id, related] of relatedScores) {
    relatedScores.set(
      id,
      related.sort((left, right) => right.score - left.score || left.id.localeCompare(right.id)).slice(0, 10),
    );
  }

  return {
    strongEdges: [...strong.values()].sort(compareEdges),
    weakEdges: weak.sort(compareEdges),
    boardHubs,
    relatedScores,
    lexicalTerms,
  };
}

function boundedBoardPairs(hub: BoardHub): Array<[string, string]> {
  const pairs = new Map<string, [string, string]>();
  const limit = Math.min(BOARD_AFFINITY_NEIGHBOR_LIMIT, hub.members.length - 1);
  for (let index = 0; index < hub.members.length; index += 1) {
    const source = hub.members[index]!;
    for (let offset = 1; offset <= limit; offset += 1) {
      const target = hub.members[(index + offset) % hub.members.length]!;
      const pair = canonicalPair(source, target);
      pairs.set(pairKey(...pair), pair);
    }
  }
  return [...pairs.values()];
}

export function tokenizeText(text: string): string[] {
  const tokens: string[] = [];
  for (const segment of KOREAN_WORD_SEGMENTER.segment(text.normalize('NFC').toLocaleLowerCase('ko-KR'))) {
    const token = segment.segment.replace(/[^0-9a-z가-힣ㄱ-ㅎㅏ-ㅣ]/g, '');
    if (!segment.isWordLike || token.length < 2 || token.length > 64) continue;
    tokens.push(token);
  }
  return tokens;
}

function buildWeakEdges(
  lexicalTerms: Map<string, Map<string, number>>,
  strong: Map<string, GraphEdge>,
): GraphEdge[] {
  const documentCount = lexicalTerms.size;
  if (documentCount < 2) return [];
  const documentFrequency = new Map<string, number>();
  for (const terms of lexicalTerms.values()) {
    for (const term of terms.keys()) documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
  }

  const vectors = new Map<string, Map<string, number>>();
  const norms = new Map<string, number>();
  const postings = new Map<string, Array<{ id: string; weight: number }>>();
  for (const [id, counts] of lexicalTerms) {
    const weighted = [...counts]
      .map(([term, count]) => {
        const idf = Math.log((documentCount + 1) / ((documentFrequency.get(term) ?? 0) + 1)) + 1;
        return [term, (1 + Math.log(count)) * idf] as const;
      })
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, 160);
    const vector = new Map(weighted);
    vectors.set(id, vector);
    norms.set(id, Math.sqrt(weighted.reduce((sum, [, weight]) => sum + weight * weight, 0)) || 1);
    for (const [term, weight] of weighted) {
      const list = postings.get(term) ?? [];
      list.push({ id, weight });
      postings.set(term, list);
    }
  }

  const dots = new Map<string, Map<string, number>>();
  for (const list of postings.values()) {
    if (list.length < 2 || list.length > 64) continue;
    for (let left = 0; left < list.length; left += 1) {
      for (let right = left + 1; right < list.length; right += 1) {
        addDot(dots, list[left].id, list[right].id, list[left].weight * list[right].weight);
        addDot(dots, list[right].id, list[left].id, list[left].weight * list[right].weight);
      }
    }
  }

  const nearest = new Map<string, Array<{ id: string; similarity: number }>>();
  for (const [id, candidates] of dots) {
    const norm = norms.get(id) ?? 1;
    const ranked = [...candidates]
      .map(([candidateId, dot]) => ({
        id: candidateId,
        similarity: dot / (norm * (norms.get(candidateId) ?? 1)),
      }))
      .filter((candidate) => candidate.similarity >= WEAK_SIMILARITY_THRESHOLD)
      .sort((left, right) => right.similarity - left.similarity || left.id.localeCompare(right.id))
      .slice(0, WEAK_NEIGHBOR_LIMIT);
    nearest.set(id, ranked);
  }

  const edges = new Map<string, GraphEdge>();
  for (const [source, candidates] of nearest) {
    for (const candidate of candidates) {
      if (!nearest.get(candidate.id)?.some((reverse) => reverse.id === source)) continue;
      const [left, right] = canonicalPair(source, candidate.id);
      const key = pairKey(left, right);
      if (strong.has(key)) continue;
      const reverse = nearest.get(candidate.id)?.find((item) => item.id === source)?.similarity ?? candidate.similarity;
      edges.set(key, {
        source: left,
        target: right,
        strength: 'weak',
        weight: Number(((candidate.similarity + reverse) / 2).toFixed(6)),
      });
    }
  }
  return [...edges.values()];
}

function buildBoardHubs(boards: Map<string, SourceBoard>): BoardHub[] {
  const hubs: BoardHub[] = [];
  for (const board of boards.values()) {
    const groups = new Map<string, Set<string>>();
    for (const section of board.sections) {
      const members = groups.get(section.group) ?? new Set<string>();
      for (const entry of section.entries) members.add(entry.targetId);
      groups.set(section.group, members);
    }
    for (const [group, members] of groups) {
      hubs.push({
        id: `hub-${createHash('sha256').update(`${board.id}:${group}`).digest('hex').slice(0, 20)}`,
        boardId: board.id,
        group,
        members: [...members].sort(),
      });
    }
  }
  return hubs.sort((left, right) => left.id.localeCompare(right.id));
}

function termCounts(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const token of tokenizeText(text)) counts.set(token, (counts.get(token) ?? 0) + 1);
  return counts;
}

function referencesInBlock(block: BlockNode): LocatedReference[] {
  const references: LocatedReference[] = [];
  const collect = (nodes: readonly InlineNode[]) => {
    for (const node of nodes) {
      if (node.type === 'ref') {
        references.push({
          targetId: node.targetId,
          sectionId: node.sectionId,
          source: node.source,
          line: node.line,
          column: node.column,
        });
      }
      if (node.type !== 'text') collect(node.children);
    }
  };

  switch (block.type) {
    case 'paragraph':
      collect(block.children);
      break;
    case 'list':
      block.items.forEach(collect);
      break;
    case 'table':
      block.head.forEach(collect);
      block.rows.flat().forEach(collect);
      break;
    case 'figure':
    case 'video':
      if (block.caption) collect(block.caption);
      break;
    case 'section':
    case 'quote':
    case 'board':
    case 'rule':
      break;
  }
  return references;
}

function visitBlocks(blocks: BlockNode[], visitor: (block: BlockNode) => void): void {
  for (const block of blocks) {
    visitor(block);
    if (block.type === 'section' || block.type === 'quote') visitBlocks(block.blocks, visitor);
  }
}

function validateProviderUrl(
  provider: 'youtube' | 'vimeo' | undefined,
  videoId: string | undefined,
  directUrl: string | undefined,
  source: string,
): void {
  if (!provider || !videoId || !directUrl) return;
  const url = new URL(directUrl);
  const host = url.hostname.replace(/^www\./, '');
  const allowed = provider === 'youtube' ? ['youtube.com', 'youtu.be'] : ['vimeo.com'];
  if (!allowed.some((domain) => host === domain || host.endsWith(`.${domain}`))) {
    semanticError('External video URL does not match its allowlisted provider', source, directUrl);
  }
  const segments = url.pathname.split('/').filter(Boolean);
  const directVideoId = provider === 'youtube'
    ? host === 'youtu.be'
      ? segments[0]
      : url.searchParams.get('v') ?? (['embed', 'shorts', 'live'].includes(segments[0] ?? '') ? segments[1] : undefined)
    : segments.at(-1);
  if (directVideoId !== videoId) {
    semanticError('External video URL does not identify the declared video', source, directUrl);
  }
}

function requireDocument(documents: Map<string, SourceDocument>, id: string, source: string): SourceDocument {
  const document = documents.get(id);
  if (!document) semanticError('Referenced document does not exist', source, id);
  return document;
}

function semanticError(message: string, source: string, target: string): never {
  fail(message, { source, target });
}

function canonicalPair(left: string, right: string): [string, string] {
  return left.localeCompare(right) <= 0 ? [left, right] : [right, left];
}

function pairKey(left: string, right: string): string {
  const [source, target] = canonicalPair(left, right);
  return `${source}\0${target}`;
}

function addNeighbor(adjacency: Map<string, Set<string>>, source: string, target: string): void {
  const neighbors = adjacency.get(source) ?? new Set<string>();
  neighbors.add(target);
  adjacency.set(source, neighbors);
}

function addDot(dots: Map<string, Map<string, number>>, source: string, target: string, value: number): void {
  const candidates = dots.get(source) ?? new Map<string, number>();
  candidates.set(target, (candidates.get(target) ?? 0) + value);
  if (candidates.size > 512) {
    const kept = [...candidates].sort((left, right) => right[1] - left[1]).slice(0, 256);
    candidates.clear();
    for (const [id, score] of kept) candidates.set(id, score);
  }
  dots.set(source, candidates);
}

function pushRelated(
  related: Map<string, Array<{ id: string; score: number }>>,
  source: string,
  target: string,
  score: number,
): void {
  const values = related.get(source) ?? [];
  values.push({ id: target, score: Number(score.toFixed(6)) });
  related.set(source, values);
}

function compareEdges(left: GraphEdge, right: GraphEdge): number {
  return left.source.localeCompare(right.source) || left.target.localeCompare(right.target);
}
