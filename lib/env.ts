export interface Env {
  DB: D1Database;
  COMMERCE: DurableObjectNamespace;
  LIMITER: DurableObjectNamespace;
}
export type Auth = { id: string; username: string; role: "seller" | "buyer"; must_change_password: number; session_id: string; csrf: string };
