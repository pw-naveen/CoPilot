import { NextResponse, type NextRequest } from "next/server";
import { storage, verifyLocalSignature } from "@/server/storage";

const TYPES: Record<string, string> = {
  webm: "audio/webm", ogg: "audio/ogg", mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav",
  jpg: "image/jpeg", png: "image/png", webp: "image/webp", txt: "text/plain", pdf: "application/pdf",
};

/** Serves local-storage files behind an HMAC-signed, expiring URL (development driver only). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ key: string[] }> }) {
  const key = (await params).key.join("/");
  const q = req.nextUrl.searchParams;
  if (process.env.STORAGE_DRIVER === "s3" || !verifyLocalSignature(key, q.get("exp") ?? "", q.get("sig") ?? ""))
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const data = await storage().get(key);
    return new NextResponse(new Uint8Array(data), {
      headers: { "content-type": TYPES[key.split(".").pop()!] ?? "application/octet-stream", "cache-control": "private, max-age=3600" },
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
