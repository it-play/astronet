import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ARTICLE_BUCKET_COUNT, articleBucket, articleUrl, slugifyTitle } from '../../src/content/shared';
import type {
  ArticlePack,
  BoardPack,
  BuildManifest,
  CompiledArticle,
  CompiledBoard,
  GraphEdge,
  GraphFocusPack,
  GraphNode,
  RandomDocument,
  RelatedDocument,
} from '../../src/content/types';
import { analyzeRelationships, RELATIONSHIP_ALGORITHM_VERSION, validateSemantics } from './analysis';
import { ContentError, fail } from './diagnostics';
import { buildGraphArtifacts, GRAPH_LAYOUT_VERSION } from './graph';
import { copyReferencedMedia, inspectMedia } from './media';
import { parseBoard, parseDocument, type SourceBoard, type SourceDocument } from './model';
import {
  extractDocumentText,
  renderDocument,
  renderNavigationBoard,
  type RenderedNavigationBoard,
} from './render';
import { buildSearchArtifacts } from './search-index';
import { parseXml } from './xml';

export const COMPILER_VERSION = '1.6.0';
const SCHEMA_VERSION = 4;
const RANDOM_PACK_SIZE = 256;
const ARTICLE_PACK_BYTE_LIMIT = 4 * 1024 * 1024;
const ARTICLE_BYTE_LIMIT = 1024 * 1024;
const BOARD_INLINE_BYTE_LIMIT = 256 * 1024;
const BOARD_PACK_BYTE_LIMIT = 4 * 1024 * 1024;
const GRAPH_TILE_BYTE_LIMIT = 2 * 1024 * 1024;
const GRAPH_OVERVIEW_BYTE_LIMIT = 4 * 1024 * 1024;
const GRAPH_FOCUS_BUCKET_COUNT = 1024;
const GRAPH_OVERVIEW_HEADER_SIZE = 20;
const GRAPH_OVERVIEW_NODE_STRIDE = 10;
const GRAPH_OVERVIEW_EDGE_STRIDE = 9;

export interface CompileResult {
  manifest: BuildManifest;
  outputDirectory: string;
}

export async function compileContent(rootDirectory: string): Promise<CompileResult> {
  const contentDirectory = path.join(rootDirectory, 'content');
  const documentsDirectory = path.join(contentDirectory, 'documents');
  const boardsDirectory = path.join(contentDirectory, 'boards');
  const mediaDirectory = path.join(contentDirectory, 'media');
  const documentFiles = await discoverFiles(documentsDirectory, (file) => file.endsWith('.xml'));
  const boardFiles = await discoverFiles(boardsDirectory, (file) => file.endsWith('.xml'));
  const mediaFiles = await discoverFiles(
    mediaDirectory,
    (file) => !path.basename(file).startsWith('.') && !/^readme(?:\..+)?$/i.test(path.basename(file)),
  );
  const buildId = await createBuildId(rootDirectory, [...documentFiles, ...boardFiles, ...mediaFiles]);
  const generatedRoot = path.join(rootDirectory, 'public', 'generated');
  const outputDirectory = path.join(generatedRoot, buildId);
  const generatedSourceDirectory = path.join(rootDirectory, 'src', 'generated');

  await rm(generatedRoot, { recursive: true, force: true });
  await mkdir(outputDirectory, { recursive: true });
  await mkdir(generatedSourceDirectory, { recursive: true });

  const documents = await loadDocuments(documentFiles, documentsDirectory);
  const boards = await loadBoards(boardFiles, boardsDirectory);
  for (const id of documents.keys()) {
    if (boards.has(id)) fail('Identifier is shared by a document and navigation board', { source: contentDirectory, target: id });
  }
  const media = await inspectMedia(mediaFiles, buildId);
  const referencedMedia = validateSemantics(documents, boards, media);
  const documentText = new Map([...documents].map(([id, document]) => [id, extractDocumentText(document)]));
  const relationships = analyzeRelationships(documents, boards, documentText);
  const relatedByDocument = buildRelatedDocuments(documents, relationships.relatedScores);
  const compiledArticles = new Map<string, CompiledArticle>();
  const renderedBoards = new Map(
    [...boards.values()]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((board) => [board.id, renderNavigationBoard(board, { documents, media })]),
  );

  for (const document of [...documents.values()].sort((left, right) => left.id.localeCompare(right.id))) {
    const article = renderDocument({
      document,
      documents,
      boards,
      media,
      related: relatedByDocument.get(document.id) ?? [],
    });
    if (Buffer.byteLength(JSON.stringify(article)) > ARTICLE_BYTE_LIMIT) {
      fail(`Compiled article exceeds the ${ARTICLE_BYTE_LIMIT} byte limit`, { source: document.source, target: document.id });
    }
    compiledArticles.set(document.id, article);
  }

  const compiledBoards = await writeBoardPacks(outputDirectory, buildId, renderedBoards);
  await writeArticlePacks(outputDirectory, buildId, compiledArticles, compiledBoards);
  const randomPackCount = await writeRandomPacks(outputDirectory, buildId, documents);
  const searchArtifacts = buildSearchArtifacts(buildId, documents, documentText);
  const searchPaths = await writeSearchArtifacts(outputDirectory, searchArtifacts);
  const graphArtifacts = buildGraphArtifacts(
    buildId,
    documents,
    relationships.strongEdges,
    relationships.weakEdges,
    relationships.boardHubs,
  );
  const graphPaths = await writeGraphArtifacts(outputDirectory, buildId, graphArtifacts);
  await copyReferencedMedia(media, referencedMedia, path.join(outputDirectory, 'media'));

  const manifest: BuildManifest = {
    schemaVersion: SCHEMA_VERSION,
    compilerVersion: COMPILER_VERSION,
    buildId,
    basePath: `/generated/${buildId}`,
    bucketCount: ARTICLE_BUCKET_COUNT,
    randomPackCount,
    randomPackSize: RANDOM_PACK_SIZE,
    search: searchPaths,
    graph: graphPaths,
    counts: {
      documents: documents.size,
      boards: boards.size,
      media: referencedMedia.size,
      strongEdges: relationships.strongEdges.length + relationships.boardHubs.reduce((sum, hub) => sum + hub.members.length, 0),
      weakEdges: relationships.weakEdges.length,
    },
  };

  await writeJson(path.join(outputDirectory, 'manifest.json'), manifest);
  await writeFile(
    path.join(generatedSourceDirectory, 'build-manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );
  await writeFile(
    path.join(outputDirectory, 'algorithms.json'),
    `${JSON.stringify({ relationship: RELATIONSHIP_ALGORITHM_VERSION, graph: GRAPH_LAYOUT_VERSION })}\n`,
    'utf8',
  );

  return { manifest, outputDirectory };
}

async function loadDocuments(files: string[], root: string): Promise<Map<string, SourceDocument>> {
  const documents = new Map<string, SourceDocument>();
  for (const file of files) {
    const document = parseDocument(parseXml(await readFile(file, 'utf8'), relativeDisplay(file)), relativeDisplay(file));
    validateShardedPath(file, root, document.id);
    if (documents.has(document.id)) fail('Document identifier is duplicated', { source: file, target: document.id });
    documents.set(document.id, document);
  }
  return documents;
}

async function loadBoards(files: string[], root: string): Promise<Map<string, SourceBoard>> {
  const boards = new Map<string, SourceBoard>();
  for (const file of files) {
    const board = parseBoard(parseXml(await readFile(file, 'utf8'), relativeDisplay(file)), relativeDisplay(file));
    validateShardedPath(file, root, board.id);
    if (boards.has(board.id)) fail('Navigation board identifier is duplicated', { source: file, target: board.id });
    boards.set(board.id, board);
  }
  return boards;
}

async function writeArticlePacks(
  outputDirectory: string,
  buildId: string,
  articles: Map<string, CompiledArticle>,
  boards: Map<string, CompiledBoard>,
): Promise<void> {
  const packs = new Map<string, ArticlePack>();
  for (const article of articles.values()) {
    const bucket = articleBucket(article.id);
    const pack = packs.get(bucket) ?? { buildId, bucket, articles: {}, boards: {} };
    pack.articles[article.id] = article;
    for (const boardId of article.boardIds) {
      const board = boards.get(boardId);
      if (!board) fail('Compiled navigation board is missing', { source: article.id, target: boardId });
      pack.boards[boardId] = board;
    }
    packs.set(bucket, pack);
  }
  for (const [bucket, pack] of [...packs].sort(([left], [right]) => left.localeCompare(right))) {
    const relative = `articles/${bucket}.json`;
    const serialized = JSON.stringify(pack);
    if (Buffer.byteLength(serialized) > ARTICLE_PACK_BYTE_LIMIT) {
      fail(`Article pack exceeds the ${ARTICLE_PACK_BYTE_LIMIT} byte limit`, {
        source: `generated:${relative}`,
        target: bucket,
      });
    }
    await writeSerialized(path.join(outputDirectory, relative), serialized);
  }
}

async function writeBoardPacks(
  outputDirectory: string,
  buildId: string,
  boards: Map<string, RenderedNavigationBoard>,
): Promise<Map<string, CompiledBoard>> {
  const compiled = new Map<string, CompiledBoard>();
  for (const [boardId, board] of boards) {
    if (Buffer.byteLength(board.fullHtml) <= BOARD_INLINE_BYTE_LIMIT) {
      compiled.set(boardId, { html: board.fullHtml });
      continue;
    }

    const relative = `boards/${articleBucket(boardId, 1024)}/${boardId}.json`;
    const pack: BoardPack = { buildId, boardId, sections: board.sections };
    const serialized = JSON.stringify(pack);
    if (Buffer.byteLength(serialized) > BOARD_PACK_BYTE_LIMIT) {
      fail(`Navigation board pack exceeds the ${BOARD_PACK_BYTE_LIMIT} byte limit`, {
        source: `generated:${relative}`,
        target: boardId,
      });
    }
    await writeSerialized(path.join(outputDirectory, relative), serialized);
    compiled.set(boardId, {
      html: board.shellHtml,
      packPath: `/generated/${buildId}/${relative}`,
    });
  }
  return compiled;
}

async function writeRandomPacks(
  outputDirectory: string,
  buildId: string,
  documents: Map<string, SourceDocument>,
): Promise<number> {
  const records: RandomDocument[] = [...documents.values()]
    .sort((left, right) => stableOrder(buildId, left.id).localeCompare(stableOrder(buildId, right.id)))
    .map((document) => ({ id: document.id, slug: slugifyTitle(document.title), title: document.title }));
  let packCount = 0;
  for (let offset = 0; offset < records.length; offset += RANDOM_PACK_SIZE) {
    const index = offset / RANDOM_PACK_SIZE;
    const relative = `random/${index.toString(16).padStart(3, '0')}.json`;
    await writeJson(path.join(outputDirectory, relative), {
      buildId,
      offset,
      documents: records.slice(offset, offset + RANDOM_PACK_SIZE),
    });
    packCount += 1;
  }
  return packCount;
}

async function writeSearchArtifacts(
  outputDirectory: string,
  artifacts: ReturnType<typeof buildSearchArtifacts>,
): Promise<BuildManifest['search']> {
  const recordShards: string[] = [];
  const termShards: string[] = [];
  const titleShards: string[] = [];
  for (const [bucket, pack] of [...artifacts.recordPacks].sort(([left], [right]) => left.localeCompare(right))) {
    const relative = `search/records/${bucket}.json`;
    await writeJson(path.join(outputDirectory, relative), pack);
    recordShards.push(bucket);
  }
  for (const [shard, value] of [...artifacts.termShards].sort(([left], [right]) => left.localeCompare(right))) {
    const relative = `search/terms/${shard}.json`;
    await writeJson(path.join(outputDirectory, relative), value);
    termShards.push(shard);
  }
  for (const [shard, value] of [...artifacts.titleShards].sort(([left], [right]) => left.localeCompare(right))) {
    const relative = `search/titles/${shard}.json`;
    await writeJson(path.join(outputDirectory, relative), value);
    titleShards.push(shard);
  }
  return { recordShards, termShards, titleShards };
}

async function writeGraphArtifacts(
  outputDirectory: string,
  buildId: string,
  artifacts: ReturnType<typeof buildGraphArtifacts>,
): Promise<BuildManifest['graph']> {
  const overviewRelative = 'graph/overview.bin';
  const overview = serializeGraphOverview(artifacts.overview.nodes, artifacts.overview.edges);
  if (overview.byteLength > GRAPH_OVERVIEW_BYTE_LIMIT) {
    fail(`Graph overview exceeds the ${GRAPH_OVERVIEW_BYTE_LIMIT} byte limit`, {
      source: `generated:${overviewRelative}`,
      target: `${artifacts.overview.nodes.length} nodes, ${artifacts.overview.edges.length} edges`,
    });
  }
  await mkdir(path.dirname(path.join(outputDirectory, overviewRelative)), { recursive: true });
  await writeFile(path.join(outputDirectory, overviewRelative), overview);

  const tileKeys: string[] = [];
  for (const [tileKey, tile] of [...artifacts.detail.tiles].sort(([left], [right]) => left.localeCompare(right))) {
    const relative = `graph/detail/${tileKey}.json`;
    const serialized = JSON.stringify(tile);
    if (Buffer.byteLength(serialized) > GRAPH_TILE_BYTE_LIMIT) {
      fail(`Graph tile exceeds the ${GRAPH_TILE_BYTE_LIMIT} byte limit`, {
        source: `generated:${relative}`,
        target: `detail:${tileKey}`,
      });
    }
    await writeSerialized(path.join(outputDirectory, relative), serialized);
    tileKeys.push(tileKey);
  }

  const focusByBucket = new Map<string, GraphFocusPack>();
  for (const [id, focus] of Object.entries(artifacts.focus)) {
    const bucket = articleBucket(id, GRAPH_FOCUS_BUCKET_COUNT);
    const pack = focusByBucket.get(bucket) ?? { buildId, bucket, focus: {} };
    pack.focus[id] = focus;
    focusByBucket.set(bucket, pack);
  }
  for (const [bucket, pack] of [...focusByBucket].sort(([left], [right]) => left.localeCompare(right))) {
    const relative = `graph/focus/${bucket}.json`;
    await writeJson(path.join(outputDirectory, relative), pack);
  }
  const relative = 'graph/manifest.json';
  await writeJson(path.join(outputDirectory, relative), {
    buildId,
    layoutVersion: GRAPH_LAYOUT_VERSION,
    overview: {
      path: `/generated/${buildId}/${overviewRelative}`,
      nodeCount: artifacts.overview.nodes.length,
      edgeCount: artifacts.overview.edges.length,
    },
    detail: {
      gridSize: artifacts.detail.gridSize,
      nodeCount: artifacts.detail.nodeCount,
      tiles: tileKeys,
    },
  });
  return { manifest: `/generated/${buildId}/${relative}` };
}

function serializeGraphOverview(nodes: GraphNode[], edges: GraphEdge[]): Buffer {
  const nodeById = new Map(nodes.map((node, index) => [node.id, index]));
  const encodedEdges = edges.filter((edge) => nodeById.has(edge.source) && nodeById.has(edge.target));
  const byteLength = GRAPH_OVERVIEW_HEADER_SIZE +
    nodes.length * GRAPH_OVERVIEW_NODE_STRIDE +
    encodedEdges.length * GRAPH_OVERVIEW_EDGE_STRIDE;
  const buffer = Buffer.alloc(byteLength);
  buffer.write('AG3D', 0, 'ascii');
  buffer.writeUInt16LE(1, 4);
  buffer.writeUInt16LE(GRAPH_OVERVIEW_NODE_STRIDE, 6);
  buffer.writeUInt32LE(nodes.length, 8);
  buffer.writeUInt32LE(encodedEdges.length, 12);
  buffer.writeUInt16LE(GRAPH_OVERVIEW_EDGE_STRIDE, 16);

  let offset = GRAPH_OVERVIEW_HEADER_SIZE;
  for (const node of nodes) {
    buffer.writeUInt16LE(quantizeUnit(node.x), offset);
    buffer.writeUInt16LE(quantizeUnit(node.y), offset + 2);
    buffer.writeUInt16LE(quantizeUnit(node.z), offset + 4);
    const encodedSize = node.kind === 'document'
      ? Math.min(65_535, Math.round(Math.log1p(Math.max(1, node.weight)) * 8192))
      : 0;
    buffer.writeUInt16LE(encodedSize, offset + 6);
    buffer.writeUInt8(node.kind === 'document' ? 1 : 0, offset + 8);
    offset += GRAPH_OVERVIEW_NODE_STRIDE;
  }

  for (const edge of encodedEdges) {
    buffer.writeUInt32LE(nodeById.get(edge.source)!, offset);
    buffer.writeUInt32LE(nodeById.get(edge.target)!, offset + 4);
    buffer.writeUInt8(edge.strength === 'strong' ? 1 : 0, offset + 8);
    offset += GRAPH_OVERVIEW_EDGE_STRIDE;
  }
  return buffer;
}

function quantizeUnit(value: number): number {
  return Math.min(65_535, Math.max(0, Math.round(value * 65_535)));
}

function buildRelatedDocuments(
  documents: Map<string, SourceDocument>,
  scores: Map<string, Array<{ id: string; score: number }>>,
): Map<string, RelatedDocument[]> {
  const result = new Map<string, RelatedDocument[]>();
  for (const [id, related] of scores) {
    result.set(
      id,
      related.flatMap(({ id: targetId }) => {
        const target = documents.get(targetId);
        return target
          ? [{ id: target.id, title: target.title, url: articleUrl(target.id, target.title) }]
          : [];
      }),
    );
  }
  return result;
}

async function discoverFiles(directory: string, include: (file: string) => boolean): Promise<string[]> {
  try {
    const directoryStat = await lstat(directory);
    if (directoryStat.isSymbolicLink()) fail('Content source directories must not be symbolic links', { source: directory });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const files: string[] = [];
  const walk = async (current: string) => {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const target = path.join(current, entry.name);
      if (entry.isSymbolicLink()) fail('Content sources must not be symbolic links', { source: target });
      if (entry.isDirectory()) await walk(target);
      else if (entry.isFile() && include(target)) files.push(target);
    }
  };
  await walk(directory);
  return files.sort();
}

function validateShardedPath(file: string, root: string, id: string): void {
  const relative = path.relative(root, file);
  const parts = relative.split(path.sep);
  const expectedPrefix = createHash('sha256').update(id).digest('hex').slice(0, 2);
  if (parts.length !== 2 || parts[0] !== expectedPrefix || parts[1] !== `${id}.xml`) {
    fail(`Source path must be ${expectedPrefix}/${id}.xml`, { source: relative, target: id });
  }
}

async function createBuildId(root: string, files: string[]): Promise<string> {
  const hash = createHash('sha256').update(`astronet:${COMPILER_VERSION}\0`);
  const compilerFiles = await discoverFiles(path.join(root, 'scripts', 'content'), (file) => file.endsWith('.ts'));
  const sharedCompilerFiles = [
    path.join(root, 'src', 'content', 'board-registry.ts'),
    path.join(root, 'src', 'content', 'shared.ts'),
    path.join(root, 'src', 'content', 'types.ts'),
    path.join(root, 'content', 'astronet.xsd'),
  ];
  const inputs = [...new Set([...files, ...compilerFiles, ...sharedCompilerFiles])].sort();
  for (const file of inputs) {
    hash.update(path.relative(root, file).split(path.sep).join('/')).update('\0');
    hash.update(await readFile(file)).update('\0');
  }
  return hash.digest('base64url').slice(0, 20);
}

function stableOrder(buildId: string, id: string): string {
  return createHash('sha256').update(`${buildId}:${id}`).digest('hex');
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await writeSerialized(file, JSON.stringify(value));
}

async function writeSerialized(file: string, value: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${value}\n`, 'utf8');
}

function relativeDisplay(file: string): string {
  return path.relative(process.cwd(), file).split(path.sep).join('/');
}

export function formatCompilerError(error: unknown): string {
  if (error instanceof ContentError) return error.format();
  if (error instanceof Error) return error.message;
  return String(error);
}
