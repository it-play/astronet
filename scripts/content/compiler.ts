import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ARTICLE_BUCKET_COUNT, articleBucket, articleUrl, slugifyTitle } from '../../src/content/shared';
import type {
  ArticlePack,
  BuildManifest,
  CompiledArticle,
  RandomDocument,
  RelatedDocument,
} from '../../src/content/types';
import { analyzeRelationships, RELATIONSHIP_ALGORITHM_VERSION, validateSemantics } from './analysis';
import { ContentError, fail } from './diagnostics';
import { buildGraphArtifacts, GRAPH_LAYOUT_VERSION } from './graph';
import { copyReferencedMedia, inspectMedia } from './media';
import { parseBoard, parseDocument, type SourceBoard, type SourceDocument } from './model';
import { extractDocumentText, renderDocument } from './render';
import { buildSearchArtifacts } from './search-index';
import { parseXml } from './xml';

export const COMPILER_VERSION = '1.0.0';
const SCHEMA_VERSION = 1;
const RANDOM_PACK_SIZE = 256;
const ARTICLE_PACK_BYTE_LIMIT = 4 * 1024 * 1024;
const ARTICLE_BYTE_LIMIT = 1024 * 1024;

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

  const articlePacks = await writeArticlePacks(outputDirectory, buildId, compiledArticles);
  const randomPacks = await writeRandomPacks(outputDirectory, buildId, documents);
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
    articlePacks,
    randomPacks,
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
): Promise<Record<string, string>> {
  const packs = new Map<string, ArticlePack>();
  for (const article of articles.values()) {
    const bucket = articleBucket(article.id);
    const pack = packs.get(bucket) ?? { buildId, bucket, articles: {} };
    pack.articles[article.id] = article;
    packs.set(bucket, pack);
  }
  const paths: Record<string, string> = {};
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
    paths[bucket] = `/generated/${buildId}/${relative}`;
  }
  return paths;
}

async function writeRandomPacks(
  outputDirectory: string,
  buildId: string,
  documents: Map<string, SourceDocument>,
): Promise<string[]> {
  const records: RandomDocument[] = [...documents.values()]
    .sort((left, right) => stableOrder(buildId, left.id).localeCompare(stableOrder(buildId, right.id)))
    .map((document) => ({ id: document.id, slug: slugifyTitle(document.title), title: document.title }));
  const paths: string[] = [];
  for (let offset = 0; offset < records.length; offset += RANDOM_PACK_SIZE) {
    const index = offset / RANDOM_PACK_SIZE;
    const relative = `random/${index.toString(16).padStart(3, '0')}.json`;
    await writeJson(path.join(outputDirectory, relative), {
      buildId,
      offset,
      documents: records.slice(offset, offset + RANDOM_PACK_SIZE),
    });
    paths.push(`/generated/${buildId}/${relative}`);
  }
  return paths;
}

async function writeSearchArtifacts(
  outputDirectory: string,
  artifacts: ReturnType<typeof buildSearchArtifacts>,
): Promise<BuildManifest['search']> {
  const recordPacks: Record<string, string> = {};
  const termShards: Record<string, string> = {};
  const titleShards: Record<string, string> = {};
  for (const [bucket, pack] of [...artifacts.recordPacks].sort(([left], [right]) => left.localeCompare(right))) {
    const relative = `search/records/${bucket}.json`;
    await writeJson(path.join(outputDirectory, relative), pack);
    recordPacks[bucket] = toPublicPath(outputDirectory, relative);
  }
  for (const [shard, value] of [...artifacts.termShards].sort(([left], [right]) => left.localeCompare(right))) {
    const relative = `search/terms/${shard}.json`;
    await writeJson(path.join(outputDirectory, relative), value);
    termShards[shard] = toPublicPath(outputDirectory, relative);
  }
  for (const [shard, value] of [...artifacts.titleShards].sort(([left], [right]) => left.localeCompare(right))) {
    const relative = `search/titles/${shard}.json`;
    await writeJson(path.join(outputDirectory, relative), value);
    titleShards[shard] = toPublicPath(outputDirectory, relative);
  }
  return { recordPacks, termShards, titleShards };
}

async function writeGraphArtifacts(
  outputDirectory: string,
  buildId: string,
  artifacts: ReturnType<typeof buildGraphArtifacts>,
): Promise<BuildManifest['graph']> {
  const tiles: Record<string, string> = {};
  const levels: Record<string, { gridSize: number; nodeCount: number; edgeCount: number; tiles: string[] }> = {};
  for (const [levelName, level] of Object.entries(artifacts.levels)) {
    const tileKeys: string[] = [];
    for (const [tileKey, tile] of [...level.tiles].sort(([left], [right]) => left.localeCompare(right))) {
      const relative = `graph/${levelName}/${tileKey}.json`;
      await writeJson(path.join(outputDirectory, relative), tile);
      const key = `${levelName}:${tileKey}`;
      tiles[key] = `/generated/${buildId}/${relative}`;
      tileKeys.push(tileKey);
    }
    levels[levelName] = {
      gridSize: level.gridSize,
      nodeCount: level.nodeCount,
      edgeCount: level.edgeCount,
      tiles: tileKeys,
    };
  }
  const relative = 'graph/manifest.json';
  await writeJson(path.join(outputDirectory, relative), {
    buildId,
    layoutVersion: GRAPH_LAYOUT_VERSION,
    levels,
    focus: artifacts.focus,
  });
  return { manifest: `/generated/${buildId}/${relative}`, tiles };
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

function toPublicPath(outputDirectory: string, relative: string): string {
  const buildId = path.basename(outputDirectory);
  return `/generated/${buildId}/${relative}`;
}

function relativeDisplay(file: string): string {
  return path.relative(process.cwd(), file).split(path.sep).join('/');
}

export function formatCompilerError(error: unknown): string {
  if (error instanceof ContentError) return error.format();
  if (error instanceof Error) return error.message;
  return String(error);
}
