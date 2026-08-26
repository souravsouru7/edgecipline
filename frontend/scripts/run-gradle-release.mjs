import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const frontendRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const androidRoot = path.join(frontendRoot, "android");
const gradleWrapper = path.join(
  androidRoot,
  process.platform === "win32" ? "gradlew.bat" : "gradlew"
);
const command = process.platform === "win32" ? "cmd.exe" : gradleWrapper;
const args = process.platform === "win32"
  ? ["/c", gradleWrapper, "bundleRelease"]
  : ["bundleRelease"];

const result = spawnSync(command, args, {
  cwd: androidRoot,
  stdio: "inherit",
  shell: false,
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
