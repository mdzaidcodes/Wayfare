import { connection } from "next/server";
import { getEnv } from "@/server/env";
import { fetchPlacePhoto } from "@/server/providers/google";
import { limitPhotos } from "@/server/http/ratelimit";

/** Google place photos, proxied so the API key never reaches the browser. */
export async function GET(request: Request) {
  await connection();
  const limited = limitPhotos(request);
  if (limited) return limited;
  const url = new URL(request.url);
  const ref = url.searchParams.get("ref") ?? "";
  const w = Number(url.searchParams.get("w") ?? 800);
  const key = getEnv().GOOGLE_MAPS_API_KEY;
  if (!key) return new Response("Photo unavailable: GOOGLE_MAPS_API_KEY is not set.", { status: 503 });
  try {
    const upstream = await fetchPlacePhoto(key, ref, Number.isFinite(w) ? w : 800);
    const type = upstream.headers.get("content-type") ?? "image/jpeg";
    if (!type.startsWith("image/")) return new Response("Not an image", { status: 502 });
    return new Response(upstream.body, {
      headers: {
        "Content-Type": type,
        // Short private cache only; Google Places content isn't stored beyond what its terms allow.
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("Photo unavailable", { status: 502 });
  }
}
