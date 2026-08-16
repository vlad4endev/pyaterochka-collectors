import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { HttpError } from "./errors";
import { getBotToken, telegramApiFetch } from "./telegram";

const UPLOAD_PREFIX = "upload:";
const MAX_BYTES = 8 * 1024 * 1024;
const UPLOAD_DIR = join(process.cwd(), "data", "invoices");
const FILE_NAME_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp|heic|heif)$/i;

type StoredPhoto = {
  bytes: Buffer;
  contentType: string;
};

function sniffImage(bytes: Buffer): { ext: string; contentType: string } | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { ext: "jpg", contentType: "image/jpeg" };
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return { ext: "png", contentType: "image/png" };
  }
  if (
    bytes.length >= 12 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  ) {
    return { ext: "webp", contentType: "image/webp" };
  }
  const brand = bytes.length >= 12 ? bytes.toString("ascii", 4, 12) : "";
  if (brand.startsWith("ftyp")) {
    return { ext: "heic", contentType: "image/heic" };
  }
  return null;
}

function contentTypeForName(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".png")) {
    return "image/png";
  }
  if (lower.endsWith(".webp")) {
    return "image/webp";
  }
  if (lower.endsWith(".heic") || lower.endsWith(".heif")) {
    return "image/heic";
  }
  return "image/jpeg";
}

export function isUploadPhotoRef(ref: string): boolean {
  return ref.startsWith(UPLOAD_PREFIX);
}

export async function saveInvoicePhoto(file: { arrayBuffer: () => Promise<ArrayBuffer> }): Promise<string> {
  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.length === 0) {
    throw new HttpError("Add kilograms or a photo");
  }
  if (bytes.length > MAX_BYTES) {
    throw new HttpError("Photo is too large");
  }
  const kind = sniffImage(bytes);
  if (!kind) {
    throw new HttpError("Unsupported photo type");
  }
  await mkdir(UPLOAD_DIR, { recursive: true });
  const name = `${randomUUID()}.${kind.ext}`;
  await writeFile(join(UPLOAD_DIR, name), bytes);
  return `${UPLOAD_PREFIX}${name}`;
}

async function readLocalInvoice(ref: string): Promise<StoredPhoto> {
  const name = ref.slice(UPLOAD_PREFIX.length);
  if (!FILE_NAME_RE.test(name)) {
    throw new HttpError("Photo not found", 404);
  }
  try {
    const bytes = await readFile(join(UPLOAD_DIR, name));
    return { bytes, contentType: contentTypeForName(name) };
  } catch {
    throw new HttpError("Photo not found", 404);
  }
}

async function fetchTelegramPhoto(fileId: string): Promise<StoredPhoto> {
  const token = await getBotToken();
  const metaResponse = await telegramApiFetch(
    `https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`,
  );
  const meta: unknown = await metaResponse.json().catch(() => null);
  if (
    typeof meta !== "object" ||
    meta === null ||
    !("ok" in meta) ||
    meta.ok !== true ||
    !("result" in meta) ||
    typeof meta.result !== "object" ||
    meta.result === null ||
    !("file_path" in meta.result) ||
    typeof meta.result.file_path !== "string"
  ) {
    throw new HttpError("Photo not found", 404);
  }
  const filePath = meta.result.file_path;
  const bin = await telegramApiFetch(`https://api.telegram.org/file/bot${token}/${filePath}`);
  if (!bin.ok) {
    throw new HttpError("Photo not found", 404);
  }
  const bytes = Buffer.from(await bin.arrayBuffer());
  const lower = filePath.toLowerCase();
  const contentType = lower.endsWith(".png")
    ? "image/png"
    : lower.endsWith(".webp")
      ? "image/webp"
      : "image/jpeg";
  return { bytes, contentType };
}

export async function loadInvoicePhoto(ref: string): Promise<StoredPhoto> {
  if (isUploadPhotoRef(ref)) {
    return await readLocalInvoice(ref);
  }
  return await fetchTelegramPhoto(ref);
}
