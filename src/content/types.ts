export interface TocItem {
  id: string;
  number: string;
  title: string;
  depth: number;
  children: TocItem[];
}

export interface RelatedDocument {
  id: string;
  title: string;
  url: string;
}

export interface CompiledArticle {
  id: string;
  title: string;
  slug: string;
  url: string;
  html: string;
  toc: TocItem[];
  boardIds: string[];
  related: RelatedDocument[];
  integrity: string;
}

export interface ArticlePack {
  buildId: string;
  bucket: string;
  articles: Record<string, CompiledArticle>;
  boards: Record<string, CompiledBoard>;
}

export interface CompiledBoard {
  html: string;
  packPath?: string;
}

export interface BoardPack {
  buildId: string;
  boardId: string;
  sections: Record<string, string>;
}

export interface RandomDocument {
  id: string;
  slug: string;
  title: string;
}

export interface SearchRecord {
  id: string;
  title: string;
  slug: string;
  url: string;
  text: string;
}

export interface SearchPosting {
  id: string;
  positions: number[];
  weight: number;
}

export interface SearchShard {
  buildId: string;
  terms: Record<string, SearchPosting[]>;
}

export type TitleSearchEntry = [id: string, field: 'title' | 'alias'];

export interface TitleSearchShard {
  buildId: string;
  keys: Record<string, TitleSearchEntry[]>;
}

export interface SearchRecordPack {
  buildId: string;
  bucket: string;
  records: Record<string, SearchRecord>;
}

export type GraphEdgeStrength = 'strong' | 'weak';

export interface GraphNode {
  id: string;
  title: string;
  url: string;
  kind: 'document' | 'hub';
  x: number;
  y: number;
  z: number;
  weight: number;
  community: string;
}

export interface GraphEdge {
  source: string;
  target: string;
  strength: GraphEdgeStrength;
  weight: number;
}

export interface GraphTile {
  buildId: string;
  level: 'detail';
  tile: string;
  nodes: GraphNode[];
}

export interface GraphFocusPack {
  buildId: string;
  bucket: string;
  focus: Record<string, { x: number; y: number; z: number; tile: string }>;
}

export interface BuildManifest {
  schemaVersion: number;
  compilerVersion: string;
  buildId: string;
  basePath: string;
  bucketCount: number;
  randomPackCount: number;
  randomPackSize: number;
  search: {
    recordShards: string[];
    termShards: string[];
    titleShards: string[];
  };
  graph: {
    manifest: string;
  };
  counts: {
    documents: number;
    boards: number;
    media: number;
    strongEdges: number;
    weakEdges: number;
  };
}
