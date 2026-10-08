/**
 * 注册 `@/…` → 包内 `src/…` 的解析钩子。
 *
 * 为什么需要它：npm 装好的包位于 `node_modules/` 里，而 tsx（跟随 Node 的语义）
 * **不会对 node_modules 内的文件应用 tsconfig 的 `paths`**。于是——
 * 在仓库里跑得好好的 `npx tsx scripts/study.ts`，一旦装成全局包就报
 * `Cannot find package '@/lib'`。这个 bug 只有真的把包装出来才会暴露。
 *
 * 注意：用 `--import` 执行一个「导出 resolve 的模块」是不生效的，
 * 钩子必须由 `module.register()` 显式注册（真正的实现在 alias-hooks.mjs）。
 */
import { register } from "node:module";

register(new URL("./alias-hooks.mjs", import.meta.url));
