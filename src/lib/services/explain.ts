import { MAX_MATERIAL_CHARS } from "@/lib/config";
import type { ExplanationRecord, UserRecord } from "@/lib/db/types";
import { AppError, NotFoundError, ValidationError } from "@/lib/errors";
import { buildExplainUserPrompt, EXPLAIN_SYSTEM_PROMPT } from "@/lib/explain/prompt";
import { resolveChatProvider } from "@/lib/llm/provider";
import { consumeQuota, refundQuota } from "@/lib/quota";
import { sanitizeExplainerHtml, type SanitizeReport } from "@/lib/security/html-sandbox";
import { scanMaterial } from "@/lib/security/untrusted";
import { assertByokConfigured, byokForMode } from "@/lib/services/byok";
import { assertPlatformCallAllowed, recordChatUsage } from "@/lib/services/usage";
import { getMaterialForUser } from "@/lib/services/materials";
import { getStore } from "@/lib/db";
import { truncate } from "@/lib/text";

const EXPLAIN_MAX_TOPIC_CHARS = 120;

export type ExplainResult = {
  explanation: ExplanationRecord;
  sanitize: SanitizeReport;
  mode: "byok" | "platform" | "offline";
  model: string;
};

/**
 * 生成一页图解。
 *
 * 与判定链路同一套规矩：材料是不可信输入（拼提示词前走 scanMaterial）、模型产出是不可信输出
 * （落库前走 sanitizeExplainerHtml）、花平台的钱就扣积分并记用量。
 * 接进产品的是「讲法」这件事——同一个知识点该用类比、流程还是例子，由提示词里的规则决定。
 */
export async function createExplanation(
  user: UserRecord,
  materialId: string,
  rawTopic: string,
): Promise<ExplainResult> {
  const topic = rawTopic.trim();
  if (!topic) throw new ValidationError("请先选择或输入要讲解的知识点");
  if (topic.length > EXPLAIN_MAX_TOPIC_CHARS) {
    throw new ValidationError(`知识点太长，最多 ${EXPLAIN_MAX_TOPIC_CHARS} 个字符。`);
  }

  assertByokConfigured(user);
  const material = await getMaterialForUser(user, materialId);
  const selection = resolveChatProvider(byokForMode(user)?.llm ?? null);
  if (!selection.provider) {
    throw new AppError("当前没有可用的模型，无法生成图解。请配置平台密钥或自己的模型 Key。", 503, "no_model");
  }

  let quotaReserved = false;
  if (selection.countsAgainstQuota) {
    await assertPlatformCallAllowed(user, "generate");
    await consumeQuota(user.id, { explain: 1 });
    quotaReserved = true;
  }

  // 材料过长时只取前一段：图解要的是「讲清楚一个点」，不是把整本书塞进提示词
  const scanned = scanMaterial(truncate(material.rawText, MAX_MATERIAL_CHARS), {
    maxChars: MAX_MATERIAL_CHARS,
  });

  let response;
  try {
    response = await selection.provider.complete({
      system: EXPLAIN_SYSTEM_PROMPT,
      user: buildExplainUserPrompt({
        materialTitle: material.title,
        topic,
        materialExcerpt: scanned.promptText,
      }),
      temperature: 0.3,
      maxTokens: 6000,
    });
  } catch (error) {
    if (quotaReserved) await refundQuota(user.id, { explain: 1 });
    throw error;
  } finally {
    await recordChatUsage(
      user.id,
      [
        {
          model: response?.model ?? selection.provider.model,
          inputTokens: response?.usage?.inputTokens,
          outputTokens: response?.usage?.outputTokens,
        },
      ],
      selection.countsAgainstQuota ? "platform" : "byok",
      material.id,
    );
  }

  const sanitize = sanitizeExplainerHtml(response.text);
  if (!sanitize.html.trim()) {
    if (quotaReserved) await refundQuota(user.id, { explain: 1 });
    throw new AppError("模型没有产出可用的图解内容，请换个知识点再试。", 502, "empty_explanation");
  }

  const explanation = await getStore().createExplanation({
    userId: user.id,
    materialId: material.id,
    topic,
    html: sanitize.html,
    model: response.model,
  });

  return {
    explanation,
    sanitize,
    mode: selection.mode,
    model: response.model,
  };
}

export async function getExplanationForUser(
  user: UserRecord,
  id: string,
): Promise<ExplanationRecord> {
  const record = await getStore().getExplanation(id);
  if (!record || record.userId !== user.id) throw new NotFoundError("图解不存在");
  return record;
}

export async function listExplanations(user: UserRecord, materialId: string) {
  await getMaterialForUser(user, materialId);
  return getStore().listExplanationsByMaterial(materialId);
}
