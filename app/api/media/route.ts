import { NextResponse } from "next/server";
import { deleteMedia, listMedia, type Provider } from "@/lib/storage";

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
    await deleteMedia(provider, key);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
