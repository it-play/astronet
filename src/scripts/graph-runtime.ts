import {
  BufferGeometry,
  Euler,
  Float32BufferAttribute,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Points,
  RingGeometry,
  Scene,
  ShaderMaterial,
  Vector3,
  WebGLRenderer,
} from 'three';
import { articleBucket } from '../content/shared';
import type { BuildManifest, GraphFocusPack, GraphNode, GraphTile } from '../content/types';

interface GraphManifest {
  buildId: string;
  layoutVersion: string;
  overview: {
    path: string;
    nodeCount: number;
    edgeCount: number;
  };
  detail: {
    gridSize: number;
    nodeCount: number;
    tiles: string[];
  };
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

interface LabelEntry {
  node: GraphNode;
  element: HTMLSpanElement;
}

const BACKGROUND_COLOR = 0x181d26;
const WORLD_SIZE = 18;
const WORLD_DEPTH = 5.5;
const CAMERA_DISTANCE = 24;
const CAMERA_FOV = 42;
const MIN_ZOOM = 0.82;
const MAX_ZOOM = 28;
const DETAIL_LOAD_ZOOM = 4.5;
const LABEL_ZOOM = 6;
const OVERVIEW_HEADER_SIZE = 20;
const OVERVIEW_VERSION = 1;
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
const webglCamera = new PerspectiveCamera(CAMERA_FOV, 1, 0.1, 80);
const renderer = createRenderer();
const selectionRing = new Mesh(
  new RingGeometry(1.32, 1.64, 32),
  new MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.92,
    depthTest: false,
    depthWrite: false,
  }),
);
selectionRing.visible = false;
selectionRing.renderOrder = 20;
scene.add(selectionRing);

const tileCache = new Map<string, Promise<GraphTile>>();
const loadedTileOrder = new Map<string, string>();
const loadedTiles = new Map<string, GraphTile>();
const visibleTileKeys = new Set<string>();
const availableTileKeys = new Set<string>();
const pointers = new Map<number, { x: number; y: number }>();
const scratchVector = new Vector3();

let graphManifest: GraphManifest | undefined;
let graphPoints: Points<BufferGeometry, ShaderMaterial> | undefined;
let strongLines: LineSegments | undefined;
let weakLines: LineSegments | undefined;
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
  if (weakLines) weakLines.visible = weakControl.checked;
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
  scheduleDetailUpdate(0);
}).observe(canvasWrap);

window.addEventListener('pagehide', saveHistoryState);
window.addEventListener('pageshow', (event) => {
  if (!event.persisted) return;
  restoreHistoryState();
  resizeRenderer();
  startAnimation();
  scheduleDetailUpdate(0);
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
    const manifestResponse = await fetch(buildManifest.graph.manifest, { cache: 'force-cache' });
    if (!manifestResponse.ok) throw new Error('Graph manifest request failed');
    graphManifest = (await manifestResponse.json()) as GraphManifest;
    if (graphManifest.buildId !== buildManifest.buildId) throw new Error('Graph manifest build mismatch');
    availableTileKeys.clear();
    graphManifest.detail.tiles.forEach((key) => availableTileKeys.add(key));

    const overviewResponse = await fetch(graphManifest.overview.path, { cache: 'force-cache' });
    if (!overviewResponse.ok) throw new Error('Graph overview request failed');
    const overview = decodeOverview(await overviewResponse.arrayBuffer());
    if (
      overview.nodeCount !== graphManifest.overview.nodeCount ||
      overview.edgeCount !== graphManifest.overview.edgeCount
    ) {
      throw new Error('Graph overview count mismatch');
    }
    mountOverview(overview);

    if (graphManifest.detail.nodeCount === 0) {
      showStatus('표시할 문서가 없습니다.');
      weakControl.disabled = true;
      return;
    }

    const restored = restoreHistoryState();
    if (!restored) await applyFocusFromUrl();
    await loadVisibleDetailTiles();
    if (!persistentStatus) status.hidden = true;
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
  const focusPath = `${buildManifest.basePath}/graph/focus/${bucket}.json`;
  const response = await fetch(focusPath, { cache: 'force-cache' });
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

interface DecodedOverview {
  nodeCount: number;
  edgeCount: number;
  pointPositions: number[];
  pointDiameters: number[];
  strongPositions: number[];
  weakPositions: number[];
}

function decodeOverview(buffer: ArrayBuffer): DecodedOverview {
  if (buffer.byteLength < OVERVIEW_HEADER_SIZE) throw new Error('Graph overview header is missing');
  const bytes = new Uint8Array(buffer);
  if (String.fromCharCode(...bytes.subarray(0, 4)) !== 'AG3D') throw new Error('Graph overview magic mismatch');
  const view = new DataView(buffer);
  const version = view.getUint16(4, true);
  const nodeStride = view.getUint16(6, true);
  const nodeCount = view.getUint32(8, true);
  const edgeCount = view.getUint32(12, true);
  const edgeStride = view.getUint16(16, true);
  if (version !== OVERVIEW_VERSION || nodeStride < 10 || edgeStride < 9) {
    throw new Error('Graph overview version mismatch');
  }
  const expectedLength = OVERVIEW_HEADER_SIZE + nodeCount * nodeStride + edgeCount * edgeStride;
  if (buffer.byteLength !== expectedLength) throw new Error('Graph overview length mismatch');

  const allPositions = new Float32Array(nodeCount * 3);
  const pointPositions: number[] = [];
  const pointDiameters: number[] = [];
  let offset = OVERVIEW_HEADER_SIZE;
  for (let index = 0; index < nodeCount; index += 1) {
    const x = view.getUint16(offset, true) / 65_535;
    const y = view.getUint16(offset + 2, true) / 65_535;
    const z = view.getUint16(offset + 4, true) / 65_535;
    const encodedSize = view.getUint16(offset + 6, true);
    const flags = view.getUint8(offset + 8);
    setGraphWorldPosition(scratchVector, x, y, z);
    allPositions[index * 3] = scratchVector.x;
    allPositions[index * 3 + 1] = scratchVector.y;
    allPositions[index * 3 + 2] = scratchVector.z;
    if ((flags & 1) !== 0) {
      pointPositions.push(scratchVector.x, scratchVector.y, scratchVector.z);
      pointDiameters.push(decodeNodeDiameter(encodedSize));
    }
    offset += nodeStride;
  }

  const strongPositions: number[] = [];
  const weakPositions: number[] = [];
  for (let index = 0; index < edgeCount; index += 1) {
    const source = view.getUint32(offset, true);
    const target = view.getUint32(offset + 4, true);
    const isStrong = view.getUint8(offset + 8) === 1;
    if (source >= nodeCount || target >= nodeCount) throw new Error('Graph overview edge is invalid');
    const positions = isStrong ? strongPositions : weakPositions;
    positions.push(
      allPositions[source * 3]!,
      allPositions[source * 3 + 1]!,
      allPositions[source * 3 + 2]!,
      allPositions[target * 3]!,
      allPositions[target * 3 + 1]!,
      allPositions[target * 3 + 2]!,
    );
    offset += edgeStride;
  }
  return { nodeCount, edgeCount, pointPositions, pointDiameters, strongPositions, weakPositions };
}

function mountOverview(overview: DecodedOverview): void {
  const pointGeometry = new BufferGeometry();
  pointGeometry.setAttribute('position', new Float32BufferAttribute(overview.pointPositions, 3));
  pointGeometry.setAttribute('pointDiameter', new Float32BufferAttribute(overview.pointDiameters, 1));
  const pointMaterial = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      viewportHeight: { value: Math.max(1, canvas.clientHeight * renderer.getPixelRatio()) },
    },
    vertexShader: `
      attribute float pointDiameter;
      uniform float viewportHeight;

      void main() {
        vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * viewPosition;
        gl_PointSize = clamp(
          pointDiameter * viewportHeight * projectionMatrix[1][1] / max(0.1, -viewPosition.z),
          1.35,
          44.0
        );
      }
    `,
    fragmentShader: `
      void main() {
        vec2 point = gl_PointCoord - vec2(0.5);
        float radius = dot(point, point);
        if (radius > 0.25) discard;
        float alpha = 1.0 - smoothstep(0.205, 0.25, radius);
        gl_FragColor = vec4(1.0, 1.0, 1.0, alpha * 0.94);
      }
    `,
  });
  graphPoints = new Points(pointGeometry, pointMaterial);
  graphPoints.frustumCulled = false;
  graphPoints.renderOrder = 4;
  scene.add(graphPoints);

  strongLines = createEdgeLines(overview.strongPositions, 0xd5d9df, 0.3, 2);
  weakLines = createEdgeLines(overview.weakPositions, 0xbfc4cc, 0.11, 1);
  if (strongLines) scene.add(strongLines);
  if (weakLines) {
    weakLines.visible = weakControl.checked;
    scene.add(weakLines);
  } else {
    weakControl.disabled = true;
  }
  startAnimation();
}

function createEdgeLines(
  positions: number[],
  color: number,
  opacity: number,
  renderOrder: number,
): LineSegments | undefined {
  if (positions.length === 0) return undefined;
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  const material = new LineBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
  });
  const lines = new LineSegments(geometry, material);
  lines.frustumCulled = false;
  lines.renderOrder = renderOrder;
  return lines;
}

async function loadVisibleDetailTiles(): Promise<void> {
  if (!graphManifest) return;
  const requestVersion = ++tileRequestVersion;
  if (targetCamera.zoom < DETAIL_LOAD_ZOOM) {
    if (visibleTileKeys.size > 0) {
      visibleTileKeys.clear();
      rebuildLabels([]);
    }
    return;
  }

  const nextKeys = calculateVisibleTileKeys(graphManifest.detail);
  const changed = !setsEqual(nextKeys, visibleTileKeys);
  visibleTileKeys.clear();
  nextKeys.forEach((key) => visibleTileKeys.add(key));
  const requests: Promise<void>[] = [];
  for (const key of visibleTileKeys) {
    if (loadedTiles.has(key)) {
      rememberLoadedTile(key, `${buildManifest.basePath}/graph/detail/${key}.json`);
      continue;
    }
    const tilePath = `${buildManifest.basePath}/graph/detail/${key}.json`;
    requests.push(
      fetchTile(tilePath).then((tile) => {
        if (tile.level !== 'detail') throw new Error('Graph detail tile mismatch');
        loadedTiles.set(key, tile);
        rememberLoadedTile(key, tilePath);
      }),
    );
  }
  await Promise.all(requests);
  if (requestVersion !== tileRequestVersion) return;
  if (changed || requests.length > 0) rebuildLabels(currentDetailNodes());

  if (pendingSelectionId) {
    const focused = currentDetailNodes().find((node) => node.id === pendingSelectionId);
    if (focused) {
      selectNode(focused);
      pendingSelectionId = undefined;
    }
  }
}

function rememberLoadedTile(key: string, tilePath: string): void {
  loadedTileOrder.delete(key);
  loadedTileOrder.set(key, tilePath);
  while (loadedTileOrder.size > tileCacheLimit) {
    const candidate = [...loadedTileOrder].find(([candidateKey]) => !visibleTileKeys.has(candidateKey));
    if (!candidate) return;
    const [candidateKey, candidatePath] = candidate;
    loadedTileOrder.delete(candidateKey);
    loadedTiles.delete(candidateKey);
    tileCache.delete(candidatePath);
  }
}

async function fetchTile(tilePath: string): Promise<GraphTile> {
  const cached = tileCache.get(tilePath);
  if (cached) return cached;
  const request = fetch(tilePath, { cache: 'force-cache' }).then(async (response) => {
    if (!response.ok) throw new Error('Graph detail tile request failed');
    const tile = (await response.json()) as GraphTile;
    if (tile.buildId !== buildManifest.buildId) throw new Error('Graph detail build mismatch');
    return tile;
  });
  tileCache.set(tilePath, request);
  try {
    return await request;
  } catch (cause) {
    tileCache.delete(tilePath);
    throw cause;
  }
}

function calculateVisibleTileKeys(detail: GraphManifest['detail']): Set<string> {
  const rect = canvas.getBoundingClientRect();
  const normalizedHeight = normalizedViewHeight(targetCamera.zoom);
  const halfWidth = normalizedHeight * Math.max(1, rect.width / Math.max(1, rect.height)) / 2;
  const halfHeight = normalizedHeight / 2;
  const buffer = mobile ? 0 : 1;
  const grid = detail.gridSize;
  const minColumn = clampInteger(Math.floor((targetCamera.x - halfWidth) * grid) - buffer, 0, grid - 1);
  const maxColumn = clampInteger(Math.floor((targetCamera.x + halfWidth) * grid) + buffer, 0, grid - 1);
  const minRow = clampInteger(Math.floor((targetCamera.y - halfHeight) * grid) - buffer, 0, grid - 1);
  const maxRow = clampInteger(Math.floor((targetCamera.y + halfHeight) * grid) + buffer, 0, grid - 1);
  const keys = new Set<string>();
  for (let column = minColumn; column <= maxColumn; column += 1) {
    for (let row = minRow; row <= maxRow; row += 1) {
      const key = `${column}-${row}`;
      if (availableTileKeys.has(key)) keys.add(key);
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
  updateSelectionMarker();
  renderer.render(scene, webglCamera);
  updateLabels();
  positionNodePanel();
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

function updateSelectionMarker(): void {
  if (!selectedNode) {
    selectionRing.visible = false;
    return;
  }
  selectionRing.visible = true;
  setGraphWorldPosition(scratchVector, selectedNode.x, selectedNode.y, selectedNode.z);
  selectionRing.position.copy(scratchVector);
  selectionRing.quaternion.copy(webglCamera.quaternion);
  selectionRing.scale.setScalar(nodeWorldRadius(selectedNode));
}

function cameraTargetChanged(): void {
  if (persistentStatus) {
    persistentStatus = false;
    status.hidden = true;
  }
  if (targetCamera.zoom < DETAIL_LOAD_ZOOM && selectedNode) clearSelection();
  startAnimation();
  scheduleDetailUpdate();
  scheduleStateSave();
}

function scheduleDetailUpdate(delay = 80): void {
  window.clearTimeout(tileTimer);
  tileTimer = window.setTimeout(() => {
    void loadVisibleDetailTiles().catch(() => showStatus('문서 정보를 불러오지 못했습니다.', true));
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
  if (camera.zoom < DETAIL_LOAD_ZOOM) {
    clearSelection();
    return;
  }
  const rect = canvas.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  const hit = currentDetailNodes()
    .map((node) => {
      const point = projectNode(node);
      return { node, distance: Math.hypot(point.x - x, point.y - y) };
    })
    .filter(({ node, distance: nodeDistance }) => nodeDistance <= Math.max(12, projectedNodeRadius(node) + 5))
    .sort((left, right) => left.distance - right.distance)[0]?.node;
  if (!hit) {
    clearSelection();
    return;
  }
  selectNode(hit);
}

function selectNearestToCenter(): void {
  if (camera.zoom < DETAIL_LOAD_ZOOM) return;
  const center = { x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 };
  const nearest = currentDetailNodes()
    .map((node) => ({ node, distance: distance(projectNode(node), center) }))
    .sort((left, right) => left.distance - right.distance)[0]?.node;
  if (nearest) selectNode(nearest);
}

function selectNode(node: GraphNode): void {
  selectedNode = node;
  nodeTitle.textContent = node.title;
  nodeOpen.href = node.url;
  nodePanel.hidden = false;
  positionNodePanel();
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

function currentDetailNodes(): GraphNode[] {
  const nodes = new Map<string, GraphNode>();
  for (const key of visibleTileKeys) {
    for (const node of loadedTiles.get(key)?.nodes ?? []) nodes.set(node.id, node);
  }
  return [...nodes.values()];
}

function rebuildLabels(nodes: GraphNode[]): void {
  const limit = mobile ? 36 : 140;
  const candidates = nodes
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

function updateLabels(): void {
  if (camera.zoom < LABEL_ZOOM) {
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
    element.style.opacity = '0.78';
    boxes.push(box);
  }
}

function positionNodePanel(): void {
  if (!selectedNode) {
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
  return Math.min(0.026, 0.013 + Math.log1p(Math.max(1, node.weight)) * 0.0032);
}

function decodeNodeDiameter(encodedSize: number): number {
  const logarithmicWeight = encodedSize / 8192;
  return Math.min(0.052, 0.026 + logarithmicWeight * 0.0064);
}

function resizeRenderer(): void {
  const rect = canvasWrap.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile ? 1.5 : 2));
  renderer.setSize(width, height, false);
  webglCamera.aspect = width / height;
  webglCamera.updateProjectionMatrix();
  if (graphPoints) {
    graphPoints.material.uniforms.viewportHeight!.value = height * renderer.getPixelRatio();
  }
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
  if (weakLines) weakLines.visible = weakControl.checked;
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
