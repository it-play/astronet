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
  text: string;
  toc: TocItem[];
  related: RelatedDocument[];
  integrity: string;
}

export interface ArticlePack {
  buildId: string;
  bucket: string;
  articles: Record<string, CompiledArticle>;
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
  kind: 'document' | 'cluster';
  x: number;
  y: number;
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
  level: 'distant' | 'medium' | 'near';
  tile: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface BuildManifest {
  schemaVersion: number;
  compilerVersion: string;
  buildId: string;
  basePath: string;
  bucketCount: number;
  articlePacks: Record<string, string>;
  randomPacks: string[];
  randomPackSize: number;
  search: {
    recordPacks: Record<string, string>;
    termShards: Record<string, string>;
    titleShards: Record<string, string>;
  };
  graph: {
    manifest: string;
    tiles: Record<string, string>;
  };
  counts: {
    documents: number;
    boards: number;
    media: number;
    strongEdges: number;
    weakEdges: number;
  };
}
