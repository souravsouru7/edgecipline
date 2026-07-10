import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const frontendRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const androidRoot = path.join(frontendRoot, "android");
const wrapper = process.platform === "win32" ? "gradlew.bat" : "./gradlew";

const result = spawnSync(wrapper, ["bundleRelease"], {
  cwd: androidRoot,
  stdio: "inherit",
  shell: false,
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
