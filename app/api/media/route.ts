import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { createMediaFolder, deleteMediaFolder, listMedia, moveMedia, renameMediaFolder, restoreMedia, trashMedia, type Provider } from "@/lib/storage";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await listMedia());
}

export async function DELETE(request: Request) {
  const { provider, key } = (await request.json()) as { provider: Provider; key: string };
  if ((provider !== "r2" && provider !== "blob") || !key) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  try {
    await trashMedia(provider, key);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const body = (await request.json()) as
    | { action: "createFolder"; provider: Provider; name: string }
    | { action: "move"; provider: Provider; key: string; folder: string }
    | { action: "renameFolder"; provider: Provider; from: string; to: string }
    | { action: "deleteFolder"; provider: Provider; folder: string; password: string }
    | { action: "restore"; provider: Provider; key: string };

  if (body.provider !== "r2" && body.provider !== "blob") {
    return NextResponse.json({ error: "Invalid storage provider" }, { status: 400 });
  }

  try {
    if (body.action === "createFolder") {
      const folder = await createMediaFolder(body.provider, body.name);
      return NextResponse.json({ ok: true, folder });
    }
    if (body.action === "move") {
      await moveMedia(body.provider, body.key, body.folder);
      return NextResponse.json({ ok: true });
    }
    if (body.action === "renameFolder") {
      const folder = await renameMediaFolder(body.from, body.to);
      return NextResponse.json({ ok: true, folder });
    }
    if (body.action === "deleteFolder") {
      const expected = process.env.FOLDER_DELETE_PASSWORD;
      const supplied = body.password ?? "";
      const valid = Boolean(
        expected &&
        expected.length === supplied.length &&
        timingSafeEqual(Buffer.from(expected), Buffer.from(supplied)),
      );
      if (!valid) {
        return NextResponse.json({ error: "Incorrect password. Contact admin." }, { status: 403 });
      }
      const folder = await deleteMediaFolder(body.folder);
      return NextResponse.json({ ok: true, folder });
    }
    if (body.action === "restore") {
      await restoreMedia(body.provider, body.key);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
