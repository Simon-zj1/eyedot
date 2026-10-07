import { buildExplainUserPrompt, EXPLAIN_SYSTEM_PROMPT } from "@/lib/explain/prompt";
import { explainDocSchema, type ExplainDoc } from "@/lib/explain/schema";
import type { ChatProvider } from "@/lib/llm/provider";
import type { ChatUsageEvent } from "@/lib/llm/usage";

// 解析失败时最多再要一次：一次就放弃，会让「模型多写了两句客套话」变成用户的损失。
const MAX_ATTEMPTS = 2;

export type ParseResult = { ok: true; doc: ExplainDoc } | { ok: false; error: string };

// 从模型输出里取出 JSON：容忍代码围栏与前后客套话，但只接受能通过 schema 的对象。
export function parseExplainDoc(raw: string): ParseResult {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    return { ok: false, error: "输出里没有 JSON 对象" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch (error) {
    return { ok: false, error: `JSON 解析失败：${(error as Error).message}` };
  }
  const result = explainDocSchema.safeParse(parsed);
  if (!result.success) {
    const issue = result.error.issues[0];
    return {
      ok: false,
      error: `结构不符合契约：${issue?.path.join(".") || "?"} ${issue?.message ?? ""}`.trim(),
    };
  }
  return { ok: true, doc: result.data };
}

export type GenerateExplainInput = {
  materialTitle: string;
  topic: string;
  materialExcerpt: string;
};

export type GenerateExplainResult = {
  doc: ExplainDoc;
  model: string;
  // 本次生成发生的全部模型调用，交给调用方记账（重试的那次也要算钱）
  usage: ChatUsageEvent[];
  // 尝试次数，>1 说明第一次输出不合契约
  attempts: number;
};

// 生成内容 JSON。网页、命令行、MCP 三个入口都走这里：一处提示词、一处解析、一处重试策略，
// 否则「网页里能跑、命令行里跑不了」这种分叉迟早会出现。
export async function generateExplainDoc(
  provider: ChatProvider,
  input: GenerateExplainInput,
): Promise<GenerateExplainResult> {
  const usage: ChatUsageEvent[] = [];
  let lastError = "";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const user =
      attempt === 1
        ? buildExplainUserPrompt(input)
        : [
            buildExplainUserPrompt(input),
            "",
            `上一次的输出不能用：${lastError}`,
            "请重新输出一个合法 JSON 对象，不要任何解释或代码围栏。",
          ].join("\n");

    const response = await provider.complete({
      system: EXPLAIN_SYSTEM_PROMPT,
      user,
      temperature: 0.3,
      maxTokens: 6000,
    });
    usage.push({
      model: response.model,
      inputTokens: response.usage?.inputTokens,
      outputTokens: response.usage?.outputTokens,
    });

    const parsed = parseExplainDoc(response.text);
    if (parsed.ok) {
      return { doc: parsed.doc, model: response.model, usage, attempts: attempt };
    }
    lastError = parsed.error;
  }

  throw new Error(`模型两次都没有给出符合契约的内容（最后错误：${lastError}）`);
}
