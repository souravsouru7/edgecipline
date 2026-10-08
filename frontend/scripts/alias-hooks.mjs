// Resolve hook for the "@/" path alias, test-only.
//
// jsconfig/tsconfig map "@/*" to the frontend root and Next honours that, but
// plain `node --test` does not — so importing any module that uses "@/" fails
// with ERR_MODULE_NOT_FOUND. This teaches the Node ESM resolver the same mapping
// so tests can drive real application modules without those modules having to
// adopt relative imports just to be testable.
//
// Registered by scripts/register-aliases.mjs, which npm test passes to --import.

import { pathToFileURL } from "node:url";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const FRONTEND_ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), "..");

// Next resolves extensionless imports; Node does not. Try the same order.
const EXTENSIONS = ["", ".js", ".mjs", ".jsx", ".ts", ".tsx", "/index.js"];

export async function resolve(specifier, context, nextResolve) {
  if (!specifier.startsWith("@/")) return nextResolve(specifier, context);

  // Preserve any ?query a caller used for cache-busting.
  const [bare, query] = specifier.slice(2).split("?");
  const base = resolvePath(FRONTEND_ROOT, bare);

  for (const extension of EXTENSIONS) {
    const candidate = base + extension;
    if (existsSync(candidate)) {
      const url = pathToFileURL(candidate).href + (query ? `?${query}` : "");
      return { url, shortCircuit: true };
    }
  }

  return nextResolve(specifier, context);
}
