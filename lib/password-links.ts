import { digest, random } from "./security";

export const PASSWORD_LINK_TTL = 3600000;
export async function newPasswordLink(db: D1Database, userId: string, username: string, origin: string) {
  const token = random(),
    expires_at = Date.now() + PASSWORD_LINK_TTL;
  return {
    result: { username, url: `${origin}/atur-password#token=${token}`, expires_at },
    statements: [
      db.prepare("UPDATE users SET password_hash=NULL,status=CASE WHEN status='pending' THEN 'pending' ELSE 'reset_required' END WHERE id=?").bind(userId),
      db.prepare("DELETE FROM sessions WHERE user_id=?").bind(userId),
      db
        .prepare(
          "INSERT INTO password_links(user_id,token_hash,expires_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET token_hash=excluded.token_hash,expires_at=excluded.expires_at"
        )
        .bind(userId, await digest(token), expires_at),
    ],
  };
}
