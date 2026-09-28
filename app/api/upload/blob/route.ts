import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { isAuthed } from "@/lib/auth";
import { MEDIA_PREFIX, storageStatus } from "@/lib/storage";

export async function POST(request: Request) {
  if (!storageStatus().blob) {
    return NextResponse.json({ error: "Vercel Blob is not configured" }, { status: 503 });
  }
  const body = (await request.json()) as HandleUploadBody;

  try {
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        // Token requests come from the browser and must carry a valid session.
        // The upload-completed callback is signed by Vercel and verified by handleUpload.
        if (!(await isAuthed(request))) throw new Error("Unauthorized");
        if (!pathname.startsWith(MEDIA_PREFIX)) throw new Error("Invalid path");
        return {
          allowedContentTypes: ["video/*"],
          maximumSizeInBytes: 5 * 1024 * 1024 * 1024, // 5 GB
          addRandomSuffix: true,
        };
      },
      onUploadCompleted: async () => {},
    });
    return NextResponse.json(result);
  } catch (e) {
    const message = (e as Error).message;
    return NextResponse.json({ error: message }, { status: message === "Unauthorized" ? 401 : 400 });
  }
}
