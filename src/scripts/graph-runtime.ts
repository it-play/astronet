import {
  BufferGeometry,
  Euler,
  Float32BufferAttribute,
  FogExp2,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  RingGeometry,
  Scene,
  SphereGeometry,
  Vector3,
  WebGLRenderer,
} from 'three';
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

interface CameraState {
  x: number;
  y: number;
  zoom: number;
}

interface SavedGraphState {
  buildId: string;
  camera: CameraState;
  selectedId?: string;
  weakEdges: boolean;
}

interface RenderedLevel {
  group: Group;
  nodes: GraphNode[];
  nodeMesh?: InstancedMesh;
  nodeMaterial?: MeshBasicMaterial;
  strongLines?: LineSegments;
  strongMaterial?: LineBasicMaterial;
  weakLines?: LineSegments;
  weakMaterial?: LineBasicMaterial;
}

interface LabelEntry {
  node: GraphNode;
  element: HTMLSpanElement;
}

const LEVELS: GraphLevelName[] = ['distant', 'medium', 'near'];
const BACKGROUND_COLOR = 0x181d26;
const WORLD_SIZE = 18;
const WORLD_DEPTH = 5.5;
const CAMERA_DISTANCE = 24;
const CAMERA_FOV = 42;
const MIN_ZOOM = 0.82;
const MAX_ZOOM = 28;
const GALAXY_TILT = new Euler(-0.17, 0.08, 0.025, 'XYZ');

const buildManifest = readBuildManifest();
const canvas = requiredElement<HTMLCanvasElement>('graph-canvas');
const canvasWrap = requiredElement<HTMLElement>('graph-canvas-wrap');
const status = requiredElement<HTMLElement>('graph-status');
const weakControl = requiredElement<HTMLInputElement>('graph-weak-edges');
const nodePanel = requiredElement<HTMLElement>('graph-node-panel');
const nodeTitle = requiredElement<HTMLElement>('graph-node-title');
const nodeOpen = requiredElement<HTMLAnchorElement>('graph-node-open');
const zoomIn = requiredElement<HTMLButtonElement>('graph-zoom-in');
const zoomOut = requiredElement<HTMLButtonElement>('graph-zoom-out');
const labelLayer = requiredElement<HTMLElement>('graph-labels');
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const mobile = window.matchMedia('(max-width: 700px)').matches;
const tileCacheLimit = mobile ? 72 : 192;

const scene = new Scene();
scene.background = null;
scene.fog = new FogExp2(BACKGROUND_COLOR, 0.018);
const webglCamera = new PerspectiveCamera(CAMERA_FOV, 1, 0.1, 80);
const renderer = createRenderer();
const renderedLevels = new Map<GraphLevelName, RenderedLevel>(
  LEVELS.map((levelName) => {
    const group = new Group();
    scene.add(group);
    return [levelName, { group, nodes: [] }];
  }),
);
const selectionRing = new Mesh(
  new RingGeometry(1.32, 1.64, 32),
  new MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0,
    depthTest: false,
    depthWrite: false,
  }),
);
selectionRing.visible = false;
selectionRing.renderOrder = 20;
scene.add(selectionRing);
if (!reduceMotion) scene.add(createStarField());

const tileCache = new Map<string, Promise<GraphTile>>();
const loadedTileOrder = new Map<string, { level: GraphLevelName; key: string; path: string }>();
const loadedTiles = new Map<GraphLevelName, Map<string, GraphTile>>(
  LEVELS.map((levelName) => [levelName, new Map()]),
);
const visibleTileKeys = new Map<GraphLevelName, Set<string>>(
  LEVELS.map((levelName) => [levelName, new Set()]),
);
const pointers = new Map<number, { x: number; y: number }>();
const scratchMatrix = new Matrix4();
const scratchVector = new Vector3();

let graphManifest: GraphManifest | undefined;
let camera: CameraState = { x: 0.5, y: 0.5, zoom: MIN_ZOOM };
let targetCamera: CameraState = { ...camera };
let selectedNode: GraphNode | undefined;
let pendingSelectionId: string | undefined;
let labelEntries: LabelEntry[] = [];
let tileTimer = 0;
let stateTimer = 0;
let tileRequestVersion = 0;
let dragDistance = 0;
let persistentStatus = false;
let lastFrameTime = performance.now();
let animationRunning = false;

void initialize();

weakControl.addEventListener('change', () => {
  updateLevelAppearance(levelWeights(camera.zoom));
  startAnimation();
  scheduleStateSave();
});

zoomIn.addEventListener('click', () => {
  zoomAt(targetCamera.zoom * 1.55, canvas.clientWidth / 2, canvas.clientHeight / 2);
});
zoomOut.addEventListener('click', () => {
  zoomAt(targetCamera.zoom / 1.55, canvas.clientWidth / 2, canvas.clientHeight / 2);
});

nodeOpen.addEventListener('pointerdown', saveHistoryState);
nodeOpen.addEventListener('click', saveHistoryState);

canvas.addEventListener('wheel', (event) => {
  event.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const factor = Math.exp(-event.deltaY * 0.00135);
  zoomAt(targetCamera.zoom * factor, event.clientX - rect.left, event.clientY - rect.top);
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
      zoomAt(
        targetCamera.zoom * (newDistance / oldDistance),
        newMidpoint.x - rect.left,
        newMidpoint.y - rect.top,
        false,
      );
    }
    dragDistance += Math.abs(newDistance - oldDistance) + distance(oldMidpoint, newMidpoint);
    cameraTargetChanged();
  }
});

canvas.addEventListener('pointerup', finishPointer);
canvas.addEventListener('pointercancel', finishPointer);

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
      zoomAt(targetCamera.zoom * 1.5, canvas.clientWidth / 2, canvas.clientHeight / 2);
      break;
    case '-':
      event.preventDefault();
      zoomAt(targetCamera.zoom / 1.5, canvas.clientWidth / 2, canvas.clientHeight / 2);
      break;
    case 'Enter':
    case ' ':
      event.preventDefault();
      selectNearestToCenter();
      break;
  }
});

window.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || !selectedNode) return;
  event.preventDefault();
  clearSelection(true);
});

new ResizeObserver(() => {
  resizeRenderer();
  startAnimation();
  scheduleTileUpdate(0);
}).observe(canvasWrap);

window.addEventListener('pagehide', saveHistoryState);
window.addEventListener('pageshow', (event) => {
  if (!event.persisted) return;
  restoreHistoryState();
  resizeRenderer();
  startAnimation();
  scheduleTileUpdate(0);
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    renderer.setAnimationLoop(null);
    animationRunning = false;
    return;
  }
  startAnimation();
});
canvas.addEventListener('webglcontextlost', (event) => {
  event.preventDefault();
  showStatus('3D 그래프 연결이 중단되었습니다. 페이지를 새로고침해 주세요.', true);
});

async function initialize(): Promise<void> {
  resizeRenderer();
  updateCameraProjection();
  startAnimation();
  try {
    const response = await fetch(buildManifest.graph.manifest, { cache: 'force-cache' });
    if (!response.ok) throw new Error('Graph manifest request failed');
    graphManifest = (await response.json()) as GraphManifest;
    if (graphManifest.buildId !== buildManifest.buildId) throw new Error('Graph manifest build mismatch');

    if (graphManifest.levels.distant.nodeCount === 0) {
      showStatus('표시할 연결이 없습니다.');
      weakControl.disabled = true;
      return;
    }

    const restored = restoreHistoryState();
    if (!restored) await applyFocusFromUrl();
    await loadVisibleTiles();
  } catch {
    showStatus('3D 그래프를 불러오지 못했습니다.', true);
    weakControl.disabled = true;
    zoomIn.disabled = true;
    zoomOut.disabled = true;
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
  targetCamera = { ...camera };
  pendingSelectionId = focusId;
  updateCameraProjection();
}

async function loadVisibleTiles(): Promise<void> {
  if (!graphManifest) return;
  const requestVersion = ++tileRequestVersion;
  const activeLevels = new Set(levelsForZoom(targetCamera.zoom));
  const rebuildLevels = new Set<GraphLevelName>();
  const requests: Promise<void>[] = [];

  for (const levelName of LEVELS) {
    if (!activeLevels.has(levelName)) {
      visibleTileKeys.set(levelName, new Set());
      continue;
    }
    const keys = calculateVisibleTileKeys(graphManifest.levels[levelName]);
    if (!setsEqual(keys, visibleTileKeys.get(levelName)!)) rebuildLevels.add(levelName);
    visibleTileKeys.set(levelName, keys);
    const levelTiles = loadedTiles.get(levelName)!;
    for (const key of keys) {
      if (levelTiles.has(key)) continue;
      const path = `${buildManifest.basePath}/graph/${levelName}/${key}.json`;
      requests.push(
        fetchTile(path).then((tile) => {
          if (tile.level !== levelName) throw new Error('Graph tile level mismatch');
          levelTiles.set(key, tile);
          rememberLoadedTile(levelName, key, path);
          rebuildLevels.add(levelName);
        }),
      );
    }
  }

  if (requests.length > 0 && !persistentStatus) showStatus('은하를 불러오는 중입니다.');
  await Promise.all(requests);
  if (requestVersion !== tileRequestVersion) return;

  for (const levelName of rebuildLevels) rebuildLevelScene(levelName);
  if (pendingSelectionId) {
    const focused = currentNodes('near').find((node) => node.id === pendingSelectionId);
    if (focused) {
      selectNode(focused);
      pendingSelectionId = undefined;
    }
  }

  const hasNodes = [...activeLevels].some((levelName) => currentNodes(levelName).length > 0);
  if (!persistentStatus) {
    if (hasNodes) status.hidden = true;
    else showStatus('이 위치에 표시할 문서가 없습니다.');
  }
}

function rebuildLevelScene(levelName: GraphLevelName): void {
  const rendered = renderedLevels.get(levelName)!;
  disposeRenderedLevel(rendered);
  const nodes = currentNodes(levelName);
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const worldPositions = new Map(nodes.map((node) => [node.id, nodeWorldPosition(node)]));
  const visibleNodes = nodes.filter((node) => node.kind !== 'hub');
  rendered.nodes = visibleNodes;

  if (visibleNodes.length > 0) {
    const geometry = new SphereGeometry(1, mobile ? 6 : 8, mobile ? 4 : 6);
    const material = new MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    const mesh = new InstancedMesh(geometry, material, visibleNodes.length);
    visibleNodes.forEach((node, index) => {
      const position = worldPositions.get(node.id)!;
      const radius = nodeWorldRadius(node);
      scratchMatrix.makeScale(radius, radius, radius);
      scratchMatrix.setPosition(position);
      mesh.setMatrixAt(index, scratchMatrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    mesh.renderOrder = 4;
    rendered.group.add(mesh);
    rendered.nodeMesh = mesh;
    rendered.nodeMaterial = material;
  }

  const edges = currentEdges(levelName);
  const strong = createEdgeLines(edges, nodesById, worldPositions, 'strong');
  if (strong) {
    rendered.group.add(strong.lines);
    rendered.strongLines = strong.lines;
    rendered.strongMaterial = strong.material;
  }
  const weak = createEdgeLines(edges, nodesById, worldPositions, 'weak');
  if (weak) {
    rendered.group.add(weak.lines);
    rendered.weakLines = weak.lines;
    rendered.weakMaterial = weak.material;
  }

  if (levelName === 'near') rebuildLabels(visibleNodes);
  updateLevelAppearance(levelWeights(camera.zoom));
  startAnimation();
}

function createEdgeLines(
  edges: GraphEdge[],
  nodesById: Map<string, GraphNode>,
  worldPositions: Map<string, Vector3>,
  strength: 'strong' | 'weak',
): { lines: LineSegments; material: LineBasicMaterial } | undefined {
  const positions: number[] = [];
  for (const edge of edges) {
    if (edge.strength !== strength) continue;
    const source = nodesById.get(edge.source);
    const target = nodesById.get(edge.target);
    if (!source || !target) continue;
    const from = worldPositions.get(source.id)!;
    const to = worldPositions.get(target.id)!;
    positions.push(from.x, from.y, from.z, to.x, to.y, to.z);
  }
  if (positions.length === 0) return undefined;
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  const material = new LineBasicMaterial({
    color: strength === 'strong' ? 0xd5d9df : 0xbfc4cc,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const lines = new LineSegments(geometry, material);
  lines.frustumCulled = false;
  lines.renderOrder = strength === 'strong' ? 2 : 1;
  return { lines, material };
}

function disposeRenderedLevel(rendered: RenderedLevel): void {
  rendered.group.clear();
  rendered.nodeMesh?.geometry.dispose();
  rendered.nodeMaterial?.dispose();
  rendered.strongLines?.geometry.dispose();
  rendered.strongMaterial?.dispose();
  rendered.weakLines?.geometry.dispose();
  rendered.weakMaterial?.dispose();
  rendered.nodeMesh = undefined;
  rendered.nodeMaterial = undefined;
  rendered.strongLines = undefined;
  rendered.strongMaterial = undefined;
  rendered.weakLines = undefined;
  rendered.weakMaterial = undefined;
  rendered.nodes = [];
}

function createStarField(): Points {
  const positions: number[] = [];
  const count = mobile ? 180 : 520;
  for (let index = 0; index < count; index += 1) {
    positions.push(
      (hashUnit(index, 17) - 0.5) * WORLD_SIZE * 2.4,
      (hashUnit(index, 53) - 0.5) * WORLD_SIZE * 2,
      (hashUnit(index, 97) - 0.5) * WORLD_DEPTH * 3.6,
    );
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  const material = new PointsMaterial({
    color: 0xffffff,
    size: mobile ? 0.025 : 0.032,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
    sizeAttenuation: true,
  });
  const points = new Points(geometry, material);
  points.renderOrder = 0;
  return points;
}

function rememberLoadedTile(levelName: GraphLevelName, key: string, path: string): void {
  const orderKey = `${levelName}:${key}`;
  loadedTileOrder.delete(orderKey);
  loadedTileOrder.set(orderKey, { level: levelName, key, path });
  while (loadedTileOrder.size > tileCacheLimit) {
    const candidate = [...loadedTileOrder].find(
      ([, value]) => !visibleTileKeys.get(value.level)?.has(value.key),
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
  const normalizedHeight = normalizedViewHeight(targetCamera.zoom);
  const halfWidth = normalizedHeight * Math.max(1, rect.width / Math.max(1, rect.height)) / 2;
  const halfHeight = normalizedHeight / 2;
  const buffer = mobile ? 0 : 1;
  const grid = levelManifest.gridSize;
  const minColumn = clampInteger(Math.floor((targetCamera.x - halfWidth) * grid) - buffer, 0, grid - 1);
  const maxColumn = clampInteger(Math.floor((targetCamera.x + halfWidth) * grid) + buffer, 0, grid - 1);
  const minRow = clampInteger(Math.floor((targetCamera.y - halfHeight) * grid) - buffer, 0, grid - 1);
  const maxRow = clampInteger(Math.floor((targetCamera.y + halfHeight) * grid) + buffer, 0, grid - 1);
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

function renderFrame(time: number): void {
  const deltaSeconds = Math.min(0.05, Math.max(0.001, (time - lastFrameTime) / 1000));
  lastFrameTime = time;
  const damping = reduceMotion ? 1 : 1 - Math.exp(-deltaSeconds * 11);
  camera.x += (targetCamera.x - camera.x) * damping;
  camera.y += (targetCamera.y - camera.y) * damping;
  camera.zoom += (targetCamera.zoom - camera.zoom) * damping;
  if (Math.abs(targetCamera.x - camera.x) < 0.000001) camera.x = targetCamera.x;
  if (Math.abs(targetCamera.y - camera.y) < 0.000001) camera.y = targetCamera.y;
  if (Math.abs(targetCamera.zoom - camera.zoom) < 0.00001) camera.zoom = targetCamera.zoom;

  updateCameraProjection();
  const weights = levelWeights(camera.zoom);
  updateLevelAppearance(weights);
  updateSelectionMarker(weights.near);
  renderer.render(scene, webglCamera);
  updateLabels(weights.near);
  positionNodePanel(weights.near);
  if (
    camera.x === targetCamera.x &&
    camera.y === targetCamera.y &&
    camera.zoom === targetCamera.zoom
  ) {
    renderer.setAnimationLoop(null);
    animationRunning = false;
  }
}

function updateCameraProjection(): void {
  const center = graphWorldPosition(camera.x, camera.y, 0.5);
  webglCamera.position.set(center.x, center.y, center.z + CAMERA_DISTANCE);
  webglCamera.zoom = camera.zoom;
  webglCamera.lookAt(center);
  webglCamera.updateProjectionMatrix();
  webglCamera.updateMatrixWorld();
}

function updateLevelAppearance(weights: Record<GraphLevelName, number>): void {
  for (const levelName of LEVELS) {
    const rendered = renderedLevels.get(levelName)!;
    const weight = weights[levelName];
    rendered.group.visible = weight > 0.002;
    if (rendered.nodeMaterial) {
      const baseOpacity = levelName === 'near' ? 0.94 : levelName === 'medium' ? 0.78 : 0.68;
      rendered.nodeMaterial.opacity = baseOpacity * weight;
    }
    if (rendered.strongMaterial) rendered.strongMaterial.opacity = 0.34 * weight;
    if (rendered.weakMaterial) rendered.weakMaterial.opacity = 0.12 * weight;
    if (rendered.weakLines) rendered.weakLines.visible = weakControl.checked && weight > 0.002;
  }
}

function updateSelectionMarker(nearWeight: number): void {
  if (!selectedNode || nearWeight < 0.08) {
    selectionRing.visible = false;
    return;
  }
  selectionRing.visible = true;
  setGraphWorldPosition(scratchVector, selectedNode.x, selectedNode.y, selectedNode.z);
  selectionRing.position.copy(scratchVector);
  selectionRing.quaternion.copy(webglCamera.quaternion);
  selectionRing.scale.setScalar(nodeWorldRadius(selectedNode));
  (selectionRing.material as MeshBasicMaterial).opacity = Math.min(1, nearWeight);
}

function cameraTargetChanged(): void {
  if (persistentStatus) {
    persistentStatus = false;
    status.hidden = true;
  }
  if (targetCamera.zoom < 7.2 && selectedNode) clearSelection();
  startAnimation();
  scheduleTileUpdate();
  scheduleStateSave();
}

function scheduleTileUpdate(delay = 80): void {
  window.clearTimeout(tileTimer);
  tileTimer = window.setTimeout(() => {
    void loadVisibleTiles().catch(() => showStatus('3D 그래프를 불러오지 못했습니다.', true));
  }, delay);
}

function panByPixels(deltaX: number, deltaY: number, notify = true): void {
  const rect = canvas.getBoundingClientRect();
  const unitsPerPixel = normalizedViewHeight(targetCamera.zoom) / Math.max(1, rect.height);
  targetCamera.x -= deltaX * unitsPerPixel;
  targetCamera.y -= deltaY * unitsPerPixel;
  clampCamera(targetCamera);
  if (notify) cameraTargetChanged();
}

function zoomAt(nextZoom: number, screenX: number, screenY: number, notify = true): void {
  const rect = canvas.getBoundingClientRect();
  const oldHeight = normalizedViewHeight(targetCamera.zoom);
  const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoom));
  const nextHeight = normalizedViewHeight(next);
  const aspect = rect.width / Math.max(1, rect.height);
  const normalizedX = screenX / Math.max(1, rect.width) * 2 - 1;
  const normalizedY = screenY / Math.max(1, rect.height) * 2 - 1;
  targetCamera.x += normalizedX * (oldHeight - nextHeight) * aspect / 2;
  targetCamera.y += normalizedY * (oldHeight - nextHeight) / 2;
  targetCamera.zoom = next;
  clampCamera(targetCamera);
  if (notify) cameraTargetChanged();
}

function normalizedViewHeight(zoom: number): number {
  const worldHeight = 2 * CAMERA_DISTANCE * Math.tan(CAMERA_FOV * Math.PI / 360) / zoom;
  return worldHeight / WORLD_SIZE;
}

function finishPointer(event: PointerEvent): void {
  const point = pointers.get(event.pointerId);
  const wasSingle = pointers.size === 1;
  pointers.delete(event.pointerId);
  if (pointers.size === 0) canvas.classList.remove('is-dragging');
  if (wasSingle && point && dragDistance < 6 && event.type === 'pointerup') {
    selectAt(event.clientX, event.clientY);
  }
  dragDistance = 0;
}

function selectAt(clientX: number, clientY: number): void {
  const nearWeight = levelWeights(camera.zoom).near;
  if (nearWeight < 0.12) {
    clearSelection();
    return;
  }
  const rect = canvas.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  const hit = currentNodes('near')
    .filter((node) => node.kind === 'document')
    .map((node) => {
      const point = projectNode(node);
      return { node, distance: Math.hypot(point.x - x, point.y - y) };
    })
    .filter(({ node, distance }) => distance <= Math.max(12, projectedNodeRadius(node) + 5))
    .sort((left, right) => left.distance - right.distance)[0]?.node;
  if (!hit) {
    clearSelection();
    return;
  }
  selectNode(hit);
}

function selectNearestToCenter(): void {
  if (levelWeights(camera.zoom).near < 0.12) return;
  const center = { x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 };
  const nearest = currentNodes('near')
    .filter((node) => node.kind === 'document')
    .map((node) => ({ node, distance: distance(projectNode(node), center) }))
    .sort((left, right) => left.distance - right.distance)[0]?.node;
  if (nearest) selectNode(nearest);
}

function selectNode(node: GraphNode): void {
  selectedNode = node;
  nodeTitle.textContent = node.title;
  nodeOpen.href = node.url;
  nodePanel.hidden = false;
  positionNodePanel(levelWeights(camera.zoom).near);
  startAnimation();
  scheduleStateSave();
}

function clearSelection(restoreCanvasFocus = false): void {
  selectedNode = undefined;
  nodePanel.hidden = true;
  selectionRing.visible = false;
  startAnimation();
  scheduleStateSave();
  if (restoreCanvasFocus) canvas.focus();
}

function currentNodes(levelName: GraphLevelName): GraphNode[] {
  const tiles = loadedTiles.get(levelName)!;
  return [...visibleTileKeys.get(levelName)!]
    .flatMap((key) => tiles.get(key)?.nodes ?? [])
    .filter((node, index, values) => values.findIndex((candidate) => candidate.id === node.id) === index);
}

function currentEdges(levelName: GraphLevelName): GraphEdge[] {
  const tiles = loadedTiles.get(levelName)!;
  const edges = new Map<string, GraphEdge>();
  for (const key of visibleTileKeys.get(levelName)!) {
    for (const edge of tiles.get(key)?.edges ?? []) edges.set(`${edge.source}\0${edge.target}`, edge);
  }
  return [...edges.values()];
}

function rebuildLabels(nodes: GraphNode[]): void {
  const limit = mobile ? 36 : 140;
  const candidates = nodes
    .filter((node) => node.kind === 'document' && node.title)
    .sort((left, right) => right.weight - left.weight || left.id.localeCompare(right.id))
    .slice(0, limit);
  const fragment = document.createDocumentFragment();
  labelEntries = candidates.map((node) => {
    const element = document.createElement('span');
    element.className = 'graph-label';
    element.textContent = node.title;
    fragment.append(element);
    return { node, element };
  });
  labelLayer.replaceChildren(fragment);
}

function updateLabels(nearWeight: number): void {
  if (nearWeight < 0.35) {
    labelLayer.hidden = true;
    return;
  }
  labelLayer.hidden = false;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const boxes: Array<{ left: number; right: number; top: number; bottom: number }> = [];
  for (const { node, element } of labelEntries) {
    const point = projectNode(node);
    const radius = projectedNodeRadius(node);
    const textWidth = Math.min(220, Math.max(32, [...node.title].length * (mobile ? 6.4 : 7.2)));
    const box = {
      left: point.x + radius + 6,
      right: point.x + radius + 6 + textWidth,
      top: point.y - 9,
      bottom: point.y + 9,
    };
    const visible =
      box.right >= 0 &&
      box.left <= width &&
      box.bottom >= 0 &&
      box.top <= height &&
      !boxes.some((other) => overlaps(box, other));
    element.hidden = !visible;
    if (!visible) continue;
    element.style.transform = `translate3d(${box.left}px, ${point.y}px, 0) translateY(-50%)`;
    element.style.opacity = String(Math.min(0.78, nearWeight));
    boxes.push(box);
  }
}

function positionNodePanel(nearWeight: number): void {
  if (!selectedNode || nearWeight < 0.08) {
    nodePanel.hidden = true;
    return;
  }
  const rect = canvas.getBoundingClientRect();
  const point = projectNode(selectedNode);
  if (point.x < 0 || point.x > rect.width || point.y < 0 || point.y > rect.height) {
    nodePanel.hidden = true;
    return;
  }

  nodePanel.hidden = false;
  const panelWidth = nodePanel.offsetWidth;
  const panelHeight = nodePanel.offsetHeight;
  const gutter = 12;
  const panelLeft = Math.min(
    rect.width - panelWidth / 2 - gutter,
    Math.max(panelWidth / 2 + gutter, point.x),
  );
  const placeBelow = point.y - panelHeight - 16 < gutter;
  const pointerX = Math.min(panelWidth - 18, Math.max(18, point.x - panelLeft + panelWidth / 2));
  nodePanel.style.left = `${panelLeft}px`;
  nodePanel.style.top = `${point.y}px`;
  nodePanel.style.setProperty('--graph-popover-pointer-x', `${pointerX}px`);
  nodePanel.classList.toggle('is-below', placeBelow);
}

function projectNode(node: GraphNode): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  setGraphWorldPosition(scratchVector, node.x, node.y, node.z).project(webglCamera);
  return {
    x: (scratchVector.x + 1) * rect.width / 2,
    y: (1 - scratchVector.y) * rect.height / 2,
  };
}

function projectedNodeRadius(node: GraphNode): number {
  const rect = canvas.getBoundingClientRect();
  const pixelsPerWorldUnit = rect.height * camera.zoom /
    (2 * CAMERA_DISTANCE * Math.tan(CAMERA_FOV * Math.PI / 360));
  return nodeWorldRadius(node) * pixelsPerWorldUnit;
}

function nodeWorldPosition(node: Pick<GraphNode, 'x' | 'y' | 'z'>): Vector3 {
  return setGraphWorldPosition(new Vector3(), node.x, node.y, node.z);
}

function graphWorldPosition(x: number, y: number, z: number): Vector3 {
  return setGraphWorldPosition(new Vector3(), x, y, z);
}

function setGraphWorldPosition(target: Vector3, x: number, y: number, z: number): Vector3 {
  return target.set(
    (x - 0.5) * WORLD_SIZE,
    (0.5 - y) * WORLD_SIZE,
    (z - 0.5) * WORLD_DEPTH,
  ).applyEuler(GALAXY_TILT);
}

function nodeWorldRadius(node: GraphNode): number {
  if (node.kind === 'cluster') {
    return Math.min(0.18, 0.075 + Math.sqrt(Math.max(1, node.weight)) * 0.012);
  }
  return Math.min(0.026, 0.013 + Math.log1p(Math.max(1, node.weight)) * 0.0032);
}

function levelWeights(zoom: number): Record<GraphLevelName, number> {
  const distantToMedium = smoothstep(1.65, 3.3, zoom);
  const mediumToNear = smoothstep(7.2, 10.8, zoom);
  return {
    distant: 1 - distantToMedium,
    medium: distantToMedium * (1 - mediumToNear),
    near: mediumToNear,
  };
}

function levelsForZoom(zoom: number): GraphLevelName[] {
  const weights = levelWeights(zoom);
  return LEVELS.filter((levelName) => weights[levelName] > 0.015);
}

function resizeRenderer(): void {
  const rect = canvasWrap.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile ? 1.5 : 2));
  renderer.setSize(width, height, false);
  webglCamera.aspect = width / height;
  webglCamera.updateProjectionMatrix();
}

function startAnimation(): void {
  if (animationRunning || document.hidden) return;
  animationRunning = true;
  lastFrameTime = performance.now();
  renderer.setAnimationLoop(renderFrame);
}

function restoreHistoryState(): boolean {
  const value = (history.state as { astronetGraph?: SavedGraphState } | null)?.astronetGraph;
  if (!value || value.buildId !== buildManifest.buildId) return false;
  camera = { ...value.camera };
  targetCamera = { ...value.camera };
  clampCamera(camera);
  clampCamera(targetCamera);
  weakControl.checked = value.weakEdges;
  pendingSelectionId = value.selectedId;
  updateCameraProjection();
  return true;
}

function scheduleStateSave(): void {
  window.clearTimeout(stateTimer);
  stateTimer = window.setTimeout(saveHistoryState, 120);
}

function saveHistoryState(): void {
  const state: SavedGraphState = {
    buildId: buildManifest.buildId,
    camera: { ...targetCamera },
    selectedId: selectedNode?.id,
    weakEdges: weakControl.checked,
  };
  history.replaceState({ ...(history.state ?? {}), astronetGraph: state }, '', window.location.href);
}

function createRenderer(): WebGLRenderer {
  try {
    const value = new WebGLRenderer({
      canvas,
      antialias: !mobile,
      alpha: false,
      powerPreference: 'high-performance',
    });
    value.setClearColor(BACKGROUND_COLOR, 1);
    return value;
  } catch (error) {
    showStatus('이 브라우저에서는 3D 그래프를 표시할 수 없습니다.', true);
    weakControl.disabled = true;
    zoomIn.disabled = true;
    zoomOut.disabled = true;
    throw error;
  }
}

function showStatus(message: string, persistent = false): void {
  status.textContent = message;
  status.hidden = false;
  persistentStatus = persistent;
}

function clampCamera(value: CameraState): void {
  value.x = Math.min(1, Math.max(0, value.x));
  value.y = Math.min(1, Math.max(0, value.y));
  value.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value.zoom));
}

function smoothstep(minimum: number, maximum: number, value: number): number {
  const normalized = Math.min(1, Math.max(0, (value - minimum) / (maximum - minimum)));
  return normalized * normalized * (3 - 2 * normalized);
}

function setsEqual(left: Set<string>, right: Set<string>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function distance(left: { x: number; y: number }, right: { x: number; y: number }): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function midpoint(left: { x: number; y: number }, right: { x: number; y: number }): { x: number; y: number } {
  return { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 };
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
