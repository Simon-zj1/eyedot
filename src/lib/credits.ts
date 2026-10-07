import { CREDIT_USD_VALUE, PLATFORM_MARKUP } from "@/lib/config";
import type { CreditLedgerKind } from "@/lib/db/types";

/**
 * 积分的记账与换算。
 *
 * 账本里存的是「毫积分」（1 积分 = 1000 毫积分）的整数：
 * 一次语义等价判定可能只花 0.05 积分，用整数积分记账会被四舍五入成 0；
 * 用毫积分既有足够分辨率，又不需要浮点累加。
 */

/** 1 积分 = 1000 毫积分。 */
export const MILLI_PER_CREDIT = 1_000;

/** 把上游成本（微美元）换成要扣的毫积分，含平台倍数。 */
export function chargedMilliCredits(costMicroUsd: number): number {
  if (costMicroUsd <= 0) return 0;
  const usd = (costMicroUsd / 1_000_000) * PLATFORM_MARKUP;
  const credits = usd / CREDIT_USD_VALUE;
  return Math.max(1, Math.round(credits * MILLI_PER_CREDIT));
}

/** 毫积分 → 积分（保留 1 位小数的字符串）。 */
export function formatCredits(milliCredits: number): string {
  const credits = milliCredits / MILLI_PER_CREDIT;
  if (Number.isInteger(credits)) return String(credits);
  return credits.toFixed(1);
}

/** 积分 → 毫积分，用于把界面输入换算成记账单位。 */
export function toMilliCredits(credits: number): number {
  return Math.round(credits * MILLI_PER_CREDIT);
}

/** 账本类型的中文名，设置页直接展示。 */
export const LEDGER_KIND_LABEL: Record<CreditLedgerKind, string> = {
  grant: "注册赠送",
  bonus: "邀请码加成",
  redeem: "兑换充值",
  spend: "平台调用",
  adjust: "人工调整",
};
