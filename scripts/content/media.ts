import { copyFile, mkdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { imageSize } from 'image-size';
import { RESOURCE_ID_PATTERN } from '../../src/content/shared';
import { fail } from './diagnostics';

export type MediaKind = 'image' | 'video' | 'track';

export interface MediaAsset {
  id: string;
  sourcePath: string;
  extension: string;
  kind: MediaKind;
  bytes: number;
  width?: number;
  height?: number;
  publicPath: string;
}

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.svg']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm']);
const TRACK_EXTENSIONS = new Set(['.vtt']);
const IMAGE_LIMIT = 15 * 1024 * 1024;
const SVG_LIMIT = 2 * 1024 * 1024;
const VIDEO_LIMIT = 100 * 1024 * 1024;
const TRACK_LIMIT = 1024 * 1024;

export async function inspectMedia(
  files: string[],
  buildId: string,
): Promise<Map<string, MediaAsset>> {
  const assets = new Map<string, MediaAsset>();

  for (const sourcePath of files) {
    const extension = path.extname(sourcePath).toLowerCase();
    const id = path.basename(sourcePath, extension);
    if (!RESOURCE_ID_PATTERN.test(id)) {
      fail('Media file name must be a valid resource identifier', { source: sourcePath, target: id });
    }
    if (assets.has(id)) {
      fail('Media resource identifier is duplicated', { source: sourcePath, target: id });
    }

    const kind = mediaKind(extension, sourcePath);
    const fileStat = await stat(sourcePath);
    const limit = kind === 'video' ? VIDEO_LIMIT : kind === 'track' ? TRACK_LIMIT : extension === '.svg' ? SVG_LIMIT : IMAGE_LIMIT;
    if (fileStat.size > limit) {
      fail(`Media asset exceeds the ${limit} byte limit`, { source: sourcePath, target: id });
    }

    const buffer = await readFile(sourcePath);
    let width: number | undefined;
    let height: number | undefined;

    if (kind === 'image') {
      if (extension === '.svg') validateSvg(buffer.toString('utf8'), sourcePath);
      let dimensions: ReturnType<typeof imageSize>;
      try {
        dimensions = imageSize(buffer);
      } catch {
        fail('Image dimensions could not be read', { source: sourcePath, target: id });
      }
      width = dimensions.width;
      height = dimensions.height;
      if (!width || !height || width > 12_000 || height > 12_000 || width * height > 64_000_000) {
        fail('Image dimensions are missing or exceed the 12000px or 64-megapixel limit', {
          source: sourcePath,
          target: id,
        });
      }
      validateImageFormat(dimensions.type, extension, sourcePath);
    }

    if (kind === 'video') validateVideo(buffer, extension, sourcePath);

    if (kind === 'track') validateVtt(buffer.toString('utf8'), sourcePath);

    assets.set(id, {
      id,
      sourcePath,
      extension,
      kind,
      bytes: fileStat.size,
      width,
      height,
      publicPath: `/generated/${buildId}/media/${id}${extension}`,
    });
  }

  return assets;
}

export async function copyReferencedMedia(
  assets: Map<string, MediaAsset>,
  referencedIds: Set<string>,
  outputDirectory: string,
): Promise<void> {
  if (referencedIds.size === 0) return;
  await mkdir(outputDirectory, { recursive: true });

  for (const id of [...referencedIds].sort()) {
    const asset = assets.get(id);
    if (!asset) fail('Referenced media resource does not exist', { source: 'content', target: id });
    await copyFile(asset.sourcePath, path.join(outputDirectory, `${asset.id}${asset.extension}`));
  }
}

export function requireMedia(
  assets: Map<string, MediaAsset>,
  id: string,
  expected: MediaKind,
  source: string,
): MediaAsset {
  const asset = assets.get(id);
  if (!asset) fail('Referenced media resource does not exist', { source, target: id });
  if (asset.kind !== expected) {
    fail(`Media resource must be a ${expected}`, { source, target: id });
  }
  return asset;
}

function mediaKind(extension: string, source: string): MediaKind {
  if (IMAGE_EXTENSIONS.has(extension)) return 'image';
  if (VIDEO_EXTENSIONS.has(extension)) return 'video';
  if (TRACK_EXTENSIONS.has(extension)) return 'track';
  fail('Media file format is not allowed', { source, target: extension });
}

function validateImageFormat(detected: string | undefined, extension: string, sourcePath: string): void {
  const expected = extension === '.jpg' || extension === '.jpeg' ? 'jpg' : extension.slice(1);
  const normalized = detected === 'jpeg' ? 'jpg' : detected;
  if (normalized !== expected) {
    fail('Image file signature does not match its approved extension', { source: sourcePath, target: extension });
  }
}

function validateSvg(source: string, sourcePath: string): void {
  const forbidden = [
    /<!doctype/i,
    /<!entity/i,
    /<script\b/i,
    /<style\b/i,
    /<foreignObject\b/i,
    /\son[a-z]+\s*=/i,
    /\sstyle\s*=/i,
    /(?:href|xlink:href)\s*=\s*["']\s*(?!#)[^"']+/i,
    /url\s*\(\s*["']?\s*(?:https?:|\/\/|data:)/i,
  ];
  if (forbidden.some((pattern) => pattern.test(source))) {
    fail('SVG contains an unsafe or external construct', { source: sourcePath });
  }
  if (!/<svg\b/i.test(source)) {
    fail('SVG root element is missing', { source: sourcePath });
  }
}

function validateVtt(source: string, sourcePath: string): void {
  if (!source.replace(/^\uFEFF/, '').startsWith('WEBVTT')) {
    fail('Caption track must begin with WEBVTT', { source: sourcePath });
  }
  if (/<script\b|<style\b|<iframe\b/i.test(source)) {
    fail('Caption track contains unsafe markup', { source: sourcePath });
  }
}

function validateVideo(buffer: Buffer, extension: string, sourcePath: string): void {
  const isMp4 = extension === '.mp4' && buffer.length >= 12 && buffer.subarray(4, 8).toString('ascii') === 'ftyp';
  const isWebm =
    extension === '.webm' &&
    buffer.length >= 4 &&
    buffer[0] === 0x1a &&
    buffer[1] === 0x45 &&
    buffer[2] === 0xdf &&
    buffer[3] === 0xa3;
  if (!isMp4 && !isWebm) {
    fail('Video file signature does not match its approved format', { source: sourcePath });
  }
}
