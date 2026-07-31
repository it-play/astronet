import { createHash } from 'node:crypto';
import { articleUrl } from '../../src/content/shared';
import type { GraphEdge, GraphNode, GraphTile } from '../../src/content/types';
import type { BoardHub } from './analysis';
import type { SourceDocument } from './model';

export const GRAPH_LAYOUT_VERSION = 'galaxy-single-buffer-v1';
const MAX_OVERVIEW_EDGES = 180_000;
const OVERVIEW_EDGES_PER_NODE = 3;

export interface GraphArtifacts {
  overview: {
    nodes: GraphNode[];
    edges: GraphEdge[];
  };
  detail: GraphDetail;
  focus: Record<string, { x: number; y: number; z: number; tile: string }>;
}

export interface GraphDetail {
  gridSize: number;
  tiles: Map<string, GraphTile>;
  nodeCount: number;
}

export function buildGraphArtifacts(
  buildId: string,
  documents: Map<string, SourceDocument>,
  strongEdges: GraphEdge[],
  weakEdges: GraphEdge[],
  hubs: BoardHub[],
): GraphArtifacts {
  const communities = detectCommunities(documents, strongEdges, weakEdges, hubs);
  const documentNodes = positionDocuments(documents, communities, strongEdges, weakEdges);
  const hubNodes = positionHubs(hubs, documentNodes);
  const documentEdges = [...strongEdges, ...weakEdges];
  const membershipEdges = hubs.flatMap((hub) =>
    hub.members.map((member) => {
      const [source, target] = canonicalPair(hub.id, member);
      return { source, target, strength: 'strong' as const, weight: 0.5 };
    }),
  );
  const overviewNodes = [...documentNodes, ...hubNodes].sort((left, right) => left.id.localeCompare(right.id));
  const overviewEdges = selectOverviewEdges([...documentEdges, ...membershipEdges]);
  const detailGridSize = Math.min(64, Math.max(8, Math.ceil(Math.sqrt(Math.max(1, documentNodes.length) / 32))));
  const detail = createDetail(buildId, documentNodes, detailGridSize);
  const focus = Object.fromEntries(
    documentNodes.map((node) => [
      node.id,
      { x: node.x, y: node.y, z: node.z, tile: tileKey(node.x, node.y, detail.gridSize) },
    ]),
  );
  return { overview: { nodes: overviewNodes, edges: overviewEdges }, detail, focus };
}

function positionHubs(hubs: BoardHub[], documentNodes: GraphNode[]): GraphNode[] {
  const documentsById = new Map(documentNodes.map((node) => [node.id, node]));
  return hubs.flatMap((hub) => {
    const members = hub.members.flatMap((id) => {
      const node = documentsById.get(id);
      return node ? [node] : [];
    });
    if (members.length === 0) return [];
    const communityCounts = new Map<string, number>();
    for (const member of members) {
      communityCounts.set(member.community, (communityCounts.get(member.community) ?? 0) + 1);
    }
    const community = [...communityCounts].sort(
      (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
    )[0]![0];
    return [{
      id: hub.id,
      title: '',
      url: '',
      kind: 'hub' as const,
      x: average(members.map((node) => node.x)),
      y: average(members.map((node) => node.y)),
      z: average(members.map((node) => node.z)),
      weight: Number(Math.max(1, Math.log1p(members.length)).toFixed(4)),
      community,
    }];
  });
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
  const communitySize = new Map<string, number>();
  for (const community of communities.values()) {
    communitySize.set(community, (communitySize.get(community) ?? 0) + 1);
  }
  const communityIds = [...communitySize]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([id]) => id);
  const centers = new Map<string, { x: number; y: number }>();
  const depthCenters = new Map<string, number>();
  communityIds.forEach((id, index) => {
    const radialIndex = index - 1;
    const radialProgress = Math.sqrt(Math.max(0, radialIndex) / Math.max(1, communityIds.length - 2));
    const radius = index === 0 ? 0 : 0.17 + radialProgress * 0.2;
    const angle = radialIndex * Math.PI * (3 - Math.sqrt(5)) - Math.PI / 2;
    centers.set(id, {
      x: 0.5 + Math.cos(angle) * radius,
      y: 0.5 + Math.sin(angle) * radius,
    });
    depthCenters.set(id, index === 0 ? 0.5 : 0.28 + hashUnit(id, 'community-depth') * 0.44);
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

  return [...documents.values()]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((document) => {
      const community = communities.get(document.id) ?? document.id;
      const center = centers.get(community) ?? { x: 0.5, y: 0.5 };
      const depthCenter = depthCenters.get(community) ?? 0.5;
      const count = communitySize.get(community) ?? 1;
      const radius = Math.min(0.18, 0.025 + Math.sqrt(count) * 0.006);
      const depthRadius = Math.min(0.16, 0.035 + Math.sqrt(count) * 0.004);
      const angle = hashUnit(document.id, 'angle') * Math.PI * 2;
      const distance = Math.sqrt(hashUnit(document.id, 'distance')) * radius;
      return {
        id: document.id,
        title: document.title,
        url: articleUrl(document.id, document.title),
        kind: 'document' as const,
        x: clamp(center.x + Math.cos(angle) * distance),
        y: clamp(center.y + Math.sin(angle) * distance),
        z: clamp(depthCenter + (hashUnit(document.id, 'depth') - 0.5) * depthRadius * 2),
        weight: Number((1 + Math.log1p(degree.get(document.id) ?? 0)).toFixed(4)),
        community,
      };
    });
}

function createDetail(
  buildId: string,
  nodes: GraphNode[],
  gridSize: number,
): GraphDetail {
  const tiles = new Map<string, GraphTile>();
  for (const node of nodes) {
    const key = tileKey(node.x, node.y, gridSize);
    const tile = tiles.get(key) ?? { buildId, level: 'detail' as const, tile: key, nodes: [] };
    tile.nodes.push(node);
    tiles.set(key, tile);
  }
  for (const tile of tiles.values()) {
    tile.nodes.sort((left, right) => left.id.localeCompare(right.id));
  }
  return { gridSize, tiles, nodeCount: nodes.length };
}

function selectOverviewEdges(edges: GraphEdge[]): GraphEdge[] {
  const unique = new Map<string, GraphEdge>();
  for (const edge of edges) {
    if (edge.source === edge.target) continue;
    const [source, target] = canonicalPair(edge.source, edge.target);
    const key = `${source}\0${target}`;
    const previous = unique.get(key);
    unique.set(key, {
      source,
      target,
      strength: previous?.strength === 'strong' || edge.strength === 'strong' ? 'strong' : 'weak',
      weight: Number(((previous?.weight ?? 0) + edge.weight).toFixed(6)),
    });
  }
  const ranked = [...unique.values()].sort(compareEdges);
  if (ranked.length <= MAX_OVERVIEW_EDGES) return ranked;

  const selected = new Set<string>();
  const byEndpoint = new Map<string, GraphEdge[]>();
  for (const edge of ranked) {
    for (const endpoint of [edge.source, edge.target]) {
      const candidates = byEndpoint.get(endpoint) ?? [];
      candidates.push(edge);
      byEndpoint.set(endpoint, candidates);
    }
  }
  for (const candidates of byEndpoint.values()) {
    candidates
      .sort(compareEdges)
      .slice(0, OVERVIEW_EDGES_PER_NODE)
      .forEach((edge) => selected.add(`${edge.source}\0${edge.target}`));
  }
  const covered = ranked.filter((edge) => selected.has(`${edge.source}\0${edge.target}`));
  if (covered.length >= MAX_OVERVIEW_EDGES) return covered.slice(0, MAX_OVERVIEW_EDGES);
  for (const edge of ranked) {
    selected.add(`${edge.source}\0${edge.target}`);
    if (selected.size >= MAX_OVERVIEW_EDGES) break;
  }
  return ranked.filter((edge) => selected.has(`${edge.source}\0${edge.target}`));
}

function compareEdges(left: GraphEdge, right: GraphEdge): number {
  return Number(right.strength === 'strong') - Number(left.strength === 'strong') ||
    right.weight - left.weight ||
    left.source.localeCompare(right.source) ||
    left.target.localeCompare(right.target);
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
