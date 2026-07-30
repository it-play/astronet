export const DOCUMENT_ID_PATTERN = /^[A-Za-z0-9_-]{21}[AQgw]$/;
export const SECTION_ID_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;
export const RESOURCE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{1,63}$/;
export const ARTICLE_BUCKET_COUNT = 8192;
export const SEARCH_RECORD_BUCKET_COUNT = 1024;

export function fnv1a(value: string): number {
  let hash = 0x811c9dc5;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return hash >>> 0;
}

export function articleBucket(id: string, bucketCount = ARTICLE_BUCKET_COUNT): string {
  const width = Math.max(2, Math.ceil(Math.log(bucketCount) / Math.log(16)));
  return (fnv1a(id) % bucketCount).toString(16).padStart(width, '0');
}

export function searchRecordBucket(id: string): string {
  return articleBucket(id, SEARCH_RECORD_BUCKET_COUNT);
}

export function normalizeText(value: string): string {
  return value.normalize('NFC').replace(/\s+/g, ' ').trim();
}

export function normalizeSearchText(value: string): string {
  return normalizeText(value).toLocaleLowerCase('ko-KR').replace(/\s+/g, '');
}

export function slugifyTitle(title: string): string {
  const slug = normalizeText(title)
    .toLocaleLowerCase('ko-KR')
    .replace(/[^0-9a-z가-힣ㄱ-ㅎㅏ-ㅣ]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');

  return slug || '문서';
}

export function articleUrl(id: string, title: string): string {
  return `/wiki/${id}/${encodeURIComponent(slugifyTitle(title))}`;
}

export function searchShardKey(term: string): string {
  return (fnv1a(term) % 256).toString(16).padStart(2, '0');
}

export function titleSearchShardKey(key: string): string {
  return (fnv1a(key) % 1024).toString(16).padStart(3, '0');
}
