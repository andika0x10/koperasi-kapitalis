import vinext from "vinext/server/fetch-handler";
import { api } from "./lib/api";
import type { Env } from "./lib/env";
export { Commerce, RateLimiter } from "./lib/commerce";
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const isApi = new URL(request.url).pathname.startsWith("/api/");
    const response = isApi ? await api(request, env) : await vinext.fetch(request, env, ctx);
    const result = new Response(response.body, response);
    result.headers.set("X-Content-Type-Options", "nosniff");
    result.headers.set("X-Frame-Options", "DENY");
    result.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    result.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    result.headers.set(
      "Content-Security-Policy",
      `default-src 'self'; script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self'; connect-src 'self'${process.env.NODE_ENV === "development" ? " ws: wss:" : ""}; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'`
    );
    if (new URL(request.url).protocol === "https:") result.headers.set("Strict-Transport-Security", "max-age=31536000");
    if (isApi && !result.headers.has("cache-control")) result.headers.set("Cache-Control", "no-store");
    return result;
  },
};
