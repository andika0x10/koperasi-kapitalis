import { api } from "../lib/api";
import type { Env } from "../lib/env";
import { Commerce as BaseCommerce } from "../lib/commerce";
export { RateLimiter } from "../lib/commerce";
// Only the isolated test Worker exposes a way to invoke the real alarm handler.
export class Commerce extends BaseCommerce {
  async fetch(request: Request) {
    if (new URL(request.url).pathname === "/__test/alarm") {
      await this.alarm();
      return Response.json({ ok: true, scheduledAt: await this.ctx.storage.getAlarm() });
    }
    return super.fetch(request);
  }
}
export default {
  fetch(request: Request, env: Env) {
    return api(request, env);
  },
};
