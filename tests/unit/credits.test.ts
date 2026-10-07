import { describe, expect, it } from "vitest";
import { CREDIT_USD_VALUE, PLATFORM_MARKUP } from "@/lib/config";
import { chargedMilliCredits, formatCredits, toMilliCredits } from "@/lib/credits";
import { estimateCostMicroUsd } from "@/lib/llm/usage";

/**
 * 定价的锚点必须能被心算，否则用户永远不知道自己的积分花在哪。
 * 这组用例把「1 积分 = 1000 token 等值」「平台价 = 官方价 × 1.5」钉住。
 */
describe("积分定价", () => {
  it("平台倍数是 1.5，积分锚点是 $0.0003", () => {
    expect(PLATFORM_MARKUP).toBe(1.5);
    expect(CREDIT_USD_VALUE).toBe(0.0003);
  });

  it("deepseek-flash 读 100 万 token：官方 $0.3，平台价 1500 积分", () => {
    const cost = estimateCostMicroUsd("deepseek-flash", 1_000_000, 0);
    expect(cost).toBe(300_000); // $0.3
    expect(chargedMilliCredits(cost)).toBe(1_500_000); // 1500 积分
  });

  it("输出比输入贵 4 倍（deepseek-flash $1.2/M vs $0.3/M）", () => {
    const input = chargedMilliCredits(estimateCostMicroUsd("deepseek-flash", 1_000_000, 0));
    const output = chargedMilliCredits(estimateCostMicroUsd("deepseek-flash", 0, 1_000_000));
    expect(output).toBe(input * 4);
  });

  it("再小的调用也会扣掉一点，不会出现「用了不扣钱」", () => {
    // 1 微美元的上游成本 ≈ 0.005 积分 = 5 毫积分
    expect(chargedMilliCredits(1)).toBe(5);
    expect(chargedMilliCredits(0)).toBe(0);
  });

  it("分档展示：整数不带小数点，小数保留 1 位", () => {
    expect(formatCredits(toMilliCredits(300))).toBe("300");
    expect(formatCredits(toMilliCredits(69.5))).toBe("69.5");
  });
});
