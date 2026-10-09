import type { ExplainDoc, ExplainPanel } from "@/lib/explain/schema";

/**
 * 把同一份内容 JSON 渲染成 Markdown。
 *
 * 这是「模型产 JSON，渲染器负责呈现」这条契约的第二个收益：HTML 给浏览器，
 * Markdown 给 Obsidian / Anki / 仓库里的笔记——不需要再让模型生成一遍（也就不再花一次钱）。
 *
 * 表格单元格里的 `|` 必须转义，否则会把表格切碎；标题里的 `#` 同理。
 */

function escapeInline(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\r?\n+/g, " ").trim();
}

function escapeHeading(text: string): string {
  return escapeInline(text).replace(/^#+\s*/, "");
}

function paragraph(body: string): string[] {
  const blocks = body.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
  const out: string[] = [];
  for (const block of blocks) {
    const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
    if (lines.every((line) => line.startsWith("- "))) {
      out.push(...lines.map((line) => `- ${line.slice(2)}`));
    } else {
      out.push(lines.join(" "));
    }
    out.push("");
  }
  return out;
}

/** 面板出处：与页面上一致，材料原句 / 模型补充二选一，不混。 */
function sourceLine(panel: ExplainPanel): string | null {
  if ("source" in panel && panel.source) return `> 材料原句：「${panel.source}」`;
  if (panel.added) return "> 模型补充（材料里没有直接对应的句子）";
  return null;
}

function renderPanel(panel: ExplainPanel): string[] {
  const title = `## ${escapeHeading(panel.title)}${panel.added && !("source" in panel && panel.source) ? "（模型补充）" : ""}`;
  const out: string[] = [title, ""];
  switch (panel.kind) {
    case "prose":
      out.push(...paragraph(panel.body));
      break;
    case "steps":
      panel.steps.forEach((step, index) => out.push(`${index + 1}. ${escapeInline(step)}`));
      out.push("");
      break;
    case "flow":
      panel.edges.forEach((edge) =>
        out.push(
          `- ${escapeInline(edge.from)} → ${escapeInline(edge.to)}${
            edge.label ? `（${escapeInline(edge.label)}）` : ""
          }`,
        ),
      );
      out.push("");
      break;
    case "compare": {
      out.push(`| ${panel.columns.map(escapeInline).join(" | ")} |`);
      out.push(`| ${panel.columns.map(() => "---").join(" | ")} |`);
      for (const row of panel.rows) {
        out.push(`| ${row.map(escapeInline).join(" | ")} |`);
      }
      out.push("");
      break;
    }
    case "code":
      out.push(`\`\`\`${panel.language ?? ""}`.trimEnd(), panel.code, "```", "");
      panel.notes?.forEach((note, index) => out.push(`${index + 1}. ${escapeInline(note)}`));
      if (panel.notes?.length) out.push("");
      break;
    case "callout": {
      const label = panel.tone === "warn" ? "注意" : panel.tone === "err" ? "警告" : panel.tone === "ok" ? "结论" : "提示";
      out.push(`> **${label}**`, ...paragraph(panel.body).map((line) => (line ? `> ${line}` : ">")));
      break;
    }
  }
  const source = sourceLine(panel);
  if (source) out.push("", source);
  out.push("");
  return out;
}

export type RenderExplainerMarkdownOptions = {
  materialTitle: string;
  materialHash: string;
  model: string;
  generatedAt: Date;
  ungroundedCount?: number;
};

export function renderExplainerMarkdown(
  doc: ExplainDoc,
  options: RenderExplainerMarkdownOptions,
): string {
  const lines: string[] = [`# ${escapeHeading(doc.title)}`, ""];
  if (doc.subtitle) lines.push(escapeInline(doc.subtitle), "");
  if (doc.lead) lines.push(`> ${escapeInline(doc.lead)}`, "");
  for (const panel of doc.panels) lines.push(...renderPanel(panel));

  lines.push(
    "---",
    "",
    `基于《${escapeInline(options.materialTitle)}》（材料版本 ${options.materialHash.slice(0, 8)}）由 \`${
      options.model
    }\` 生成于 ${options.generatedAt.toISOString().slice(0, 16).replace("T", " ")} UTC。`,
  );
  if (options.ungroundedCount) {
    lines.push(`其中 ${options.ungroundedCount} 个面板的引文没能在材料里定位，已按「模型补充」标注。`);
  }
  lines.push(
    "标「材料原句」的内容可在材料中逐字定位；标「模型补充」的不在你的材料里。",
    "",
  );
  return lines.join("\n");
}
