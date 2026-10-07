#!/usr/bin/env tsx
/**
 * 生成兑换码（人工发码用）。
 *
 *   npm run credits:issue -- --credits 300 --count 20 --note "首批体验码"
 *
 * 为什么是「人工发码」而不是在线支付：接支付要企业主体、商户资质与对账，
 * 而这一步要验证的只是「有没有人愿意付钱、付多少」。转账 → 发码 → 用户兑换，
 * 把支付通道和产品验证解耦，码还能顺手当风控（每张码有面额、有效期与使用次数）。
 *
 * 码只在这里打印一次：数据库里存的是明文（发码要靠它），所以打印完请自己留好，
 * 不要在聊天记录、工单或公开仓库里留档。
 */
import { getStore, storeDriver } from "@/lib/db";
import { randomBytes } from "node:crypto";

/** 去掉容易看错的 0/O/1/I/L，避免用户输错码来问你。 */
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

function randomCode(prefix: string): string {
  const bytes = randomBytes(8);
  const chars = [...bytes].map((byte) => ALPHABET[byte % ALPHABET.length]);
  return `${prefix}-${chars.slice(0, 4).join("")}-${chars.slice(4, 8).join("")}`;
}

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main(): Promise<void> {
  const credits = Number(arg("credits") ?? 300);
  const count = Number(arg("count") ?? 1);
  const maxUses = Number(arg("max-uses") ?? 1);
  const note = arg("note") ?? null;
  const prefix = (arg("prefix") ?? "ED").toUpperCase();
  const days = arg("days") ? Number(arg("days")) : null;

  if (!Number.isFinite(credits) || credits <= 0) throw new Error("--credits 要是正数");
  if (!Number.isFinite(count) || count <= 0 || count > 500) {
    throw new Error("--count 要在 1..500 之间");
  }

  const expiresAt = days ? new Date(Date.now() + days * 24 * 60 * 60 * 1000) : null;
  const store = getStore();
  const inputs = Array.from({ length: count }, () => ({
    code: randomCode(prefix),
    creditsMilli: Math.round(credits * 1_000),
    maxUses,
    expiresAt,
    note,
  }));

  const created = await store.createRedemptionCodes(inputs);
  console.log(`存储：${storeDriver()}`);
  console.log(`面额：${credits} 积分/张${maxUses > 1 ? `，每张可用 ${maxUses} 次` : ""}`);
  if (expiresAt) console.log(`有效期至：${expiresAt.toISOString().slice(0, 10)}`);
  console.log("");
  for (const record of created) console.log(record.code);
  console.log("");
  console.log(`共 ${created.length} 张。这些码只打印这一次，请自行留档。`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
