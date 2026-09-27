#!/usr/bin/env node
/**
 * 生产健康检查：确认线上不是掉进离线演示模式，数据层是 Postgres。
 *
 * 用法：
 *   node scripts/check-production.mjs https://exam.simon-zj.top
 *
 * 退出码：0 表示健康；1 表示请求失败或线上处于演示/内存存储状态。
 * 不做用户数据访问，也不打印密钥。
 */

const url = (process.argv[2] ?? "https://exam.simon-zj.top").replace(/\/$/, "");

try {
  const response = await fetch(`${url}/api/health`, { cache: "no-store" });
  if (!response.ok) {
    console.error(`health 返回 ${response.status}`);
    process.exit(1);
  }
  const body = await response.json();
  console.log(JSON.stringify(body, null, 2));

  const problems = [];
  if (body.store !== "postgres") problems.push(`store=${body.store}，应为 postgres`);
  if (body.engines?.demoMode) problems.push("当前处于离线演示模式（未配置出题或判定 Key）");
  if (problems.length > 0) {
    for (const problem of problems) console.error(`不健康：${problem}`);
    process.exit(1);
  }
  console.log("健康：数据层 Postgres，判定/出题引擎非演示模式。");
} catch (error) {
  console.error("健康检查失败：", error instanceof Error ? error.message : error);
  process.exit(1);
}
