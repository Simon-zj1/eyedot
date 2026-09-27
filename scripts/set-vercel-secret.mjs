#!/usr/bin/env node
/**
 * 把一个密钥写入 Vercel 环境变量，但不把密钥打印到终端、也不进聊天记录。
 *
 * 默认读取顺序：
 * 1. process.env.TYPESAFE_API_KEY
 * 2. .env.local 里的 TYPESAFE_API_KEY
 * 3. ~/.config/jev-exam/typesafe-api-key
 *
 * 用法：
 *   npm run set:jev-key                 # production
 *   npm run set:jev-key -- preview     # preview
 */

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

function fromEnvFile() {
  try {
    const content = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
    for (const line of content.split(/\r?\n/)) {
      const match = /^\s*TYPESAFE_API_KEY\s*=\s*(.*)\s*$/.exec(line);
      if (match) return match[1].replace(/^["']|["']$/g, "").trim();
    }
  } catch {
    // 文件不存在或不可读时继续尝试下一个来源
  }
  return null;
}

function fromKeyFile() {
  try {
    return readFileSync(resolve(homedir(), ".config/jev-exam/typesafe-api-key"), "utf8").trim();
  } catch {
    return null;
  }
}

const key = process.env.TYPESAFE_API_KEY?.trim() || fromKeyFile() || fromEnvFile();
if (!key) {
  console.error(
    [
      "没有找到 TYPESAFE_API_KEY。",
      "",
      "请选择一种隐式提供方式：",
      "1. 写入 ~/.config/jev-exam/typesafe-api-key（推荐）",
      "2. 写入 .env.local：TYPESAFE_API_KEY=...",
      "3. 在当前 shell 设置 TYPESAFE_API_KEY 后运行本脚本",
      "",
      "本脚本不会打印密钥原文。",
    ].join("\n"),
  );
  process.exit(1);
}

const environment = process.argv[2] ?? "production";
if (!["production", "preview", "development"].includes(environment)) {
  console.error("环境只能是 production / preview / development。");
  process.exit(1);
}

const child = spawn(
  "vercel",
  ["env", "add", "TYPESAFE_API_KEY", environment, "--force", "--sensitive", "--yes"],
  { cwd: process.cwd(), stdio: ["pipe", "inherit", "inherit"] },
);
child.stdin.end(`${key}\n`);
child.on("exit", (code) => {
  if (code !== 0) {
    console.error(`Vercel 写入失败，退出码 ${code ?? "unknown"}`);
    process.exit(code ?? 1);
  }
  console.log(`TYPESAFE_API_KEY 已写入 Vercel ${environment} 环境。`);
  console.log("接着运行 `vercel --prod --yes` 让新环境变量生效。");
});
