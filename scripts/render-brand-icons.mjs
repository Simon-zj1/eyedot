#!/usr/bin/env node
/**
 * 把 docs/brand/icon.svg 渲染成各尺寸 PNG。
 *
 * 为什么不用 sips：sips 读不了 SVG（文档里曾写过这个做法，其实跑不通）。
 * 这里只借系统里已有的 Chrome 无头模式渲染，不引入任何运行时依赖；
 * 找不到 Chrome 直接报错退出，而不是留下过期的 PNG 让人以为已经更新过。
 *
 *   node scripts/render-brand-icons.mjs
 *   node scripts/render-brand-icons.mjs --also ~/blog/source/img/jev-exam/icon-180.png
 *
 * 改图标时三处必须同步：docs/brand/icon.svg、src/app/icon.svg、src/components/brand-mark.tsx。
 * 本脚本只负责把 docs/brand/icon.svg 导出成位图，不检查那三处是否一致。
 */
import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SVG_PATH = join(ROOT, "docs/brand/icon.svg");

const CHROME_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
];

/** 仓库内固定导出尺寸：512 用于文档，180 是 iOS 主屏，32 是标签页兜底。 */
const EXPORTS = [
  { size: 512, out: "docs/brand/icon-512.png" },
  { size: 180, out: "docs/brand/icon-180.png" },
  { size: 32, out: "docs/brand/icon-32.png" },
  { size: 180, out: "src/app/apple-icon.png" },
];

function findChrome() {
  const found = CHROME_CANDIDATES.find((path) => existsSync(path));
  if (!found) {
    throw new Error(
      `找不到 Chrome / Chromium。请安装其中之一，或手动导出：${CHROME_CANDIDATES[0]}`,
    );
  }
  return found;
}

function expandHome(path) {
  return path.startsWith("~") ? join(homedir(), path.slice(1)) : path;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function render(chrome, svg, size, outPath) {
  const workDir = mkdtempSync(join(tmpdir(), "eyedot-icon-"));
  const htmlPath = join(workDir, `icon-${size}.html`);
  // 渲染到本次独有的临时文件，再复制到目标位置：
  // 这样既不用先删除已有产物，也不会把上一次的旧 PNG 误当成本次结果。
  const shotPath = join(workDir, "shot.png");
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
html,body{margin:0;padding:0;background:transparent}
body>svg{display:block;width:${size}px;height:${size}px}
</style></head><body>
${svg}
</body></html>`;
  writeFileSync(htmlPath, html, "utf8");

  const child = spawn(
    chrome,
    [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "--no-sandbox",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--disable-background-networking",
      "--force-device-scale-factor=1",
      `--user-data-dir=${join(workDir, "profile")}`,
      "--default-background-color=00000000",
      `--window-size=${size},${size}`,
      `--screenshot=${shotPath}`,
      `file://${htmlPath}`,
    ],
    // Chrome 会往 stderr 大量写日志，吞掉；否则管道写满会把子进程卡死。
    { stdio: "ignore", detached: true },
  );

  const deadline = Date.now() + 60_000;
  let settled = false;
  while (Date.now() < deadline) {
    if (existsSync(shotPath)) {
      // 等到文件大小不再变化，避免复制到写了一半的 PNG。
      const first = statSync(shotPath).size;
      await sleep(300);
      if (statSync(shotPath).size === first) {
        settled = true;
        break;
      }
    }
    await sleep(150);
  }

  // Chrome 在新 headless 模式下偶尔写完截图也不退出（试过：会一直挂着），
  // 所以拿到产物后主动结束整个进程组。
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    child.kill("SIGKILL");
  }
  await sleep(200);

  if (!settled) throw new Error(`渲染超时或失败，没有生成 ${outPath}`);
  copyFileSync(shotPath, outPath);
  return statSync(outPath).size;
}

async function main() {
  const args = process.argv.slice(2);
  const also = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--also") {
      const value = args[i + 1];
      if (!value) throw new Error("--also 后面要跟一个目标路径");
      also.push(expandHome(value));
      i += 1;
    } else if (args[i].startsWith("--")) {
      throw new Error(`未知参数：${args[i]}`);
    } else {
      also.push(expandHome(args[i]));
    }
  }

  const chrome = findChrome();
  const svg = readFileSync(SVG_PATH, "utf8");

  for (const { size, out } of EXPORTS) {
    const outPath = join(ROOT, out);
    const bytes = await render(chrome, svg, size, outPath);
    console.log(`✓ ${out}  ${size}×${size}  ${bytes} bytes`);
  }

  // 站点是另一个仓库，PNG 只能复制过去，不能从那边重新生成。
  for (const target of also) {
    copyFileSync(join(ROOT, "docs/brand/icon-180.png"), target);
    console.log(`✓ ${target}  已从 icon-180.png 复制`);
  }
}

await main();
