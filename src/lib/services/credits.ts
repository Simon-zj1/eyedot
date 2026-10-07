import {
  INVITE_BONUS_CREDITS,
  MIN_CREDITS_TO_START,
  SIGNUP_CREDIT_GRANT,
  type PlatformCallKind,
} from "@/lib/config";
import { chargedMilliCredits, formatCredits, toMilliCredits } from "@/lib/credits";
import { getStore } from "@/lib/db";
import type { CreditLedgerRecord, UserRecord } from "@/lib/db/types";
import { InsufficientCreditsError, ValidationError } from "@/lib/errors";
import { estimateCostMicroUsd, type ChatUsageEvent } from "@/lib/llm/usage";

/**
 * 积分：平台额度的计价与账本。
 *
 * 上游 Key 永远只在服务端，所以「隔离」只能落在这一层：用户拿到的是积分，
 * 拿不到 Key，也就没法绕开余额。余额由账本累加得出（见 credit_ledger 的注释）。
 */

export async function creditBalanceMilli(userId: string): Promise<number> {
  return getStore().getCreditBalance(userId);
}

/** 界面用的余额文案；余额为负（透支）时如实显示，不粉饰。 */
export function creditBalanceLabel(balanceMilli: number): string {
  return formatCredits(balanceMilli);
}

export async function creditLedger(userId: string, limit = 20): Promise<CreditLedgerRecord[]> {
  return getStore().listCreditLedger(userId, limit);
}

/**
 * 注册赠送：基础额度 + 邀请码加成（邀请码此时是「额度券」，不再是入场券）。
 *
 * 幂等：账本里已经有 grant 记录就直接返回。这样验码成功但发额度失败的用户，
 * 下次登录能自动补上；也顺手让开放注册前的老用户补到同一份体验额度。
 */
export async function grantSignupCredits(
  userId: string,
  options: { invited: boolean },
): Promise<CreditLedgerRecord[]> {
  const store = getStore();
  const existing = await store.listCreditLedger(userId, 50);
  if (existing.some((entry) => entry.kind === "grant")) return [];
  const entries = [
    await store.applyCreditDelta({
      userId,
      kind: "grant",
      amountMilli: toMilliCredits(SIGNUP_CREDIT_GRANT),
      ref: null,
      note: "注册赠送",
    }),
  ];
  if (options.invited) {
    entries.push(
      await store.applyCreditDelta({
        userId,
        kind: "bonus",
        amountMilli: toMilliCredits(INVITE_BONUS_CREDITS),
        ref: null,
        note: "邀请码加成",
      }),
    );
  }
  return entries;
}

/**
 * 调用前的最低余额检查。
 *
 * 用「门槛」而不是预扣：预扣要算准、要回滚、要处理超时，复杂度远大于收益；
 * 门槛把最坏情况限制在「一次操作透支一次」，和既有的消费上限是同一个取舍。
 */
export async function assertCreditsForStart(
  user: UserRecord,
  kind: PlatformCallKind,
): Promise<void> {
  const required = MIN_CREDITS_TO_START[kind];
  const balance = await creditBalanceMilli(user.id);
  if (balance < toMilliCredits(required)) {
    throw new InsufficientCreditsError(
      `平台额度不足：当前 ${creditBalanceLabel(balance)} 积分，这一步至少需要 ${required} 积分。` +
        `可以兑换积分，或在设置里改用你自己的模型 Key（用自己的 Key 不消耗积分）。`,
    );
  }
}

/**
 * 按本次请求的真实 token 用量扣积分。
 *
 * 上游成本用价格表估算（和 llm_usage 同一套），乘以平台倍数后换算成积分。
 * 估算而不是账单：token 数与价格都会变，所以这里的目标是「算得准到能防跑冒滴漏」，
 * 不是「和上游对账到分」。
 */
export async function chargePlatformUsage(
  userId: string,
  events: ChatUsageEvent[],
  ref: string | null = null,
): Promise<number> {
  if (events.length === 0) return 0;
  const costMicroUsd = events.reduce(
    (total, event) =>
      total + estimateCostMicroUsd(event.model, event.inputTokens, event.outputTokens),
    0,
  );
  const amountMilli = chargedMilliCredits(costMicroUsd);
  if (amountMilli <= 0) return 0;
  await getStore().applyCreditDelta({
    userId,
    kind: "spend",
    amountMilli: -amountMilli,
    ref,
    note: null,
  });
  return amountMilli;
}

/** 兑换码充值：先占用名额，再入账；占用失败一律不入账。 */
export async function redeemCredits(
  user: UserRecord,
  code: string,
): Promise<{ amountMilli: number; balanceMilli: number }> {
  const normalized = code.trim().toUpperCase();
  if (!normalized) throw new ValidationError("请输入兑换码");
  const store = getStore();
  const record = await store.getRedemptionCode(normalized);
  if (!record) throw new ValidationError("兑换码不存在");
  if (record.expiresAt && record.expiresAt.getTime() < Date.now()) {
    throw new ValidationError("兑换码已过期");
  }
  const consumed = await store.consumeRedemptionCode(normalized);
  if (!consumed) throw new ValidationError("兑换码已用完");

  const entry = await store.applyCreditDelta({
    userId: user.id,
    kind: "redeem",
    amountMilli: record.creditsMilli,
    ref: normalized,
    note: record.note,
  });
  return { amountMilli: entry.amountMilli, balanceMilli: entry.balanceAfterMilli };
}
