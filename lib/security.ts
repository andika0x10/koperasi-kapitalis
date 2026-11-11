import { scrypt } from "node:crypto";
import { Buffer } from "node:buffer";
const bytesToHex = (value: Uint8Array) => Buffer.from(value).toString("hex");

export const random = () => bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
export async function digest(value: string) {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
}
export function same(a: string, b: string) {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}
// OWASP's scrypt N=2^14, r=8, p=5 profile uses 16 MiB per derivation.
export async function hashPassword(password: string, salt = random()) {
  const hash = await new Promise<Buffer>((resolve, reject) =>
    scrypt(password, Buffer.from(salt, "hex"), 32, { N: 16384, r: 8, p: 5, maxmem: 32 * 1024 * 1024 }, (error, key) => (error ? reject(error) : resolve(key)))
  );
  return `scrypt:16384:8:5:${salt}:${bytesToHex(hash)}`;
}
export async function verifyPassword(password: string, stored: string | null) {
  if (!stored?.startsWith("scrypt:16384:8:5:")) return false;
  return same(await hashPassword(password, stored.split(":")[4]), stored);
}
export function validPassword(value: unknown): asserts value is string {
  if (typeof value !== "string" || value.length < 12 || value.length > 128) throw new HttpError(400, "Password harus 12–128 karakter.");
}
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}
export function text(value: unknown, label: string, max = 200, min = 1) {
  if (typeof value !== "string" || value.trim().length < min || value.trim().length > max) throw new HttpError(400, `${label} harus ${min}–${max} karakter.`);
  return value.trim();
}
export function integer(value: unknown, label: string, min = 0, max = 100000000) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) throw new HttpError(400, `${label} tidak valid.`);
  return value;
}
export async function imageFile(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "Pilih gambar.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 1500000) {
      chunks.length = 0;
      continue;
    }
    chunks.push(value);
  }
  if (size > 1500000) throw new HttpError(413, "Gambar maksimal 1,5 MB.");
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  const mime = request.headers.get("content-type")?.split(";")[0];
  const png = size >= 24 && [137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => bytes[i] === n) && String.fromCharCode(...bytes.slice(12, 16)) === "IHDR";
  const jpg = size >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 && bytes[size - 2] === 255 && bytes[size - 1] === 217;
  const webp = size >= 20 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  if (!((mime === "image/png" && png) || (mime === "image/jpeg" && jpg) || (mime === "image/webp" && webp)))
    throw new HttpError(400, "Gunakan gambar JPEG, PNG, atau WebP yang valid.");
  return { bytes, mime: mime! };
}
