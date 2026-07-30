import type { BuildManifest, RandomDocument } from '../content/types';

interface RandomPack {
  buildId: string;
  offset: number;
  documents: RandomDocument[];
}

const manifest = readManifest();
const randomButton = requiredElement<HTMLButtonElement>('random-document');
const randomSection = requiredElement<HTMLElement>('home-random-list');
const randomList = requiredElement<HTMLUListElement>('home-random-titles');
const randomStatus = requiredElement<HTMLElement>('home-random-status');
const packCache = new Map<number, Promise<RandomPack>>();

if (manifest.counts.documents > 0 && manifest.randomPacks.length > 0) {
  randomButton.disabled = false;
  void renderRandomTitles();
}

randomButton.addEventListener('click', async () => {
  randomButton.disabled = true;
  try {
    const record = await randomRecord();
    window.location.assign(articlePath(record));
  } catch {
    randomStatus.textContent = '문서를 열지 못했습니다. 다시 시도해 주세요.';
    randomStatus.hidden = false;
    randomButton.disabled = false;
  }
});

window.addEventListener('pageshow', (event) => {
  if (event.persisted && manifest.counts.documents > 0) {
    randomButton.disabled = false;
    void renderRandomTitles();
  }
});

async function renderRandomTitles(): Promise<void> {
  randomSection.hidden = true;
  randomStatus.hidden = true;
  const targetCount = Math.min(5, manifest.counts.documents);
  const indices = uniqueRandomIndices(manifest.counts.documents, targetCount);
  try {
    const records = await Promise.all(indices.map((index) => recordAt(index)));
    randomList.replaceChildren(
      ...records.map((record) => {
        const item = document.createElement('li');
        const anchor = document.createElement('a');
        anchor.href = articlePath(record);
        anchor.textContent = record.title;
        item.append(anchor);
        return item;
      }),
    );
    randomSection.hidden = records.length === 0;
  } catch {
    randomStatus.textContent = '문서 목록을 불러오지 못했습니다.';
    randomStatus.hidden = false;
  }
}

async function randomRecord(): Promise<RandomDocument> {
  return recordAt(randomInteger(manifest.counts.documents));
}

async function recordAt(index: number): Promise<RandomDocument> {
  const packIndex = Math.floor(index / manifest.randomPackSize);
  const pack = await fetchPack(packIndex);
  const record = pack.documents[index - pack.offset];
  if (!record) throw new Error('Random record is missing');
  return record;
}

async function fetchPack(index: number): Promise<RandomPack> {
  const cached = packCache.get(index);
  if (cached) return cached;
  const path = manifest.randomPacks[index];
  if (!path) throw new Error('Random pack is missing');
  const request = fetch(path, { cache: 'force-cache' }).then(async (response) => {
    if (!response.ok) throw new Error('Random pack request failed');
    const pack = (await response.json()) as RandomPack;
    if (pack.buildId !== manifest.buildId) throw new Error('Random pack build mismatch');
    return pack;
  });
  packCache.set(index, request);
  try {
    return await request;
  } catch (cause) {
    packCache.delete(index);
    throw cause;
  }
}

function uniqueRandomIndices(total: number, count: number): number[] {
  const values = new Set<number>();
  while (values.size < count) values.add(randomInteger(total));
  return [...values];
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

function articlePath(record: RandomDocument): string {
  return `/wiki/${record.id}/${encodeURIComponent(record.slug)}`;
}

function readManifest(): BuildManifest {
  const element = document.getElementById('astronet-build');
  if (!element?.textContent) throw new Error('Build manifest is missing');
  return JSON.parse(element.textContent) as BuildManifest;
}

function requiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Required home element is missing: ${id}`);
  return element as T;
}
