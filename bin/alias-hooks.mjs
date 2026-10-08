import { existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** 这个文件在 bin/ 里，上一级就是包根 */
const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SRC_ROOT = join(PACKAGE_ROOT, "src");

const SUFFIXES = [".ts", ".tsx", "/index.ts", "/index.tsx"];

function fileOrNull(path) {
  if (!existsSync(path)) return null;
  return statSync(path).isFile() ? path : null;
}

/** 别名 `@/x` 指向的文件（支持省略扩展名与目录 index），找不到返回 null。 */
export function resolveAliasFile(specifier, srcRoot = SRC_ROOT) {
  if (!specifier.startsWith("@/")) return null;
  const base = join(srcRoot, specifier.slice(2));
  const direct = fileOrNull(base);
  if (direct) return direct;
  for (const suffix of SUFFIXES) {
    const hit = fileOrNull(base + suffix);
    if (hit) return hit;
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  const target = resolveAliasFile(specifier);
  if (target) return nextResolve(pathToFileURL(target).href, context);
  return nextResolve(specifier, context);
}
