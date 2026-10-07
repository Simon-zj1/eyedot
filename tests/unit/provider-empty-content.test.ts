import { describe, expect, it } from "vitest";
import { OpenAICompatibleProvider } from "@/lib/llm/provider";

/**
 * 推理模型（DeepSeek 的 reasoning 系列等）会先输出 reasoning_content。
 * 输出上限被推理吃光时，content 是空的——线上实测踩到过：一页图解第一次生成直接报
 * 「LLM 返回内容为空」，看不出任何可行动信息。这里把「错误必须自解释」钉住。
 */
function providerReturning(body: unknown, ok = true) {
  return new OpenAICompatibleProvider({
    apiKey: "test-key",
    model: "deepseek-flash",
    fetchImpl: (async () =>
      new Response(JSON.stringify(body), {
        status: ok ? 200 : 500,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch,
  });
}

describe("模型返回内容为空时的报错", () => {
  it("只有推理内容、正文为空：报错要指出是推理占用，并给行动建议", async () => {
    const provider = providerReturning({
      model: "deepseek-flash",
      choices: [
        {
          finish_reason: "length",
          message: { role: "assistant", content: "", reasoning_content: "让我想想……".repeat(50) },
        },
      ],
    });

    await expect(
      provider.complete({ system: "s", user: "u", maxTokens: 8000 }),
    ).rejects.toThrow(/推理内容[\s\S]*maxTokens/);
  });

  it("既没有正文也没有推理：报错带上 finish_reason，便于定位", async () => {
    const provider = providerReturning({
      choices: [{ finish_reason: "stop", message: { role: "assistant", content: "" } }],
    });
    await expect(provider.complete({ system: "s", user: "u" })).rejects.toThrow(/finish_reason=stop/);
  });

  it("正常返回时不受影响", async () => {
    const provider = providerReturning({
      model: "deepseek-flash",
      choices: [{ finish_reason: "stop", message: { content: "{\"ok\":true}" } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });
    const result = await provider.complete({ system: "s", user: "u" });
    expect(result.text).toBe('{"ok":true}');
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
  });
});
