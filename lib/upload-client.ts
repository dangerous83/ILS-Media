"use client";

import { upload as blobUpload } from "@vercel/blob/client";

export type Provider = "r2" | "blob";
type Progress = (loaded: number, total: number) => void;

const PART_CONCURRENCY = 4;

function contentTypeFor(file: File) {
  if (file.type) return file.type;
  return /\.(?:jpe?g|png|gif|webp|avif|heic|heif|svg)$/i.test(file.name) ? "image/jpeg" : "video/mp4";
}

function put(url: string, body: Blob, onProgress: (loaded: number) => void, signal: AbortSignal, contentType?: string) {
  return new Promise<string>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    if (contentType) xhr.setRequestHeader("Content-Type", contentType);
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve(xhr.getResponseHeader("ETag") ?? "")
        : reject(new Error(`Upload failed (${xhr.status})`));
    xhr.onerror = () => reject(new Error("Network error — check the R2 bucket CORS policy"));
    xhr.onabort = () => reject(new DOMException("Upload cancelled", "AbortError"));
    signal.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(body);
  });
}

async function api(body: unknown) {
  const res = await fetch("/api/upload/r2", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Upload request failed");
  return data;
}

async function uploadToR2(file: File, folder: string, onProgress: Progress, signal: AbortSignal) {
  const contentType = contentTypeFor(file);
  const init = await api({ action: "create", filename: file.name, contentType, size: file.size, folder });

  if (init.mode === "single") {
    await put(init.url, file, (l) => onProgress(l, file.size), signal, contentType);
    return;
  }

  const { key, uploadId, partSize, urls } = init as { key: string; uploadId: string; partSize: number; urls: string[] };
  const loaded = new Array<number>(urls.length).fill(0);
  const parts: { PartNumber: number; ETag: string }[] = [];
  let next = 0;

  const worker = async () => {
    while (next < urls.length) {
      const i = next++;
      const chunk = file.slice(i * partSize, Math.min((i + 1) * partSize, file.size));
      const etag = await put(urls[i], chunk, (l) => {
        loaded[i] = l;
        onProgress(loaded.reduce((a, b) => a + b, 0), file.size);
      }, signal);
      if (!etag) throw new Error("R2 CORS must expose the ETag header");
      parts.push({ PartNumber: i + 1, ETag: etag });
    }
  };

  try {
    await Promise.all(Array.from({ length: Math.min(PART_CONCURRENCY, urls.length) }, worker));
    await api({ action: "complete", key, uploadId, parts });
  } catch (e) {
    api({ action: "abort", key, uploadId }).catch(() => {});
    throw e;
  }
}

async function uploadToBlob(file: File, folder: string, onProgress: Progress, signal: AbortSignal) {
  const slug = file.name.normalize("NFKD").replace(/[^\w.\s-]/g, "").trim().replace(/[\s_]+/g, "-") || "asset";
  const path = folder ? `videos/${folder}/${Date.now()}-${slug}` : `videos/${Date.now()}-${slug}`;
  await blobUpload(path, file, {
    access: "public",
    handleUploadUrl: "/api/upload/blob",
    contentType: contentTypeFor(file),
    multipart: file.size > 50 * 1024 * 1024,
    abortSignal: signal,
    onUploadProgress: ({ loaded, total }) => onProgress(loaded, total),
  });
}

export function uploadFile(provider: Provider, file: File, folder: string, onProgress: Progress, signal: AbortSignal) {
  return provider === "r2" ? uploadToR2(file, folder, onProgress, signal) : uploadToBlob(file, folder, onProgress, signal);
}
