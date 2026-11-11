import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { digest } from "../lib/security";

test("owner CLI setup and recovery use expiring links and isolated local storage", { timeout: 120000 }, async () => {
  mkdirSync(".test-artifacts", { recursive: true });
  const dir = mkdtempSync(resolve(".test-artifacts/owner-cli-")),
    state = join(dir, "state");
  const run = (args: string[]) => spawnSync(process.execPath, args, { encoding: "utf8", timeout: 45000, env: { ...process.env, WRANGLER_SEND_METRICS: "false" } });
  const wrangler = ["node_modules/wrangler/bin/wrangler.js", "d1"];
  const storage = ["DB", "--config", "wrangler.db.jsonc", "--local", "--persist-to", state];
  const migration = run([...wrangler, "migrations", "apply", ...storage]);
  assert.equal(migration.status, 0, migration.stderr);
  const cli = ["--import", "tsx", "scripts/owner.ts", "--username", "setup_owner", "--origin", "http://localhost:5173", "--persist-to", state];
  const output = join(dir, "activation.txt"),
    recovery = join(dir, "recovery.txt");
  const setup = run([...cli, "--output", output]);
  assert.equal(setup.status, 0, setup.stderr);
  const contents = readFileSync(output, "utf8");
  const token = new URLSearchParams(new URL(contents.match(/Link: (.+)/)![1].trim()).hash.slice(1)).get("token")!;
  assert.match(token, /^[a-f0-9]{64}$/);
  assert.ok(!setup.stdout.includes(token));
  assert.ok(!contents.includes("Password sementara"));
  function query(sql: string) {
    const result = run([...wrangler, "execute", ...storage, "--command", sql, "--json"]);
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout).flatMap((r: { results: unknown[] }) => r.results);
  }
  const [owner] = query("SELECT u.id,u.status,u.password_hash,p.token_hash,p.expires_at FROM users u JOIN password_links p ON p.user_id=u.id WHERE u.role='owner'");
  assert.equal(owner.status, "pending");
  assert.equal(owner.password_hash, null);
  assert.equal(owner.token_hash, await digest(token));
  assert.ok(owner.expires_at > Date.now() + 3500000);
  assert.notEqual(run([...cli, "--output", output]).status, 0, "Existing output must not be overwritten");
  assert.notEqual(run([...cli, "--output", join(dir, "duplicate.txt")]).status, 0, "Only one owner may be created");
  query(
    "UPDATE users SET status='active',password_hash='local-test-only' WHERE role='owner'; INSERT INTO sessions(id,user_id,token_hash,csrf,device,created_at,last_seen,expires_at) SELECT 'cli-session',id,'test-session-hash','csrf','test',1,1,9999999999999 FROM users WHERE role='owner';"
  );
  const reset = run([...cli, "--recover", "--output", recovery]);
  assert.equal(reset.status, 0, reset.stderr);
  const next = new URLSearchParams(
    new URL(
      readFileSync(recovery, "utf8")
        .match(/Link: (.+)/)![1]
        .trim()
    ).hash.slice(1)
  ).get("token")!;
  assert.notEqual(next, token);
  assert.ok(!reset.stdout.includes(next));
  const [recovered] = query(
    "SELECT status,password_hash,(SELECT COUNT(*) FROM sessions) sessions,(SELECT token_hash FROM password_links) token_hash,(SELECT COUNT(*) FROM users WHERE role='owner') owners FROM users WHERE role='owner'"
  );
  assert.equal(recovered.status, "reset_required");
  assert.equal(recovered.password_hash, null);
  assert.equal(recovered.sessions, 0);
  assert.equal(recovered.owners, 1);
  assert.equal(recovered.token_hash, await digest(next));
  const audit = JSON.stringify(query("SELECT * FROM audit_log"));
  assert.ok(!audit.includes(token));
  assert.ok(!audit.includes(next));
  assert.ok(audit.includes("owner_bootstrap"));
  assert.ok(audit.includes("owner_recovered"));
});
