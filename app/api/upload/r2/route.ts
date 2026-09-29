import { NextResponse } from "next/server";
import {
  PART_SIZE,
  MEDIA_PREFIX,
  buildKey,
  r2AbortMultipart,
  r2CompleteMultipart,
  r2CreateMultipart,
  r2SignSingle,
  storageStatus,
} from "@/lib/storage";

type Body =
  | { action: "create"; filename: string; contentType: string; size: number; folder?: string }
  | { action: "complete"; key: string; uploadId: string; parts: { PartNumber: number; ETag: string }[] }
  | { action: "abort"; key: string; uploadId: string };

export async function POST(request: Request) {
  if (!storageStatus().r2) {
    return NextResponse.json({ error: "Cloudflare R2 is not configured" }, { status: 503 });
  }
  const body = (await request.json()) as Body;

  try {
    if (body.action === "create") {
      if (!body.contentType?.startsWith("video/") && !body.contentType?.startsWith("image/")) {
        return NextResponse.json({ error: "Only image and video files are allowed" }, { status: 400 });
      }
      const key = buildKey(body.filename, body.folder);
      if (body.size <= PART_SIZE) {
        return NextResponse.json({ mode: "single", key, url: await r2SignSingle(key, body.contentType) });
      }
      return NextResponse.json({ mode: "multipart", key, ...(await r2CreateMultipart(key, body.contentType, body.size)) });
    }

    if (!body.key?.startsWith(MEDIA_PREFIX)) {
      return NextResponse.json({ error: "Invalid key" }, { status: 400 });
    }
    if (body.action === "complete") {
      await r2CompleteMultipart(body.key, body.uploadId, body.parts);
      return NextResponse.json({ ok: true });
    }
    if (body.action === "abort") {
      await r2AbortMultipart(body.key, body.uploadId);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
