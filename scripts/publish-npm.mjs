#!/usr/bin/env node
/**
 * 发布到 npm。
 *
 *   npm run publish:npm            # 从 ~/.config/eyedot/npm-token 读 token
 *   NPM_TOKEN=npm_xxx npm run publish:npm
 *
 * 为什么不用 `npm login`：登录会在 `~/.npmrc` 里留一份长期有效的 token，
 * 而这个仓库已经在 `~/.config/eyedot/` 下放了 deepseek / resend 两把密钥——
 * 发布 token 放同一处，权限 600，谁在用、用在哪一目了然。
 *
 * token 也不走命令行参数（`--//registry...:_authToken=`）：那样会出现在 `ps` 里。
 * 这里写一份临时 userconfig，发布完立刻删掉。
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const TOKEN_PATH = join(homedir(), ".config/eyedot/npm-token");

function readToken() {
  const fromEnv = process.env.NPM_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  if (existsSync(TOKEN_PATH)) return readFileSync(TOKEN_PATH, "utf8").trim();
  return null;
}

const token = readToken();
if (!token) {
  console.error(
    [
      "没有找到 npm 发布 token。",
      "",
      "任选一种：",
      `1. 在 https://www.npmjs.com/settings/~/tokens 建一个 granular token（Packages: Read and write），`,
      `   保存到 ${TOKEN_PATH}（权限 600），然后重跑本命令；`,
      "2. 直接给环境变量：NPM_TOKEN=npm_xxx npm run publish:npm",
      "",
      "本脚本不会打印 token 原文。",
    ].join("\n"),
  );
  process.exit(1);
}

const workDir = mkdtempSync(join(tmpdir(), "eyedot-publish-"));
const npmrcPath = join(workDir, ".npmrc");
writeFileSync(npmrcPath, `//registry.npmjs.org/:_authToken=${token}\n`, { mode: 0o600 });

try {
  execFileSync("npm", ["publish", "--access", "public", "--userconfig", npmrcPath], {
    stdio: "inherit",
  });
} finally {
  rmSync(workDir, { recursive: true, force: true });
}
