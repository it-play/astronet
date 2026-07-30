import type { BuildManifest, RandomDocument } from '../content/types';

interface RandomPack {
  buildId: string;
  offset: number;
  documents: RandomDocument[];
}

const manifest = readManifest();
const buttons = [...document.querySelectorAll<HTMLButtonElement>('[data-random-document]')];
const statuses = [...document.querySelectorAll<HTMLElement>('[data-random-status]')];
const packCache = new Map<number, Promise<RandomPack>>();
const PACK_CACHE_LIMIT = 16;
const hasDocuments = manifest.counts.documents > 0 && manifest.randomPackCount > 0;

if (hasDocuments) setButtonsDisabled(false);

for (const button of buttons) {
  button.addEventListener('click', async () => {
    setButtonsDisabled(true);
    setStatus('무작위 문서를 여는 중입니다.');
    try {
      const record = await randomRecord();
      window.location.assign(`/wiki/${record.id}/${encodeURIComponent(record.slug)}`);
    } catch {
      setStatus('문서를 열지 못했습니다. 다시 시도해 주세요.');
      setButtonsDisabled(false);
    }
  });
}

window.addEventListener('pageshow', (event) => {
  if (event.persisted && hasDocuments) {
    setButtonsDisabled(false);
    clearStatus();
  }
});

async function randomRecord(): Promise<RandomDocument> {
  const index = randomInteger(manifest.counts.documents);
  const packIndex = Math.floor(index / manifest.randomPackSize);
  const pack = await fetchPack(packIndex);
  const record = pack.documents[index - pack.offset];
  if (!record) throw new Error('Random record is missing');
  return record;
}

async function fetchPack(index: number): Promise<RandomPack> {
  const cached = packCache.get(index);
  if (cached) {
    packCache.delete(index);
    packCache.set(index, cached);
    return cached;
  }
  if (index < 0 || index >= manifest.randomPackCount) throw new Error('Random pack is missing');
  const path = `${manifest.basePath}/random/${index.toString(16).padStart(3, '0')}.json`;
  const request = fetch(path, { cache: 'force-cache' }).then(async (response) => {
    if (!response.ok) throw new Error('Random pack request failed');
    const pack = (await response.json()) as RandomPack;
    if (pack.buildId !== manifest.buildId) throw new Error('Random pack build mismatch');
    return pack;
  });
  packCache.set(index, request);
  while (packCache.size > PACK_CACHE_LIMIT) {
    const oldest = packCache.keys().next().value as number | undefined;
    if (oldest === undefined) break;
    packCache.delete(oldest);
  }
  try {
    return await request;
  } catch (cause) {
    packCache.delete(index);
    throw cause;
  }
}

function randomInteger(limit: number): number {
  if (limit <= 0) throw new Error('Random selection has no records');
  const range = 0x1_0000_0000;
  const ceiling = range - (range % limit);
  const value = new Uint32Array(1);
  do window.crypto.getRandomValues(value);
  while ((value[0] ?? range) >= ceiling);
  return (value[0] ?? 0) % limit;
}

function setButtonsDisabled(disabled: boolean): void {
  for (const button of buttons) button.disabled = disabled;
}

function setStatus(message: string): void {
  for (const status of statuses) {
    status.textContent = message;
    status.hidden = false;
  }
}

function clearStatus(): void {
  for (const status of statuses) {
    status.textContent = '';
    status.hidden = true;
  }
}

function readManifest(): BuildManifest {
  const element = document.getElementById('astronet-build');
  if (!element?.textContent) throw new Error('Build manifest is missing');
  return JSON.parse(element.textContent) as BuildManifest;
}
