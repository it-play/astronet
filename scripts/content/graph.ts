import { createHash } from 'node:crypto';
import { articleUrl } from '../../src/content/shared';
import type { GraphEdge, GraphNode, GraphTile } from '../../src/content/types';
import type { BoardHub } from './analysis';
import type { SourceDocument } from './model';

export const GRAPH_LAYOUT_VERSION = 'hierarchy-v3';

export interface GraphArtifacts {
  levels: {
    distant: GraphLevel;
    medium: GraphLevel;
    near: GraphLevel;
  };
  focus: Record<string, { x: number; y: number; tile: string }>;
}

export interface GraphLevel {
  gridSize: number;
  tiles: Map<string, GraphTile>;
  nodeCount: number;
  edgeCount: number;
}

export function buildGraphArtifacts(
  buildId: string,
  documents: Map<string, SourceDocument>,
  strongEdges: GraphEdge[],
  weakEdges: GraphEdge[],
  hubs: BoardHub[],
): GraphArtifacts {
  const communities = detectCommunities(documents, strongEdges, weakEdges, hubs);
  const nearNodes = positionDocuments(documents, communities, strongEdges, weakEdges);
  const allEdges = [...strongEdges, ...weakEdges];
  const distant = buildDistantLevel(buildId, nearNodes, allEdges);
  const medium = buildMediumLevel(buildId, nearNodes, allEdges);
  const nearGridSize = Math.min(64, Math.max(8, Math.ceil(Math.sqrt(Math.max(1, nearNodes.length) / 120))));
  const near = createLevel(buildId, 'near', nearNodes, allEdges, nearGridSize);
  const focus = Object.fromEntries(
    nearNodes.map((node) => [
      node.id,
      { x: node.x, y: node.y, tile: tileKey(node.x, node.y, near.gridSize) },
    ]),
  );
  return { levels: { distant, medium, near }, focus };
}

function detectCommunities(
  documents: Map<string, SourceDocument>,
  strongEdges: GraphEdge[],
  weakEdges: GraphEdge[],
  hubs: BoardHub[],
): Map<string, string> {
  const vertices = [...documents.keys(), ...hubs.map((hub) => hub.id)].sort();
  const adjacency = new Map<string, Array<{ id: string; weight: number }>>();
  for (const edge of strongEdges) connect(adjacency, edge.source, edge.target, 4);
  for (const edge of weakEdges) connect(adjacency, edge.source, edge.target, Math.max(0.25, edge.weight));
  for (const hub of hubs) {
    for (const member of hub.members) connect(adjacency, hub.id, member, 2);
  }

  const labels = new Map(vertices.map((id) => [id, id]));
  const degrees = new Map(
    vertices.map((id) => [id, (adjacency.get(id) ?? []).reduce((sum, neighbor) => sum + neighbor.weight, 0)]),
  );
  const communityTotals = new Map(vertices.map((id) => [id, degrees.get(id) ?? 0]));
  const totalWeight = [...degrees.values()].reduce((sum, weight) => sum + weight, 0);

  for (let iteration = 0; iteration < 12 && totalWeight > 0; iteration += 1) {
    let moved = false;
    for (const id of vertices) {
      const neighbors = adjacency.get(id) ?? [];
      if (neighbors.length === 0) continue;
      const current = labels.get(id) ?? id;
      const degree = degrees.get(id) ?? 0;
      communityTotals.set(current, (communityTotals.get(current) ?? 0) - degree);
      const weightsByCommunity = new Map<string, number>();
      for (const neighbor of neighbors) {
        const label = labels.get(neighbor.id) ?? neighbor.id;
        weightsByCommunity.set(label, (weightsByCommunity.get(label) ?? 0) + neighbor.weight);
      }
      let selected = current;
      let bestGain = 0;
      for (const [candidate, internalWeight] of weightsByCommunity) {
        const gain = internalWeight - (degree * (communityTotals.get(candidate) ?? 0)) / totalWeight;
        if (gain > bestGain + 1e-9 || (Math.abs(gain - bestGain) <= 1e-9 && candidate.localeCompare(selected) < 0)) {
          selected = candidate;
          bestGain = gain;
        }
      }
      labels.set(id, selected);
      communityTotals.set(selected, (communityTotals.get(selected) ?? 0) + degree);
      if (selected !== current) moved = true;
    }
    if (!moved) break;
  }

  const result = new Map<string, string>();
  for (const id of documents.keys()) {
    const label = labels.get(id) ?? id;
    result.set(id, createHash('sha256').update(label).digest('hex').slice(0, 12));
  }
  return result;
}

function positionDocuments(
  documents: Map<string, SourceDocument>,
  communities: Map<string, string>,
  strongEdges: GraphEdge[],
  weakEdges: GraphEdge[],
): GraphNode[] {
  const communityIds = [...new Set(communities.values())].sort();
  const centers = new Map<string, { x: number; y: number }>();
  const columns = Math.max(1, Math.ceil(Math.sqrt(communityIds.length)));
  const rows = Math.max(1, Math.ceil(communityIds.length / columns));
  communityIds.forEach((id, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    centers.set(id, {
      x: (column + 0.5) / columns,
      y: (row + 0.5) / rows,
    });
  });

  const degree = new Map<string, number>();
  for (const edge of strongEdges) {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 4);
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 4);
  }
  for (const edge of weakEdges) {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + edge.weight);
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + edge.weight);
  }

  const communitySize = new Map<string, number>();
  for (const community of communities.values()) communitySize.set(community, (communitySize.get(community) ?? 0) + 1);
  return [...documents.values()]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((document) => {
      const community = communities.get(document.id) ?? document.id;
      const center = centers.get(community) ?? { x: 0.5, y: 0.5 };
      const count = communitySize.get(community) ?? 1;
      const radius = Math.min(0.18, 0.025 + Math.sqrt(count) * 0.006);
      const angle = hashUnit(document.id, 'angle') * Math.PI * 2;
      const distance = Math.sqrt(hashUnit(document.id, 'distance')) * radius;
      return {
        id: document.id,
        title: document.title,
        url: articleUrl(document.id, document.title),
        kind: 'document' as const,
        x: clamp(center.x + Math.cos(angle) * distance),
        y: clamp(center.y + Math.sin(angle) * distance),
        weight: Number((1 + Math.log1p(degree.get(document.id) ?? 0)).toFixed(4)),
        community,
      };
    });
}

function buildDistantLevel(buildId: string, nodes: GraphNode[], edges: GraphEdge[]): GraphLevel {
  const byCommunity = new Map<string, GraphNode[]>();
  for (const node of nodes) {
    const members = byCommunity.get(node.community) ?? [];
    members.push(node);
    byCommunity.set(node.community, members);
  }
  const clusters: GraphNode[] = [...byCommunity]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([community, members]) => ({
      id: `community-${community}`,
      title: '',
      url: '',
      kind: 'cluster',
      x: average(members.map((node) => node.x)),
      y: average(members.map((node) => node.y)),
      weight: members.reduce((sum, node) => sum + node.weight, 0),
      community,
    }));
  const aggregateEdges = aggregateCommunityEdges(edges, new Map(nodes.map((node) => [node.id, node.community])));
  return createLevel(buildId, 'distant', clusters, aggregateEdges, 1);
}

function buildMediumLevel(buildId: string, nodes: GraphNode[], edges: GraphEdge[]): GraphLevel {
  const selected = new Set<string>();
  const byCommunity = new Map<string, GraphNode[]>();
  for (const node of nodes) {
    const members = byCommunity.get(node.community) ?? [];
    members.push(node);
    byCommunity.set(node.community, members);
  }
  for (const members of byCommunity.values()) {
    const limit = Math.min(12, Math.max(3, Math.ceil(Math.sqrt(members.length))));
    members
      .sort((left, right) => right.weight - left.weight || left.id.localeCompare(right.id))
      .slice(0, limit)
      .forEach((node) => selected.add(node.id));
  }
  const mediumNodes = nodes.filter((node) => selected.has(node.id));
  const mediumEdges = edges.filter((edge) => selected.has(edge.source) && selected.has(edge.target));
  return createLevel(buildId, 'medium', mediumNodes, mediumEdges, 4);
}

function createLevel(
  buildId: string,
  level: 'distant' | 'medium' | 'near',
  nodes: GraphNode[],
  edges: GraphEdge[],
  gridSize: number,
): GraphLevel {
  const tiles = new Map<string, GraphTile>();
  const nodeTiles = new Map<string, string>();
  for (const node of nodes) {
    const key = tileKey(node.x, node.y, gridSize);
    nodeTiles.set(node.id, key);
    const tile = tiles.get(key) ?? { buildId, level, tile: key, nodes: [], edges: [] };
    tile.nodes.push(node);
    tiles.set(key, tile);
  }
  for (const edge of edges) {
    const keys = new Set([nodeTiles.get(edge.source), nodeTiles.get(edge.target)].filter((key): key is string => Boolean(key)));
    for (const key of keys) {
      const tile = tiles.get(key);
      if (tile) tile.edges.push(edge);
    }
  }
  for (const tile of tiles.values()) {
    tile.nodes.sort((left, right) => left.id.localeCompare(right.id));
    tile.edges.sort((left, right) => left.source.localeCompare(right.source) || left.target.localeCompare(right.target));
  }
  return { gridSize, tiles, nodeCount: nodes.length, edgeCount: edges.length };
}

function aggregateCommunityEdges(edges: GraphEdge[], communityByNode: Map<string, string>): GraphEdge[] {
  const aggregate = new Map<string, GraphEdge>();
  for (const edge of edges) {
    const sourceCommunity = communityByNode.get(edge.source);
    const targetCommunity = communityByNode.get(edge.target);
    if (!sourceCommunity || !targetCommunity || sourceCommunity === targetCommunity) continue;
    const [source, target] = canonicalPair(`community-${sourceCommunity}`, `community-${targetCommunity}`);
    const key = `${source}\0${target}`;
    const previous = aggregate.get(key);
    aggregate.set(key, {
      source,
      target,
      strength: previous?.strength === 'strong' || edge.strength === 'strong' ? 'strong' : 'weak',
      weight: Number(((previous?.weight ?? 0) + edge.weight).toFixed(6)),
    });
  }
  return [...aggregate.values()];
}

function connect(
  adjacency: Map<string, Array<{ id: string; weight: number }>>,
  left: string,
  right: string,
  weight: number,
): void {
  const leftEdges = adjacency.get(left) ?? [];
  leftEdges.push({ id: right, weight });
  adjacency.set(left, leftEdges);
  const rightEdges = adjacency.get(right) ?? [];
  rightEdges.push({ id: left, weight });
  adjacency.set(right, rightEdges);
}

function tileKey(x: number, y: number, gridSize: number): string {
  const column = Math.min(gridSize - 1, Math.max(0, Math.floor(x * gridSize)));
  const row = Math.min(gridSize - 1, Math.max(0, Math.floor(y * gridSize)));
  return `${column}-${row}`;
}

function hashUnit(value: string, salt: string): number {
  const hex = createHash('sha256').update(`${salt}:${value}`).digest('hex').slice(0, 8);
  return Number.parseInt(hex, 16) / 0xffffffff;
}

function canonicalPair(left: string, right: string): [string, string] {
  return left.localeCompare(right) <= 0 ? [left, right] : [right, left];
}

function average(values: number[]): number {
  return values.length === 0 ? 0.5 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp(value: number): number {
  return Math.min(0.985, Math.max(0.015, value));
}
