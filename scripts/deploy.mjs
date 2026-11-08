import { spawnSync } from "node:child_process";
// Reuse Wrangler's authenticated session. Credentials stay in child-process memory.
const env = { ...process.env, CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID || "3733a7977c6783973d0ee237b086aa34" };
if (!env.CLOUDFLARE_API_TOKEN) {
  const auth = spawnSync(process.execPath, ["node_modules/wrangler/bin/wrangler.js", "auth", "token", "--json"], { encoding: "utf8", timeout: 30000 });
  if (auth.status !== 0) {
    console.error("Login Wrangler belum tersedia. Jalankan npx wrangler login.");
    process.exit(1);
  }
  try {
    const credentials = JSON.parse(auth.stdout);
    if (!credentials.token) throw new Error();
    env.CLOUDFLARE_API_TOKEN = credentials.token;
  } catch {
    console.error("Tidak dapat membaca token Wrangler. Token tidak dicetak.");
    process.exit(1);
  }
}
const prebuilt = process.argv.includes("--prebuilt");
const command = prebuilt ? ["node_modules/cf/bin/cf", "deploy", "--prebuilt"] : ["node_modules/@vinext/cloudflare/dist/cli.js", "deploy"];
const result = spawnSync(process.execPath, command, { env, stdio: "inherit" });
process.exit(result.status ?? 1);
