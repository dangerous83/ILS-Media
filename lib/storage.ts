import "server-only";
import {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  CopyObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { list as blobList, del as blobDel, createFolder as blobCreateFolder, rename as blobRename } from "@vercel/blob";

export type Provider = "r2" | "blob";
export type MediaType = "video" | "image";

export type MediaItem = {
  id: string;
  provider: Provider;
  key: string;
  name: string;
  folder: string;
  mediaType: MediaType;
  size: number;
  uploadedAt: string;
  url: string;
  downloadUrl: string;
};

export const MEDIA_PREFIX = "videos/";
export const PART_SIZE = 64 * 1024 * 1024; // 64 MB multipart chunks
const SIGNED_URL_TTL = 60 * 60 * 6; // 6 hours

export function storageStatus() {
  const r2 = Boolean(
    process.env.R2_ACCOUNT_ID &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY &&
      process.env.R2_BUCKET,
  );
  const blob = Boolean(process.env.BLOB_READ_WRITE_TOKEN);
  const preferred = (process.env.DEFAULT_STORAGE as Provider) || "r2";
  const fallback: Provider | null = r2 ? "r2" : blob ? "blob" : null;
  const defaultProvider = ({ r2, blob } as Record<Provider, boolean>)[preferred] ? preferred : fallback;
  return { r2, blob, defaultProvider, bucket: process.env.R2_BUCKET ?? null };
}

/** Builds a storage key: videos/<timestamp>-<slug>.<ext> */
export function sanitizeFolderName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 60)
    .toLowerCase();
}

export function buildKey(filename: string, folder = ""): string {
  const dot = filename.lastIndexOf(".");
  const ext = dot > 0 ? filename.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, "") : "mp4";
  const base = (dot > 0 ? filename.slice(0, dot) : filename)
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .slice(0, 80) || "video";
  const safeFolder = sanitizeFolderName(folder);
  return `${MEDIA_PREFIX}${safeFolder ? `${safeFolder}/` : ""}${Date.now()}-${base}.${ext}`;
}

export function folderFromKey(key: string): string {
  const relative = key.startsWith(MEDIA_PREFIX) ? key.slice(MEDIA_PREFIX.length) : key;
  const slash = relative.lastIndexOf("/");
  return slash > 0 ? relative.slice(0, slash) : "";
}

export function mediaTypeFromKey(key: string): MediaType {
  return /\.(?:jpe?g|png|gif|webp|avif|heic|heif|svg)$/i.test(key) ? "image" : "video";
}

/** Human-readable name back from a storage key. */
export function nameFromKey(key: string): string {
  const file = key.slice(key.lastIndexOf("/") + 1);
  return file
    .replace(/^\d{13}-/, "")
    .replace(/-[A-Za-z0-9]{21,}(?=\.[^.]+$)/, "") // Vercel Blob random suffix
    .replace(/-/g, " ");
}

// ── Cloudflare R2 ─────────────────────────────────────────

let r2Client: S3Client | null = null;
function r2(): S3Client {
  if (!r2Client) {
    r2Client = new S3Client({
      region: "auto",
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      },
      // R2 + browser presigned PUTs don't play well with the SDK's default checksums.
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
  }
  return r2Client;
}
const bucket = () => process.env.R2_BUCKET!;

async function r2ViewUrl(key: string, download = false): Promise<string> {
  const publicBase = process.env.R2_PUBLIC_URL?.replace(/\/$/, "");
  if (publicBase && !download) return `${publicBase}/${key.split("/").map(encodeURIComponent).join("/")}`;
  const file = key.slice(key.lastIndexOf("/") + 1);
  return getSignedUrl(
    r2(),
    new GetObjectCommand({
      Bucket: bucket(),
      Key: key,
      ...(download && { ResponseContentDisposition: `attachment; filename="${file}"` }),
    }),
    { expiresIn: SIGNED_URL_TTL },
  );
}

async function listR2(): Promise<MediaItem[]> {
  const items: MediaItem[] = [];
  let token: string | undefined;
  do {
    const res = await r2().send(
      new ListObjectsV2Command({ Bucket: bucket(), Prefix: MEDIA_PREFIX, ContinuationToken: token }),
    );
    for (const obj of res.Contents ?? []) {
      if (!obj.Key || obj.Key.endsWith("/") || obj.Key.endsWith("/.folder")) continue;
      items.push({
        id: `r2:${obj.Key}`,
        provider: "r2",
        key: obj.Key,
        name: nameFromKey(obj.Key),
        folder: folderFromKey(obj.Key),
        mediaType: mediaTypeFromKey(obj.Key),
        size: obj.Size ?? 0,
        uploadedAt: (obj.LastModified ?? new Date()).toISOString(),
        url: await r2ViewUrl(obj.Key),
        downloadUrl: await r2ViewUrl(obj.Key, true),
      });
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return items;
}

export async function r2SignSingle(key: string, contentType: string) {
  return getSignedUrl(r2(), new PutObjectCommand({ Bucket: bucket(), Key: key, ContentType: contentType }), {
    expiresIn: SIGNED_URL_TTL,
  });
}

export async function r2CreateMultipart(key: string, contentType: string, size: number) {
  const { UploadId } = await r2().send(
    new CreateMultipartUploadCommand({ Bucket: bucket(), Key: key, ContentType: contentType }),
  );
  if (!UploadId) throw new Error("R2 did not return an upload id");
  const partCount = Math.ceil(size / PART_SIZE);
  const urls = await Promise.all(
    Array.from({ length: partCount }, (_, i) =>
      getSignedUrl(
        r2(),
        new UploadPartCommand({ Bucket: bucket(), Key: key, UploadId, PartNumber: i + 1 }),
        { expiresIn: SIGNED_URL_TTL },
      ),
    ),
  );
  return { uploadId: UploadId, partSize: PART_SIZE, urls };
}

export async function r2CompleteMultipart(
  key: string,
  uploadId: string,
  parts: { PartNumber: number; ETag: string }[],
) {
  await r2().send(
    new CompleteMultipartUploadCommand({
      Bucket: bucket(),
      Key: key,
      UploadId: uploadId,
      MultipartUpload: { Parts: [...parts].sort((a, b) => a.PartNumber - b.PartNumber) },
    }),
  );
}

export async function r2AbortMultipart(key: string, uploadId: string) {
  await r2().send(new AbortMultipartUploadCommand({ Bucket: bucket(), Key: key, UploadId: uploadId }));
}

// ── Vercel Blob ───────────────────────────────────────────

async function listBlob(): Promise<MediaItem[]> {
  const items: MediaItem[] = [];
  let cursor: string | undefined;
  do {
    const res = await blobList({ prefix: MEDIA_PREFIX, cursor, limit: 1000 });
    for (const b of res.blobs) {
      if (b.pathname.endsWith("/") || b.pathname.endsWith("/.folder")) continue;
      items.push({
        id: `blob:${b.url}`,
        provider: "blob",
        key: b.pathname,
        name: nameFromKey(b.pathname),
        folder: folderFromKey(b.pathname),
        mediaType: mediaTypeFromKey(b.pathname),
        size: b.size,
        uploadedAt: new Date(b.uploadedAt).toISOString(),
        url: b.url,
        downloadUrl: b.downloadUrl,
      });
    }
    cursor = res.hasMore ? res.cursor : undefined;
  } while (cursor);
  return items;
}

// ── Unified API ───────────────────────────────────────────

export async function listMedia(): Promise<{ items: MediaItem[]; folders: string[]; errors: string[] }> {
  const status = storageStatus();
  const errors: string[] = [];
  const results = await Promise.all([
    status.r2 ? listR2().catch((e) => (errors.push(`Cloudflare R2: ${e.message}`), [])) : [],
    status.blob ? listBlob().catch((e) => (errors.push(`Vercel Blob: ${e.message}`), [])) : [],
  ]);
  const items = results.flat().sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
  const folders = [...new Set(items.map((item) => item.folder).filter(Boolean))].sort();

  if (status.r2) {
    try {
      const markers = await r2().send(new ListObjectsV2Command({ Bucket: bucket(), Prefix: MEDIA_PREFIX }));
      for (const obj of markers.Contents ?? []) {
        if (obj.Key?.endsWith("/.folder")) folders.push(folderFromKey(obj.Key));
      }
    } catch {
      // The media listing already reports provider errors; folder markers are optional metadata.
    }
  }
  if (status.blob) {
    try {
      const folded = await blobList({ prefix: MEDIA_PREFIX, mode: "folded", limit: 1000 });
      for (const folder of folded.folders) {
        const name = folder.replace(new RegExp(`^${MEDIA_PREFIX}`), "").replace(/\/$/, "");
        if (name) folders.push(name);
      }
    } catch {
      // Keep listing usable if folder metadata cannot be loaded.
    }
  }

  return { items, folders: [...new Set(folders)].sort(), errors };
}

export async function createMediaFolder(provider: Provider, name: string) {
  const folder = sanitizeFolderName(name);
  if (!folder) throw new Error("Enter a valid folder name");
  const prefix = `${MEDIA_PREFIX}${folder}/`;
  if (provider === "r2") {
    await r2().send(new PutObjectCommand({ Bucket: bucket(), Key: `${prefix}.folder`, Body: "" }));
  } else {
    await blobCreateFolder(prefix, { access: "public" });
  }
  return folder;
}

export async function moveMedia(provider: Provider, key: string, folder: string) {
  if (!key.startsWith(MEDIA_PREFIX)) throw new Error("Invalid key");
  const safeFolder = sanitizeFolderName(folder);
  const filename = key.slice(key.lastIndexOf("/") + 1);
  const target = `${MEDIA_PREFIX}${safeFolder ? `${safeFolder}/` : ""}${filename}`;
  if (target === key) return;

  if (provider === "r2") {
    await r2().send(new CopyObjectCommand({ Bucket: bucket(), CopySource: `${bucket()}/${key}`, Key: target }));
    await r2().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
  } else {
    await blobRename(key, target, { access: "public", addRandomSuffix: false });
  }
}

async function renameR2Folder(from: string, to: string) {
  const sourcePrefix = `${MEDIA_PREFIX}${from}/`;
  const targetPrefix = `${MEDIA_PREFIX}${to}/`;
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const res = await r2().send(new ListObjectsV2Command({ Bucket: bucket(), Prefix: sourcePrefix, ContinuationToken: token }));
    keys.push(...(res.Contents ?? []).flatMap((obj) => obj.Key ? [obj.Key] : []));
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  for (const key of keys) {
    const target = `${targetPrefix}${key.slice(sourcePrefix.length)}`;
    await r2().send(new CopyObjectCommand({ Bucket: bucket(), CopySource: `${bucket()}/${key}`, Key: target }));
    await r2().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
  }
}

async function renameBlobFolder(from: string, to: string) {
  const sourcePrefix = `${MEDIA_PREFIX}${from}/`;
  const targetPrefix = `${MEDIA_PREFIX}${to}/`;
  const pathnames: string[] = [];
  let cursor: string | undefined;
  do {
    const res = await blobList({ prefix: sourcePrefix, cursor, limit: 1000 });
    pathnames.push(...res.blobs.map((blob) => blob.pathname));
    cursor = res.hasMore ? res.cursor : undefined;
  } while (cursor);
  for (const pathname of pathnames) {
    const target = `${targetPrefix}${pathname.slice(sourcePrefix.length)}`;
    await blobRename(pathname, target, { access: "public", addRandomSuffix: false });
  }
}

async function deleteR2Folder(folder: string) {
  const sourcePrefix = `${MEDIA_PREFIX}${folder}/`;
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const res = await r2().send(new ListObjectsV2Command({ Bucket: bucket(), Prefix: sourcePrefix, ContinuationToken: token }));
    keys.push(...(res.Contents ?? []).flatMap((obj) => obj.Key ? [obj.Key] : []));
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  for (const key of keys) {
    if (!key.endsWith("/.folder")) {
      const target = `${MEDIA_PREFIX}${key.slice(sourcePrefix.length)}`;
      await r2().send(new CopyObjectCommand({ Bucket: bucket(), CopySource: `${bucket()}/${key}`, Key: target }));
    }
    await r2().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
  }
}

async function deleteBlobFolder(folder: string) {
  const sourcePrefix = `${MEDIA_PREFIX}${folder}/`;
  const pathnames: string[] = [];
  let cursor: string | undefined;
  do {
    const res = await blobList({ prefix: sourcePrefix, cursor, limit: 1000 });
    pathnames.push(...res.blobs.map((blob) => blob.pathname));
    cursor = res.hasMore ? res.cursor : undefined;
  } while (cursor);
  for (const pathname of pathnames) {
    if (pathname.endsWith("/.folder") || pathname.endsWith("/")) {
      await blobDel(pathname);
    } else {
      const target = `${MEDIA_PREFIX}${pathname.slice(sourcePrefix.length)}`;
      await blobRename(pathname, target, { access: "public", addRandomSuffix: false });
    }
  }
}

export async function renameMediaFolder(fromName: string, toName: string) {
  const from = sanitizeFolderName(fromName);
  const to = sanitizeFolderName(toName);
  if (!from || !to) throw new Error("Enter a valid folder name");
  if (from === to) return to;

  const status = storageStatus();
  await Promise.all([
    status.r2 ? renameR2Folder(from, to) : Promise.resolve(),
    status.blob ? renameBlobFolder(from, to) : Promise.resolve(),
  ]);
  return to;
}

export async function deleteMediaFolder(folderName: string) {
  const folder = sanitizeFolderName(folderName);
  if (!folder) throw new Error("Choose a valid folder");

  const status = storageStatus();
  await Promise.all([
    status.r2 ? deleteR2Folder(folder) : Promise.resolve(),
    status.blob ? deleteBlobFolder(folder) : Promise.resolve(),
  ]);
  return folder;
}

export async function deleteMedia(provider: Provider, key: string) {
  if (provider === "r2") {
    if (!key.startsWith(MEDIA_PREFIX)) throw new Error("Invalid key");
    await r2().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
  } else {
    await blobDel(key);
  }
}
