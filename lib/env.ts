export interface Env {
  DB: D1Database;
  COMMERCE: DurableObjectNamespace;
  LIMITER: DurableObjectNamespace;
}
export type Auth = { id: string; username: string; role: import("./types").Role; status: import("./types").AccountStatus; session_id: string; csrf: string };
