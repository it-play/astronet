import { articleBucket } from '../content/shared';
import type { BuildManifest, GraphEdge, GraphFocusPack, GraphNode, GraphTile } from '../content/types';

type GraphLevelName = 'distant' | 'medium' | 'near';

interface GraphLevelManifest {
  gridSize: number;
  nodeCount: number;
  edgeCount: number;
  tiles: string[];
}

interface GraphManifest {
  buildId: string;
  layoutVersion: string;
  levels: Record<GraphLevelName, GraphLevelManifest>;
}

interface Camera {
  x: number;
  y: number;
  zoom: number;
}

interface SavedGraphState {
  buildId: string;
  camera: Camera;
  selectedId?: string;
  weakEdges: boolean;
}

const buildManifest = readBuildManifest();
const canvas = requiredElement<HTMLCanvasElement>('graph-canvas');
const canvasContext = canvas.getContext('2d');
if (!canvasContext) throw new Error('Canvas is unavailable');
const context: CanvasRenderingContext2D = canvasContext;
const canvasWrap = requiredElement<HTMLElement>('graph-canvas-wrap');
const status = requiredElement<HTMLElement>('graph-status');
const weakControl = requiredElement<HTMLInputElement>('graph-weak-edges');
const nodePanel = requiredElement<HTMLElement>('graph-node-panel');
const nodeTitle = requiredElement<HTMLElement>('graph-node-title');
const nodeOpen = requiredElement<HTMLAnchorElement>('graph-node-open');
const nodeCenter = requiredElement<HTMLButtonElement>('graph-node-center');
const nodeClose = requiredElement<HTMLButtonElement>('graph-node-close');
const zoomIn = requiredElement<HTMLButtonElement>('graph-zoom-in');
const zoomOut = requiredElement<HTMLButtonElement>('graph-zoom-out');
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const mobile = window.matchMedia('(max-width: 700px)').matches;
const tileCacheLimit = mobile ? 72 : 192;
const tileCache = new Map<string, Promise<GraphTile>>();
const loadedTileOrder = new Map<string, { level: GraphLevelName; key: string; path: string }>();
const loadedTiles = new Map<GraphLevelName, Map<string, GraphTile>>([
  ['distant', new Map()],
  ['medium', new Map()],
  ['near', new Map()],
]);
const pointers = new Map<number, { x: number; y: number }>();
let graphManifest: GraphManifest | undefined;
let camera: Camera = { x: 0.5, y: 0.5, zoom: 1.15 };
let level: GraphLevelName = 'distant';
let visibleTileKeys = new Set<string>();
let selectedNode: GraphNode | undefined;
let pendingSelectionId: string | undefined;
let drawFrame = 0;
let tileTimer = 0;
let stateTimer = 0;
let dragDistance = 0;
let persistentStatus = false;

void initialize();

weakControl.addEventListener('change', () => {
  scheduleDraw();
  scheduleStateSave();
});

zoomIn.addEventListener('click', () => zoomAt(camera.zoom * 1.6, canvas.clientWidth / 2, canvas.clientHeight / 2));
zoomOut.addEventListener('click', () => zoomAt(camera.zoom / 1.6, canvas.clientWidth / 2, canvas.clientHeight / 2));

nodeClose.addEventListener('click', clearSelection);
nodeCenter.addEventListener('click', () => {
  if (!selectedNode) return;
  camera.x = selectedNode.x;
  camera.y = selectedNode.y;
  camera.zoom = Math.max(camera.zoom, 12);
  clampCamera();
  cameraChanged(true);
  canvas.focus();
});
nodeOpen.addEventListener('pointerdown', saveHistoryState);
nodeOpen.addEventListener('click', saveHistoryState);

canvas.addEventListener('wheel', (event) => {
  event.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const factor = Math.exp(-event.deltaY * 0.0015);
  zoomAt(camera.zoom * factor, event.clientX - rect.left, event.clientY - rect.top);
}, { passive: false });

canvas.addEventListener('pointerdown', (event) => {
  canvas.setPointerCapture(event.pointerId);
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  dragDistance = 0;
  canvas.classList.add('is-dragging');
});

canvas.addEventListener('pointermove', (event) => {
  const previous = pointers.get(event.pointerId);
  if (!previous) return;
  const before = [...pointers.values()];
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  const after = [...pointers.values()];

  if (after.length === 1) {
    const deltaX = event.clientX - previous.x;
    const deltaY = event.clientY - previous.y;
    dragDistance += Math.hypot(deltaX, deltaY);
    panByPixels(deltaX, deltaY);
  } else if (after.length === 2 && before.length === 2) {
    const oldMidpoint = midpoint(before[0]!, before[1]!);
    const newMidpoint = midpoint(after[0]!, after[1]!);
    const oldDistance = distance(before[0]!, before[1]!);
    const newDistance = distance(after[0]!, after[1]!);
    panByPixels(newMidpoint.x - oldMidpoint.x, newMidpoint.y - oldMidpoint.y, false);
    const rect = canvas.getBoundingClientRect();
    if (oldDistance > 0) {
      zoomAt(camera.zoom * (newDistance / oldDistance), newMidpoint.x - rect.left, newMidpoint.y - rect.top, false);
    }
    dragDistance += Math.abs(newDistance - oldDistance) + distance(oldMidpoint, newMidpoint);
    cameraChanged();
  }
});

canvas.addEventListener('pointerup', (event) => finishPointer(event));
canvas.addEventListener('pointercancel', (event) => finishPointer(event));

canvas.addEventListener('keydown', (event) => {
  const step = event.shiftKey ? 120 : 48;
  switch (event.key) {
    case 'ArrowLeft':
      event.preventDefault();
      panByPixels(step, 0);
      break;
    case 'ArrowRight':
      event.preventDefault();
      panByPixels(-step, 0);
      break;
    case 'ArrowUp':
      event.preventDefault();
      panByPixels(0, step);
      break;
    case 'ArrowDown':
      event.preventDefault();
      panByPixels(0, -step);
      break;
    case '+':
    case '=':
      event.preventDefault();
      zoomAt(camera.zoom * 1.5, canvas.clientWidth / 2, canvas.clientHeight / 2);
      break;
    case '-':
      event.preventDefault();
      zoomAt(camera.zoom / 1.5, canvas.clientWidth / 2, canvas.clientHeight / 2);
      break;
    case 'Enter':
    case ' ':
      event.preventDefault();
      selectNearestToCenter();
      break;
    case 'Escape':
      clearSelection();
      break;
  }
});

new ResizeObserver(() => {
  resizeCanvas();
  scheduleTileUpdate(0);
}).observe(canvasWrap);

window.addEventListener('pagehide', saveHistoryState);
window.addEventListener('pageshow', (event) => {
  if (event.persisted) {
    restoreHistoryState();
    cameraChanged(true);
  }
});

async function initialize(): Promise<void> {
  resizeCanvas();
  try {
    const response = await fetch(buildManifest.graph.manifest, { cache: 'force-cache' });
    if (!response.ok) throw new Error('Graph manifest request failed');
    graphManifest = (await response.json()) as GraphManifest;
    if (graphManifest.buildId !== buildManifest.buildId) throw new Error('Graph manifest build mismatch');

    if (graphManifest.levels.distant.nodeCount === 0) {
      showStatus('표시할 연결이 없습니다.');
      weakControl.disabled = true;
      scheduleDraw();
      return;
    }

    const restored = restoreHistoryState();
    if (!restored) await applyFocusFromUrl();
    level = levelForZoom(camera.zoom);
    await loadVisibleTiles();
  } catch {
    showStatus('그래프를 불러오지 못했습니다.');
    weakControl.disabled = true;
  }
}

async function applyFocusFromUrl(): Promise<void> {
  const focusId = new URL(window.location.href).searchParams.get('focus');
  if (!focusId) return;
  const bucket = articleBucket(focusId, 1024);
  const path = `${buildManifest.basePath}/graph/focus/${bucket}.json`;
  const response = await fetch(path, { cache: 'force-cache' });
  if (response.status === 404) {
    showStatus('해당 문서를 그래프에서 찾을 수 없습니다.', true);
    return;
  }
  if (!response.ok) throw new Error('Graph focus request failed');
  const pack = (await response.json()) as GraphFocusPack;
  if (pack.buildId !== buildManifest.buildId || pack.bucket !== bucket) {
    throw new Error('Graph focus build mismatch');
  }
  const focus = pack.focus[focusId];
  if (!focus) {
    showStatus('해당 문서를 그래프에서 찾을 수 없습니다.', true);
    return;
  }
  camera = { x: focus.x, y: focus.y, zoom: 12 };
  pendingSelectionId = focusId;
}

async function loadVisibleTiles(): Promise<void> {
  if (!graphManifest) return;
  const currentLevel = levelForZoom(camera.zoom);
  if (currentLevel !== level) {
    level = currentLevel;
    selectedNode = undefined;
    nodePanel.hidden = true;
  }
  const keys = calculateVisibleTileKeys(graphManifest.levels[level]);
  visibleTileKeys = keys;
  const levelTiles = loadedTiles.get(level)!;
  const paths = [...keys]
    .filter((key) => !levelTiles.has(key))
    .map((key) => ({ key, path: `${buildManifest.basePath}/graph/${level}/${key}.json` }));

  if (paths.length > 0 && !persistentStatus) showStatus('그래프를 불러오는 중입니다.');
  await Promise.all(
    paths.map(async ({ key, path }) => {
      const tile = await fetchTile(path);
      if (tile.level === level) {
        levelTiles.set(key, tile);
        rememberLoadedTile(level, key, path);
      }
    }),
  );

  if (level !== currentLevel) return;
  const nodes = currentNodes();
  if (pendingSelectionId) {
    const focused = nodes.find((node) => node.id === pendingSelectionId);
    if (focused) selectNode(focused);
    pendingSelectionId = undefined;
  }
  if (!persistentStatus) {
    if (nodes.length > 0) status.hidden = true;
    else showStatus('이 위치에 표시할 문서가 없습니다.');
  }
  scheduleDraw();
}

function rememberLoadedTile(levelName: GraphLevelName, key: string, path: string): void {
  const orderKey = `${levelName}:${key}`;
  loadedTileOrder.delete(orderKey);
  loadedTileOrder.set(orderKey, { level: levelName, key, path });
  while (loadedTileOrder.size > tileCacheLimit) {
    const candidate = [...loadedTileOrder].find(
      ([, value]) => value.level !== level || !visibleTileKeys.has(value.key),
    );
    if (!candidate) return;
    const [candidateKey, value] = candidate;
    loadedTileOrder.delete(candidateKey);
    loadedTiles.get(value.level)?.delete(value.key);
    tileCache.delete(value.path);
  }
}

async function fetchTile(path: string): Promise<GraphTile> {
  const cached = tileCache.get(path);
  if (cached) return cached;
  const request = fetch(path, { cache: 'force-cache' }).then(async (response) => {
    if (!response.ok) throw new Error('Graph tile request failed');
    const tile = (await response.json()) as GraphTile;
    if (tile.buildId !== buildManifest.buildId) throw new Error('Graph tile build mismatch');
    return tile;
  });
  tileCache.set(path, request);
  try {
    return await request;
  } catch (cause) {
    tileCache.delete(path);
    throw cause;
  }
}

function calculateVisibleTileKeys(levelManifest: GraphLevelManifest): Set<string> {
  const rect = canvas.getBoundingClientRect();
  const scale = Math.max(1, Math.min(rect.width, rect.height) * camera.zoom);
  const halfWidth = rect.width / (scale * 2);
  const halfHeight = rect.height / (scale * 2);
  const buffer = mobile ? 0 : 1;
  const grid = levelManifest.gridSize;
  const minColumn = clampInteger(Math.floor((camera.x - halfWidth) * grid) - buffer, 0, grid - 1);
  const maxColumn = clampInteger(Math.floor((camera.x + halfWidth) * grid) + buffer, 0, grid - 1);
  const minRow = clampInteger(Math.floor((camera.y - halfHeight) * grid) - buffer, 0, grid - 1);
  const maxRow = clampInteger(Math.floor((camera.y + halfHeight) * grid) + buffer, 0, grid - 1);
  const available = new Set(levelManifest.tiles);
  const keys = new Set<string>();
  for (let column = minColumn; column <= maxColumn; column += 1) {
    for (let row = minRow; row <= maxRow; row += 1) {
      const key = `${column}-${row}`;
      if (available.has(key)) keys.add(key);
    }
  }
  return keys;
}

function scheduleTileUpdate(delay = 90): void {
  window.clearTimeout(tileTimer);
  tileTimer = window.setTimeout(() => void loadVisibleTiles().catch(() => showStatus('그래프를 불러오지 못했습니다.')), delay);
}

function cameraChanged(immediateTiles = false): void {
  if (persistentStatus) {
    persistentStatus = false;
    status.hidden = true;
  }
  const nextLevel = levelForZoom(camera.zoom);
  if (nextLevel !== level) {
    level = nextLevel;
    visibleTileKeys.clear();
  }
  scheduleDraw();
  scheduleTileUpdate(immediateTiles ? 0 : 90);
  scheduleStateSave();
}

function panByPixels(deltaX: number, deltaY: number, notify = true): void {
  const rect = canvas.getBoundingClientRect();
  const scale = Math.max(1, Math.min(rect.width, rect.height) * camera.zoom);
  camera.x -= deltaX / scale;
  camera.y -= deltaY / scale;
  clampCamera();
  if (notify) cameraChanged();
}

function zoomAt(nextZoom: number, screenX: number, screenY: number, notify = true): void {
  const rect = canvas.getBoundingClientRect();
  const oldScale = Math.max(1, Math.min(rect.width, rect.height) * camera.zoom);
  const worldX = camera.x + (screenX - rect.width / 2) / oldScale;
  const worldY = camera.y + (screenY - rect.height / 2) / oldScale;
  camera.zoom = Math.min(28, Math.max(0.9, nextZoom));
  const newScale = Math.max(1, Math.min(rect.width, rect.height) * camera.zoom);
  camera.x = worldX - (screenX - rect.width / 2) / newScale;
  camera.y = worldY - (screenY - rect.height / 2) / newScale;
  clampCamera();
  if (notify) cameraChanged();
}

function clampCamera(): void {
  camera.x = Math.min(1, Math.max(0, camera.x));
  camera.y = Math.min(1, Math.max(0, camera.y));
}

function finishPointer(event: PointerEvent): void {
  const point = pointers.get(event.pointerId);
  const wasSingle = pointers.size === 1;
  pointers.delete(event.pointerId);
  if (pointers.size === 0) canvas.classList.remove('is-dragging');
  if (wasSingle && point && dragDistance < 6 && event.type === 'pointerup') selectAt(event.clientX, event.clientY);
  dragDistance = 0;
}

function selectAt(clientX: number, clientY: number): void {
  const rect = canvas.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  const hit = currentNodes()
    .filter((node) => node.kind !== 'hub')
    .map((node) => ({ node, point: project(node), distance: Math.hypot(project(node).x - x, project(node).y - y) }))
    .filter(({ node, distance }) => distance <= Math.max(12, nodeRadius(node) + 5))
    .sort((left, right) => left.distance - right.distance)[0]?.node;
  if (!hit) {
    clearSelection();
    return;
  }
  if (hit.kind === 'cluster') {
    camera.x = hit.x;
    camera.y = hit.y;
    camera.zoom = Math.max(2.8, camera.zoom * 2.25);
    clampCamera();
    cameraChanged(true);
    return;
  }
  selectNode(hit);
}

function selectNearestToCenter(): void {
  const center = { x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 };
  const nearest = currentNodes()
    .filter((node) => node.kind === 'document')
    .map((node) => ({ node, distance: distance(project(node), center) }))
    .sort((left, right) => left.distance - right.distance)[0]?.node;
  if (nearest) selectNode(nearest);
}

function selectNode(node: GraphNode): void {
  selectedNode = node;
  nodeTitle.textContent = node.title;
  nodeOpen.href = node.url;
  nodePanel.hidden = false;
  scheduleDraw();
  scheduleStateSave();
}

function clearSelection(): void {
  selectedNode = undefined;
  nodePanel.hidden = true;
  scheduleDraw();
  scheduleStateSave();
  canvas.focus();
}

function currentNodes(): GraphNode[] {
  const tiles = loadedTiles.get(level)!;
  return [...visibleTileKeys]
    .flatMap((key) => tiles.get(key)?.nodes ?? [])
    .filter((node, index, values) => values.findIndex((candidate) => candidate.id === node.id) === index);
}

function currentEdges(): GraphEdge[] {
  const tiles = loadedTiles.get(level)!;
  const edges = new Map<string, GraphEdge>();
  for (const key of visibleTileKeys) {
    for (const edge of tiles.get(key)?.edges ?? []) edges.set(`${edge.source}\0${edge.target}`, edge);
  }
  return [...edges.values()];
}

function scheduleDraw(): void {
  cancelAnimationFrame(drawFrame);
  drawFrame = requestAnimationFrame(draw);
}

function draw(): void {
  const rect = canvas.getBoundingClientRect();
  context.clearRect(0, 0, rect.width, rect.height);
  context.fillStyle = '#181d26';
  context.fillRect(0, 0, rect.width, rect.height);
  drawDust(rect.width, rect.height);

  const nodes = currentNodes();
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  context.lineCap = 'round';
  for (const edge of currentEdges()) {
    if (edge.strength === 'weak' && !weakControl.checked) continue;
    const source = nodesById.get(edge.source);
    const target = nodesById.get(edge.target);
    if (!source || !target) continue;
    const from = project(source);
    const to = project(target);
    if (!lineCouldBeVisible(from, to, rect.width, rect.height)) continue;
    const isWeak = edge.strength === 'weak';
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.strokeStyle = isWeak ? 'rgb(190 195 204 / 0.16)' : 'rgb(205 210 218 / 0.38)';
    context.lineWidth = isWeak ? 0.6 : Math.min(3.4, 0.85 + Math.log1p(edge.weight) * 0.34);
    context.stroke();
  }

  for (const node of [...nodes].filter((node) => node.kind !== 'hub').sort((left, right) => left.weight - right.weight)) {
    drawNode(node);
  }
  drawLabels(nodes, rect.width, rect.height);
}

function drawDust(width: number, height: number): void {
  if (reduceMotion) return;
  const count = mobile ? 54 : 150;
  context.fillStyle = 'rgb(255 255 255 / 0.11)';
  for (let index = 0; index < count; index += 1) {
    const world = { x: hashUnit(index, 17), y: hashUnit(index, 53) };
    const point = project(world);
    if (point.x < 0 || point.x > width || point.y < 0 || point.y > height) continue;
    context.beginPath();
    context.arc(point.x, point.y, index % 11 === 0 ? 1 : 0.55, 0, Math.PI * 2);
    context.fill();
  }
}

function drawNode(node: GraphNode): void {
  const point = project(node);
  const radius = nodeRadius(node);
  context.beginPath();
  context.arc(point.x, point.y, radius, 0, Math.PI * 2);
  context.fillStyle = node.kind === 'cluster' ? 'rgb(255 255 255 / 0.64)' : 'rgb(255 255 255 / 0.9)';
  context.fill();

  if (selectedNode?.id === node.id) {
    const ring = radius + 7;
    context.beginPath();
    context.moveTo(point.x, point.y - ring);
    context.lineTo(point.x + ring, point.y);
    context.lineTo(point.x, point.y + ring);
    context.lineTo(point.x - ring, point.y);
    context.closePath();
    context.strokeStyle = '#fff';
    context.lineWidth = 1.6;
    context.stroke();
  }
}

function drawLabels(nodes: GraphNode[], width: number, height: number): void {
  if (level === 'distant') return;
  const limit = mobile ? 36 : level === 'medium' ? 90 : 160;
  const boxes: Array<{ left: number; right: number; top: number; bottom: number }> = [];
  const candidates = nodes
    .filter((node) => node.kind === 'document' && node.title)
    .sort((left, right) => right.weight - left.weight || left.id.localeCompare(right.id))
    .slice(0, limit);
  context.font = `${mobile ? 11 : 12}px "Pretendard Variable", Pretendard, sans-serif`;
  context.textBaseline = 'middle';
  context.fillStyle = 'rgb(255 255 255 / 0.78)';
  for (const node of candidates) {
    const point = project(node);
    const radius = nodeRadius(node);
    const textWidth = context.measureText(node.title).width;
    const box = {
      left: point.x + radius + 6,
      right: point.x + radius + 6 + textWidth,
      top: point.y - 8,
      bottom: point.y + 8,
    };
    if (box.right < 0 || box.left > width || box.bottom < 0 || box.top > height) continue;
    if (boxes.some((other) => overlaps(box, other))) continue;
    context.fillText(node.title, box.left, point.y);
    boxes.push(box);
  }
}

function nodeRadius(node: GraphNode): number {
  if (node.kind === 'cluster') return Math.min(18, 4.5 + Math.sqrt(Math.max(1, node.weight)) * 0.55);
  return Math.min(9, 2.2 + Math.log1p(Math.max(1, node.weight)) * 1.35);
}

function project(point: { x: number; y: number }): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  const scale = Math.min(rect.width, rect.height) * camera.zoom;
  return {
    x: (point.x - camera.x) * scale + rect.width / 2,
    y: (point.y - camera.y) * scale + rect.height / 2,
  };
}

function levelForZoom(zoom: number): GraphLevelName {
  if (zoom < 2.5) return 'distant';
  if (zoom < 9.5) return 'medium';
  return 'near';
}

function resizeCanvas(): void {
  const rect = canvas.getBoundingClientRect();
  const ratio = Math.min(window.devicePixelRatio || 1, mobile ? 1.5 : 2);
  const width = Math.max(1, Math.round(rect.width * ratio));
  const height = Math.max(1, Math.round(rect.height * ratio));
  if (canvas.width === width && canvas.height === height) return;
  canvas.width = width;
  canvas.height = height;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  scheduleDraw();
}

function restoreHistoryState(): boolean {
  const value = (history.state as { astronetGraph?: SavedGraphState } | null)?.astronetGraph;
  if (!value || value.buildId !== buildManifest.buildId) return false;
  camera = { ...value.camera };
  clampCamera();
  weakControl.checked = value.weakEdges;
  pendingSelectionId = value.selectedId;
  return true;
}

function scheduleStateSave(): void {
  window.clearTimeout(stateTimer);
  stateTimer = window.setTimeout(saveHistoryState, 120);
}

function saveHistoryState(): void {
  const state: SavedGraphState = {
    buildId: buildManifest.buildId,
    camera: { ...camera },
    selectedId: selectedNode?.id,
    weakEdges: weakControl.checked,
  };
  history.replaceState({ ...(history.state ?? {}), astronetGraph: state }, '', window.location.href);
}

function showStatus(message: string, persistent = false): void {
  status.textContent = message;
  status.hidden = false;
  persistentStatus = persistent;
}

function distance(left: { x: number; y: number }, right: { x: number; y: number }): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function midpoint(left: { x: number; y: number }, right: { x: number; y: number }): { x: number; y: number } {
  return { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 };
}

function lineCouldBeVisible(
  left: { x: number; y: number },
  right: { x: number; y: number },
  width: number,
  height: number,
): boolean {
  return !((left.x < 0 && right.x < 0) || (left.x > width && right.x > width) || (left.y < 0 && right.y < 0) || (left.y > height && right.y > height));
}

function overlaps(
  left: { left: number; right: number; top: number; bottom: number },
  right: { left: number; right: number; top: number; bottom: number },
): boolean {
  return left.left < right.right && left.right > right.left && left.top < right.bottom && left.bottom > right.top;
}

function hashUnit(value: number, salt: number): number {
  let hash = (value + 1) * 0x9e3779b1 ^ salt * 0x85ebca6b;
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  return (hash >>> 0) / 0xffffffff;
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function readBuildManifest(): BuildManifest {
  const element = document.getElementById('astronet-build');
  if (!element?.textContent) throw new Error('Build manifest is missing');
  return JSON.parse(element.textContent) as BuildManifest;
}

function requiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Required graph element is missing: ${id}`);
  return element as T;
}
