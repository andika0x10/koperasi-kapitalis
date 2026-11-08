import { bindings, defineConfig, defineWorker, exports } from "cf/config";

export default defineConfig({
  worker: defineWorker({
    name: "koperasi-kapitalis",
    entrypoint: "./worker.ts",
    compatibilityDate: "2026-11-08",
    compatibilityFlags: ["nodejs_compat"],
    workersDev: true,
    observability: { enabled: true, redactQueryString: true, logs: { enabled: true, invocationLogs: true } },
    exports: {
      Commerce: exports.durableObject({ storage: "sqlite" }),
      RateLimiter: exports.durableObject({ storage: "sqlite" }),
    },
    assets: {
      htmlHandling: "none",
      notFoundHandling: "none",
      runWorkerFirst: ["/*", "!/_next/static/*", "!/*/_next/static/*"],
    },
    env: {
      ASSETS: bindings.assets(),
      DB: bindings.d1({ name: "koperasi-kapitalis-db", id: "55b5e3ad-1dfc-42cb-bffd-7e07fa0375cd" }),
      COMMERCE: bindings.durableObject({ worker: "koperasi-kapitalis", exportName: "Commerce" }),
      LIMITER: bindings.durableObject({ worker: "koperasi-kapitalis", exportName: "RateLimiter" }),
    },
  }),
});
