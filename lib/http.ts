import { HttpError } from "./security";
export const json = (data: unknown, status = 200, headers?: HeadersInit) => Response.json(data, { status, headers });
export async function body(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new HttpError(415, "Gunakan data JSON.");
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "Data tidak valid.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 16000) {
      reader.releaseLock();
      throw new HttpError(413, "Data terlalu besar.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  const raw = new TextDecoder().decode(bytes);
  try {
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error();
    return data;
  } catch {
    throw new HttpError(400, "Data tidak valid.");
  }
}
export function failure(error: unknown) {
  if (error instanceof HttpError) return json({ error: error.message }, error.status);
  const message = error instanceof Error ? error.message : "";
  if (message.includes("INSUFFICIENT_STOCK")) return json({ error: "Stok berubah. Periksa keranjang lalu coba lagi." }, 409);
  if (message.includes("UNIQUE constraint failed: users.username")) return json({ error: "Username sudah digunakan." }, 409);
  console.error("Request failed", { type: error instanceof Error ? error.name : "unknown" });
  return json({ error: "Permintaan belum berhasil. Silakan coba lagi." }, 500);
}
