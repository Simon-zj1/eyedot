import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { INVITE_BONUS_CREDITS, SIGNUP_CREDIT_GRANT } from "@/lib/config";
import { setGenerationProviderOverride } from "@/lib/generator";
import { HeuristicGenerationProvider } from "@/lib/generator/heuristic";
import { InsufficientCreditsError, ValidationError } from "@/lib/errors";
import { generateOutlineForMaterial } from "@/lib/services/generation";
import {
  chargePlatformUsage,
  creditBalanceMilli,
  redeemCredits,
} from "@/lib/services/credits";
import { createMaterialForUser } from "@/lib/services/materials";
import { recordChatUsage } from "@/lib/services/usage";
import { SAMPLE_MATERIAL, grantCredits, loginWithInvite, resetOverrides, useMemoryStore } from "../helpers";

/**
 * 积分账本是这个产品唯一收钱的地方，所以它得比别处更经得起问：
 * 扣了多少、为什么扣、余额是多少，三者必须互相对得上。
 */
describe("积分账本", () => {
  let store: ReturnType<typeof useMemoryStore>;
  let user: Awaited<ReturnType<typeof loginWithInvite>>["user"];

  beforeEach(async () => {
    store = useMemoryStore();
    setGenerationProviderOverride(new HeuristicGenerationProvider(), { countsAgainstQuota: true });
    await store.upsertInviteCode("CREDIT-CODE", 10);
    user = (await loginWithInvite("credits@example.com")).user;
  });

  afterEach(() => resetOverrides());

  it("注册赠送 300 积分，带邀请码再加 100", async () => {
    expect(await creditBalanceMilli(user.id)).toBe(SIGNUP_CREDIT_GRANT * 1_000);
    const invited = (await loginWithInvite("vip@example.com", "CREDIT-CODE")).user;
    expect(await creditBalanceMilli(invited.id)).toBe(
      (SIGNUP_CREDIT_GRANT + INVITE_BONUS_CREDITS) * 1_000,
    );
  });

  it("平台调用按官方价 1.5 倍扣积分", async () => {
    const before = await creditBalanceMilli(user.id);
    // deepseek-flash 读 100 万 token = 官方 $0.3 → 平台 1500 积分
    const charged = await chargePlatformUsage(user.id, [
      { model: "deepseek-flash", inputTokens: 1_000_000, outputTokens: 0 },
    ]);
    expect(charged).toBe(1_500_000);
    expect(await creditBalanceMilli(user.id)).toBe(before - 1_500_000);
  });

  it("BYOK 的用量不扣积分", async () => {
    const before = await creditBalanceMilli(user.id);
    await recordChatUsage(
      user.id,
      [{ model: "deepseek-flash", inputTokens: 1_000_000, outputTokens: 0 }],
      "byok",
    );
    expect(await creditBalanceMilli(user.id)).toBe(before);
  });

  it("账本最后一条的余额等于当前余额（余额不是另一个字段，是账本的结论）", async () => {
    await chargePlatformUsage(user.id, [
      { model: "deepseek-flash", inputTokens: 100_000, outputTokens: 10_000 },
    ]);
    const ledger = await store.listCreditLedger(user.id, 10);
    expect(ledger[0].balanceAfterMilli).toBe(await creditBalanceMilli(user.id));
  });

  it("余额低于门槛时拒绝发起平台调用，并给出两条出口", async () => {
    // 把余额扣到 1 积分以下
    await chargePlatformUsage(user.id, [
      { model: "gpt-4o", inputTokens: 1_000_000, outputTokens: 0 },
    ]);
    expect(await creditBalanceMilli(user.id)).toBeLessThan(0);

    const material = await createMaterialForUser(user, {
      title: "测试材料",
      rawText: SAMPLE_MATERIAL,
    });
    await expect(generateOutlineForMaterial(user, material.id)).rejects.toBeInstanceOf(
      InsufficientCreditsError,
    );
  });

  it("手动补积分后又能继续用平台额度", async () => {
    await chargePlatformUsage(user.id, [
      { model: "gpt-4o", inputTokens: 1_000_000, outputTokens: 0 },
    ]);
    // 一次贵模型调用会把 300 积分烧穿到负数，补一点不够，得补过零
    expect(await creditBalanceMilli(user.id)).toBeLessThan(0);
    await grantCredits(user.id, 13_000);
    expect(await creditBalanceMilli(user.id)).toBeGreaterThan(0);
    const material = await createMaterialForUser(user, {
      title: "测试材料",
      rawText: SAMPLE_MATERIAL,
    });
    await expect(generateOutlineForMaterial(user, material.id)).resolves.toBeTruthy();
  });
});

describe("模型来源二选一", () => {
  let store: ReturnType<typeof useMemoryStore>;
  let user: Awaited<ReturnType<typeof loginWithInvite>>["user"];

  beforeEach(async () => {
    store = useMemoryStore();
    setGenerationProviderOverride(new HeuristicGenerationProvider(), { countsAgainstQuota: true });
    user = (await loginWithInvite("mode@example.com")).user;
  });

  afterEach(() => resetOverrides());

  it("选了自带 Key 却没配，就明确报错，而不是偷偷回落到平台额度扣积分", async () => {
    await store.setUserModelMode(user.id, "byok");
    const refreshed = (await store.getUser(user.id))!;
    const before = await creditBalanceMilli(user.id);

    await expect(
      generateOutlineForMaterial(refreshed, "material-x"),
    ).rejects.toBeInstanceOf(ValidationError);
    // 关键断言：失败不能花掉他的积分
    expect(await creditBalanceMilli(user.id)).toBe(before);
  });
});

describe("兑换码", () => {
  let store: ReturnType<typeof useMemoryStore>;
  let user: Awaited<ReturnType<typeof loginWithInvite>>["user"];

  beforeEach(async () => {
    store = useMemoryStore();
    user = (await loginWithInvite("redeem@example.com")).user;
  });

  afterEach(() => resetOverrides());

  it("兑换成功后余额增加，且名额被占用", async () => {
    await store.createRedemptionCodes([
      { code: "ED-TEST-0001", creditsMilli: 1_000_000, maxUses: 1, expiresAt: null, note: "测试" },
    ]);
    const before = await creditBalanceMilli(user.id);
    const result = await redeemCredits(user, "ed-test-0001");
    expect(result.amountMilli).toBe(1_000_000);
    expect(await creditBalanceMilli(user.id)).toBe(before + 1_000_000);
    expect((await store.getRedemptionCode("ED-TEST-0001"))?.usedCount).toBe(1);
  });

  it("同一张码不能兑两次", async () => {
    await store.createRedemptionCodes([
      { code: "ED-TEST-0002", creditsMilli: 500_000, maxUses: 1, expiresAt: null, note: null },
    ]);
    await redeemCredits(user, "ED-TEST-0002");
    await expect(redeemCredits(user, "ED-TEST-0002")).rejects.toThrow(/已用完/);
  });

  it("过期的码不能用，未知的码也不能用", async () => {
    await store.createRedemptionCodes([
      {
        code: "ED-OLD-0001",
        creditsMilli: 500_000,
        maxUses: 1,
        expiresAt: new Date(Date.now() - 1000),
        note: null,
      },
    ]);
    await expect(redeemCredits(user, "ED-OLD-0001")).rejects.toThrow(/过期/);
    await expect(redeemCredits(user, "ED-NOPE-0000")).rejects.toThrow(/不存在/);
  });
});
