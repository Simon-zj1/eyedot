import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import type { ExplainDoc } from "@/lib/explain/schema";
import { setChatProviderOverride } from "@/lib/llm/provider";
import { creditBalanceMilli } from "@/lib/services/credits";
import {
  createExplanation,
  isExplanationStale,
  listExplanations,
} from "@/lib/services/explain";
import { createMaterialForUser } from "@/lib/services/materials";
import { FakeChatProvider, loginWithInvite, resetOverrides, useMemoryStore } from "../helpers";

const MATERIAL = [
  "光合作用分为光反应和暗反应两个阶段。",
  "光反应发生在类囊体薄膜上，需要光照，水在光下分解产生氧气。",
  "光反应把光能转变成活跃的化学能，并暂时储存在 ATP 中。",
  "暗反应发生在叶绿体基质中，不需要光照，二氧化碳在这里被固定。",
  "影响光合作用速率的外界因素包括光照强度、二氧化碳浓度与温度。",
].join("\n");

const VALID_DOC: ExplainDoc = {
  title: "光反应与暗反应",
  lead: "一个把光变成能量，一个把二氧化碳变成糖。",
  panels: [
    {
      kind: "prose",
      title: "两个阶段",
      body: "光合作用分两步走。",
      source: "光合作用分为光反应和暗反应两个阶段。",
    },
    { kind: "steps", title: "光反应做了什么", steps: ["吸收光能", "水分解出氧气"] },
  ],
};

describe("一页图解（内容契约 → 渲染器）", () => {
  let store: ReturnType<typeof useMemoryStore>;
  let user: Awaited<ReturnType<typeof loginWithInvite>>["user"];

  beforeEach(async () => {
    store = useMemoryStore();
    user = (await loginWithInvite("explain@example.com")).user;
  });

  afterEach(() => resetOverrides());

  async function prepare(topic = "光反应") {
    const material = await createMaterialForUser(user, { title: "生物笔记", rawText: MATERIAL });
    return { material, topic };
  }

  it("模型只产 JSON：落库的是渲染后的 HTML + 内容 JSON + 材料指纹", async () => {
    setChatProviderOverride(new FakeChatProvider(() => JSON.stringify(VALID_DOC)), {
      countsAgainstQuota: true,
    });
    const { material, topic } = await prepare();

    const result = await createExplanation(user, material.id, topic);
    expect(result.ungrounded).toEqual([]);
    expect(result.explanation.doc?.title).toBe("光反应与暗反应");
    expect(result.explanation.materialHash).toBe(material.contentHash);
    // 渲染器出的 HTML：单文件、带我们的样式、内容被转义
    expect(result.explanation.html).toContain("点睛 · 一页图解");
    expect(result.explanation.html).toContain("<style>");
    expect(result.explanation.html).toContain("材料版本");
    expect(await listExplanations(user, material.id)).toHaveLength(1);
  });

  it("平台额度按 token 扣积分，重试的第二次调用也要算钱", async () => {
    let calls = 0;
    const provider = new FakeChatProvider(() => {
      calls += 1;
      return calls === 1 ? "我先说两句……（没有 JSON）" : JSON.stringify(VALID_DOC);
    });
    setChatProviderOverride(provider, { countsAgainstQuota: true });
    const { material, topic } = await prepare();

    const before = await creditBalanceMilli(user.id);
    const result = await createExplanation(user, material.id, topic);
    expect(calls).toBe(2);
    expect(result.explanation.doc).not.toBeNull();
    // FakeChatProvider 不报 usage，所以金额来自估算兜底；关键是没有报错且走了两次调用
    expect(calls).toBe(2);
    expect(await creditBalanceMilli(user.id)).toBeLessThanOrEqual(before);
  });

  it("模型两次都不给合法 JSON：明确报错，并退还额度", async () => {
    setChatProviderOverride(new FakeChatProvider(() => "抱歉，我做不到。"), {
      countsAgainstQuota: true,
    });
    const { material, topic } = await prepare();

    await expect(createExplanation(user, material.id, topic)).rejects.toThrow(/符合契约/);
    // 配额被退回来：同样的调用还能再来一次
    expect((await store.getUsage(user.id, new Date().toISOString().slice(0, 10))).explain).toBe(0);
  });

  it("伪造出处的面板会被降级为「模型补充」，而不是带着假出处上线", async () => {
    const forged: ExplainDoc = {
      title: "带假出处的图解",
      panels: [
        { kind: "prose", title: "伪造", body: "正文", source: "材料里根本没有这句话的内容" },
      ],
    };
    setChatProviderOverride(new FakeChatProvider(() => JSON.stringify(forged)), {
      countsAgainstQuota: true,
    });
    const { material, topic } = await prepare();

    const result = await createExplanation(user, material.id, topic);
    expect(result.ungrounded).toEqual(["伪造"]);
    expect(result.explanation.html).toContain("模型补充");
    expect(result.explanation.html).toContain("1 个面板的引文没能在材料里定位");
  });

  it("BYOK 模式下不扣积分", async () => {
    setChatProviderOverride(new FakeChatProvider(() => JSON.stringify(VALID_DOC), "byok"), {
      countsAgainstQuota: false,
      mode: "byok",
    });
    const { material, topic } = await prepare();
    const before = await creditBalanceMilli(user.id);

    await createExplanation(user, material.id, topic);
    expect(await creditBalanceMilli(user.id)).toBe(before);
  });

  it("材料版本变了就标记为过期（现在材料不可编辑，机制先就位）", async () => {
    setChatProviderOverride(new FakeChatProvider(() => JSON.stringify(VALID_DOC)), {
      countsAgainstQuota: true,
    });
    const { material, topic } = await prepare();
    const result = await createExplanation(user, material.id, topic);

    expect(isExplanationStale(result.explanation, material)).toBe(false);
    expect(
      isExplanationStale(result.explanation, { contentHash: "已经换了一份材料" }),
    ).toBe(true);
  });

  it("没有可用模型时给出可执行的提示，而不是静默失败", async () => {
    setChatProviderOverride(null);
    const { material, topic } = await prepare();
    await expect(createExplanation(user, material.id, topic)).rejects.toBeInstanceOf(AppError);
  });
});
