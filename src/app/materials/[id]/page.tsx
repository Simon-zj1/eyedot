import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AskPanel } from "@/components/ask-panel";
import { ExamBuilder } from "@/components/exam-builder";
import { ExplainPanel } from "@/components/explain-panel";
import { GenerateOutlineButton } from "@/components/generate-outline-button";
import { TopBar } from "@/components/top-bar";
import { getCurrentUser } from "@/lib/auth/session";
import {
  DEFAULT_QUESTION_COUNT,
  DEFAULT_QUESTION_MIX,
  MAX_QUESTION_COUNT,
  MIN_QUESTION_COUNT,
} from "@/lib/config";
import { NotFoundError } from "@/lib/errors";
import { getBlueprintForMaterial } from "@/lib/services/generation";
import { listExplanations } from "@/lib/services/explain";
import { getMaterialForUser } from "@/lib/services/materials";
import { listExamSummaries } from "@/lib/services/results";
import { scanMaterial, summarizeHazards } from "@/lib/security/untrusted";
import { truncate } from "@/lib/text";

export const dynamic = "force-dynamic";

export default async function MaterialDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  let material;
  try {
    material = await getMaterialForUser(user, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const blueprint = await getBlueprintForMaterial(material).catch(() => null);
  const exams = (await listExamSummaries(user)).filter((summary) => summary.exam.materialId === id);
  const scan = scanMaterial(material.rawText);
  const explanations = await listExplanations(user, material.id);
  // 知识点来自大纲；还没生成大纲时留空，用户可以自己输入
  const explainTopics = blueprint?.topics.map((entry) => entry.title) ?? [];

  return (
    <>
      <TopBar user={user} />
      <main className="shell" style={{ paddingTop: 24 }}>
        <p className="small muted">
          <Link href="/materials">← 返回材料列表</Link>
        </p>
        <h1>{material.title}</h1>
        <p className="muted small">
          {material.rawText.length} 字符 · 约 {material.tokenCount} tokens · 上传于{" "}
          {new Date(material.createdAt).toLocaleString("zh-CN")}
        </p>

        {scan.hazards.length > 0 ? (
          <div className="banner banner--warn">
            <strong>安全提示：{summarizeHazards(scan.hazards)}。</strong>
            <div className="small" style={{ marginTop: 6 }}>
              材料一律当作不可信数据：其中的指令、角色设定与要求都不会被执行，只会作为被学习的文本；
              报告里「材料原文」字段还必须能在原文中逐字定位。
            </div>
            <ul className="small" style={{ margin: "8px 0 0", paddingLeft: 18 }}>
              {scan.hazards.slice(0, 5).map((hazard) => (
                <li key={hazard.id}>
                  {hazard.label}（{hazard.severity === "high" ? "高风险" : "中风险"}）：{hazard.excerpt}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <section className="card">
          <h2>材料原文（预览）</h2>
          {material.sourceMap ? (
            <p className="small muted">
              来源：{material.sourceMap.fileName}
              {material.sourceMap.pageCount ? ` · ${material.sourceMap.pageCount} 页` : ""}
              {material.sourceMap.pages
                ? ` · 出处可定位到页码（共 ${material.sourceMap.pages.length} 页有文字）`
                : ""}
            </p>
          ) : null}
          <p className="small muted" style={{ whiteSpace: "pre-wrap" }}>
            {truncate(material.rawText, 900)}
          </p>
        </section>

        {material.sourceMap?.health ? (
          <section className="card">
            <div className="row row--between">
              <h2 style={{ margin: 0 }}>上传体检</h2>
              <span
                className={`pill${
                  material.sourceMap.health.level === "good"
                    ? " pill--ok"
                    : material.sourceMap.health.level === "fair"
                      ? " pill--warn"
                      : " pill--err"
                }`}
              >
                {material.sourceMap.health.level === "good"
                  ? "可用"
                  : material.sourceMap.health.level === "fair"
                    ? "基本可用"
                    : "质量不佳"}
              </span>
            </div>
            <p className="small muted">{material.sourceMap.health.summary}</p>
            <ul className="small" style={{ margin: "8px 0 0", paddingLeft: 18 }}>
              {material.sourceMap.health.checks.map((check) => (
                <li key={check.id}>
                  <strong>
                    {check.status === "pass" ? "✓" : check.status === "warn" ? "!" : "✕"}{" "}
                    {check.label}
                  </strong>
                  ：{check.detail}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <AskPanel materialId={material.id} />

        <section className="card">
          <h2>一页图解</h2>
          <p className="small muted">
            把材料里的一个知识点做成一页 HTML：抽象概念给类比、流程给步骤、算法给具体例子，
            产物是单文件，可以离线保存。它由模型生成，材料里没有的内容会标成「补充」。
          </p>
          <ExplainPanel
            materialId={material.id}
            topics={explainTopics}
            initial={explanations.map((record) => ({
              id: record.id,
              topic: record.topic,
              model: record.model,
            }))}
          />
        </section>

        {!blueprint ? (
          <section className="card">
            <h2>第一步：切分知识点</h2>
            <p className="muted small">
              出题必须基于知识点，否则会得到一堆散题。生成大纲只依据材料本身，不会引入材料外的知识。
            </p>
            <GenerateOutlineButton materialId={material.id} />
          </section>
        ) : (
          <section className="card">
            <div className="row row--between">
              <h2 style={{ margin: 0 }}>第二步：确认知识点并生成试卷</h2>
              <span className="pill">
                {blueprint.topics.length} 个知识点 · {blueprint.generatorModel}
              </span>
            </div>
            <div className="divider" />
            <ExamBuilder
              materialId={material.id}
              topics={blueprint.topics}
              defaultCount={DEFAULT_QUESTION_COUNT}
              minCount={MIN_QUESTION_COUNT}
              maxCount={MAX_QUESTION_COUNT}
              defaultMix={DEFAULT_QUESTION_MIX}
            />
          </section>
        )}

        <section className="card">
          <h2>该材料下的试卷</h2>
          {exams.length === 0 ? (
            <div className="empty">还没有试卷。</div>
          ) : (
            <div className="stack">
              {exams.map((summary) => (
                <div key={summary.exam.id} className="row row--between">
                  <div>
                    <strong>{summary.exam.title}</strong>
                    <div className="small muted">
                      {summary.exam.config.count} 题 ·{" "}
                      {summary.latestAttempt
                        ? `最近 ${summary.latestAttempt.scorePercent ?? 0} 分`
                        : "未作答"}
                    </div>
                  </div>
                  <Link
                    href={
                      summary.latestAttempt
                        ? `/attempts/${summary.latestAttempt.id}`
                        : `/exams/${summary.exam.id}/take`
                    }
                  >
                    {summary.latestAttempt ? "查看结果" : "开始作答"}
                  </Link>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </>
  );
}
