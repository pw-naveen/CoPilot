import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, normalize } from "node:path";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { appBaseUrl } from "./config";
import { hmac, randomToken, safeEqual } from "./crypto";

/**
 * Object storage for voice notes, images and samples. Files are never public:
 * reads go through short-lived signed URLs. `local` is for development only.
 */
interface Storage {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  signedUrl(key: string, seconds?: number): Promise<string>;
}

const LOCAL_ROOT = join(process.cwd(), ".data/storage");

const local: Storage = {
  async put(key, data) {
    const p = safePath(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, data);
  },
  get: (key) => readFile(safePath(key)),
  async signedUrl(key, seconds = 3600) {
    const exp = Math.floor(Date.now() / 1000) + seconds;
    return `${appBaseUrl()}/api/files/${key}?exp=${exp}&sig=${hmac(`${key}:${exp}`)}`;
  },
};

function safePath(key: string) {
  const p = normalize(join(LOCAL_ROOT, key));
  if (!p.startsWith(LOCAL_ROOT)) throw new Error("bad storage key");
  return p;
}

export function verifyLocalSignature(key: string, exp: string, sig: string) {
  return Number(exp) > Date.now() / 1000 && safeEqual(sig, hmac(`${key}:${exp}`));
}

let s3client: S3Client | null = null;
const s3c = () =>
  (s3client ??= new S3Client({
    endpoint: process.env.S3_ENDPOINT || undefined,
    region: process.env.S3_REGION || "us-east-1",
    forcePathStyle: true,
    credentials: { accessKeyId: process.env.S3_ACCESS_KEY!, secretAccessKey: process.env.S3_SECRET_KEY! },
  }));
const bucket = () => process.env.S3_BUCKET!;

const s3: Storage = {
  async put(key, data, contentType) {
    await s3c().send(new PutObjectCommand({ Bucket: bucket(), Key: key, Body: data, ContentType: contentType }));
  },
  async get(key) {
    const res = await s3c().send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
    return Buffer.from(await res.Body!.transformToByteArray());
  },
  signedUrl: (key, seconds = 3600) => getSignedUrl(s3c(), new GetObjectCommand({ Bucket: bucket(), Key: key }), { expiresIn: seconds }),
};

export const storage = (): Storage => (process.env.STORAGE_DRIVER === "s3" ? s3 : local);

const EXT: Record<string, string> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/wav": "wav",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "text/plain": "txt",
  "application/pdf": "pdf",
};

export function newKey(userId: string, kind: "audio" | "image" | "doc", mime: string) {
  const ext = EXT[mime.split(";")[0]] ?? "bin";
  return `${userId}/${kind}/${Date.now()}-${randomToken(8)}.${ext}`;
}
