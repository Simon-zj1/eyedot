import { MAX_MATERIAL_CHARS } from "@/lib/config";
import type { ExplanationRecord, UserRecord } from "@/lib/db/types";
import { AppError, NotFoundError, ValidationError } from "@/lib/errors";
import { generateExplainDoc } from "@/lib/explain/generate";
import { verifyExplainGrounding } from "@/lib/explain/grounding";
import { renderExplainerHtml } from "@/lib/explain/render";
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
  /** 引文没能在材料里定位、被改标为「模型补充」的面板标题 */
  ungrounded: string[];
};

/**
 * 生成一页图解。
 *
 * 与判定链路同一套规矩：材料是不可信输入（拼提示词前走 scanMaterial）、
 * 模型产出是不可信数据（先过 schema，再由我们的渲染器转义输出）、
 * 花平台的钱就扣积分并记用量。
 *
 * 关键结构：**模型只产出内容 JSON，HTML 由渲染器生成**（和出题链路同一个契约）。
 * 这样版式、字号、移动端换行、深浅色都是代码决定的；内容里的 HTML 也只是字面量。
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

  let generated;
  try {
    generated = await generateExplainDoc(selection.provider, {
      materialTitle: material.title,
      topic,
      materialExcerpt: scanned.promptText,
    });
  } catch (error) {
    if (quotaReserved) await refundQuota(user.id, { explain: 1 });
    throw error;
  } finally {
    // 重试的那次调用同样产生成本，所以按整批 usage 记账
    await recordChatUsage(
      user.id,
      generated?.usage ?? [],
      selection.countsAgainstQuota ? "platform" : "byok",
      material.id,
    );
  }

  // 标了「来自材料」的句子必须能在材料里逐字定位；不通过就降级成「模型补充」而不是丢掉整篇
  const grounding = verifyExplainGrounding(generated.doc, material.rawText);
  const rendered = renderExplainerHtml(grounding.doc, {
    materialTitle: material.title,
    materialHash: material.contentHash,
    model: generated.model,
    generatedAt: new Date(),
    ungroundedCount: grounding.ungrounded.length,
  });
  // 渲染器已经转义了所有文本；这一层是防止将来改渲染器时不小心放进了原生 HTML（两层防线）
  const sanitize = sanitizeExplainerHtml(rendered);
  if (!sanitize.html.trim()) {
    if (quotaReserved) await refundQuota(user.id, { explain: 1 });
    throw new AppError("生成的图解内容为空，请换个知识点再试。", 502, "empty_explanation");
  }

  const explanation = await getStore().createExplanation({
    userId: user.id,
    materialId: material.id,
    topic,
    doc: grounding.doc,
    materialHash: material.contentHash,
    html: sanitize.html,
    model: generated.model,
  });

  return {
    explanation,
    sanitize,
    mode: selection.mode,
    model: generated.model,
    ungrounded: grounding.ungrounded,
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

/**
 * 产物是不是基于旧版材料生成的。
 *
 * 现在还没有「编辑材料」入口，所以实际返回恒为 false——它在这里的意义是：
 * 数据结构已经能回答这个问题（材料指纹存在产物上），等编辑入口上线，
 * 这一条不需要再改表、改迁移、改历史数据，接上线就行。
 */
export function isExplanationStale(
  explanation: ExplanationRecord,
  material: { contentHash: string },
): boolean {
  if (!explanation.materialHash) return false;
  return explanation.materialHash !== material.contentHash;
}
