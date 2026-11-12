import type { PlaceResult } from "./types";
import { HttpError } from "./security";

export function parsePlaces(data: unknown): PlaceResult[] {
  if (!data || typeof data !== "object" || !("features" in data) || !Array.isArray(data.features))
    throw new HttpError(503, "Pencarian alamat belum tersedia. Coba lagi atau pilih pin secara manual.");
  return data.features.slice(0, 5).flatMap((feature: unknown) => {
    if (!feature || typeof feature !== "object") return [];
    const { geometry, properties } = feature as { geometry?: { type?: unknown; coordinates?: unknown }; properties?: Record<string, unknown> };
    if (geometry?.type !== "Point" || !Array.isArray(geometry.coordinates) || !properties) return [];
    const [longitude, latitude] = geometry.coordinates;
    if (
      typeof latitude !== "number" ||
      !Number.isFinite(latitude) ||
      Math.abs(latitude) > 90 ||
      typeof longitude !== "number" ||
      !Number.isFinite(longitude) ||
      Math.abs(longitude) > 180
    )
      return [];
    const part = (key: string) => (typeof properties[key] === "string" ? properties[key].slice(0, 200).trim() : "");
    const name = part("name") || part("street") || part("city") || part("district");
    if (!name) return [];
    const address = [
      ...new Set(
        [name, [part("street"), part("housenumber")].filter(Boolean).join(" "), part("district"), part("city"), part("state"), part("postcode"), part("country")].filter(Boolean)
      ),
    ].join(", ");
    return [{ name, address, latitude, longitude }];
  });
}

export async function findPlaces(query: string, endpoint: string, fetcher: typeof fetch = fetch): Promise<PlaceResult[]> {
  const url = new URL(endpoint);
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "5");
  try {
    const response = await fetcher(url, {
      headers: { "User-Agent": "KoperasiKapitalis/1.0 (address search)", Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
      redirect: "manual",
    });
    if (!response.ok || !response.body) throw new Error("Geocoder unavailable");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 131072) {
        await reader.cancel();
        throw new Error("Geocoder response too large");
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return parsePlaces(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    throw new HttpError(503, "Pencarian alamat belum tersedia. Coba lagi atau pilih pin secara manual.");
  }
}
