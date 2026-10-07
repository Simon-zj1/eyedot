import type { ExplainDoc, ExplainPanel } from "@/lib/explain/schema";
import { escapeHtml } from "@/lib/security/untrusted";

/**
 * 把内容 JSON 渲染成单文件 HTML。
 *
 * 渲染器归我们所有，这一点是刻意的：版式、字号、深浅色、打印、手机端换行都是**代码**决定的，
 * 不是模型的运气。所有文本都过 escapeHtml —— 内容里就算出现 `<script>` 也只会变成字面量。
 *
 * 样式约束来自这个产品自己的要求：正文不小于 16px、不固定宽度、不出现横向滚动、
 * 深浅色都能读、打印时不浪费纸。
 */

const STYLE = `
:root{--ink:#15181e;--muted:#5c6472;--line:#e3e6eb;--bg:#f7f8fa;--card:#fff;--accent:#2f5bff;--accent-soft:#eef2ff;--ok:#0f9d58;--warn:#b26a00;--err:#c0392b}
@media (prefers-color-scheme:dark){:root{--ink:#eef1f6;--muted:#a3adbd;--line:#2b3140;--bg:#0f1218;--card:#161b24;--accent:#7f9cff;--accent-soft:#1b2438;--ok:#4ade80;--warn:#fbbf24;--err:#f87171}}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{background:var(--bg);color:var(--ink);font:400 16px/1.75 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",system-ui,sans-serif;-webkit-font-smoothing:antialiased}
.page{max-width:820px;margin:0 auto;padding:32px 20px 56px}
.eyebrow{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);margin:0 0 10px}
h1{font-size:30px;line-height:1.3;margin:0 0 8px;letter-spacing:-.3px}
.subtitle{color:var(--muted);margin:0 0 16px}
.lead{background:var(--accent-soft);border-left:3px solid var(--accent);border-radius:0 10px 10px 0;padding:14px 16px;margin:0 0 24px}
.panel{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:20px;margin:0 0 16px}
.panel h2{font-size:18px;margin:0 0 12px;line-height:1.4}
.panel p{margin:0 0 10px}
.panel p:last-child,.panel ul:last-child,.panel ol:last-child{margin-bottom:0}
.panel ul,.panel ol{margin:0 0 10px;padding-left:22px}
.panel li{margin:4px 0}
.src{display:block;margin-top:12px;padding-top:10px;border-top:1px dashed var(--line);color:var(--muted);font-size:13px;word-break:break-word}
.tag{display:inline-block;margin-left:8px;padding:1px 8px;border-radius:999px;font-size:11px;font-weight:600;background:var(--accent-soft);color:var(--accent);vertical-align:middle}
.tag--added{background:#fff4e5;color:var(--warn)}
@media (prefers-color-scheme:dark){.tag--added{background:#2a2013}}
.callout{border-left:3px solid var(--accent)}
.callout--ok{border-left-color:var(--ok)}
.callout--warn{border-left-color:var(--warn)}
.callout--err{border-left-color:var(--err)}
.table-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch}
table{width:100%;border-collapse:collapse;font-size:15px}
th,td{border:1px solid var(--line);padding:8px 10px;text-align:left;vertical-align:top}
th{background:var(--bg);font-weight:650}
pre{margin:0;padding:14px;border-radius:10px;background:#0f1218;color:#e6edf3;overflow-x:auto;font-size:14px;line-height:1.6}
@media (prefers-color-scheme:dark){pre{background:#0b0e14;border:1px solid var(--line)}}
code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
p code,li code{background:var(--bg);border:1px solid var(--line);border-radius:5px;padding:1px 5px;font-size:14px}
.steps{counter-reset:step;list-style:none;padding-left:0}
.steps li{counter-increment:step;position:relative;padding-left:38px;margin:10px 0}
.steps li::before{content:counter(step);position:absolute;left:0;top:2px;width:24px;height:24px;border-radius:50%;background:var(--accent);color:#fff;font-size:13px;font-weight:700;display:grid;place-items:center}
.edges{list-style:none;padding-left:0;margin:0}
.edges li{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px;padding:8px 0;border-bottom:1px dashed var(--line)}
.edges li:last-child{border-bottom:0}
.edge-label{color:var(--muted);font-size:14px}
.notes{list-style:none;padding-left:0;margin:10px 0 0}
.notes li{color:var(--muted);font-size:14px;padding-left:14px;position:relative}
.notes li::before{content:"·";position:absolute;left:4px}
.foot{margin-top:28px;color:var(--muted);font-size:13px;line-height:1.8;word-break:break-word}
.foot code{font-size:12px}
@media print{body{background:#fff}.panel,.lead{break-inside:avoid}.foot{margin-top:16px}}
`;

function paragraphs(body: string): string {
  const blocks = body.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
  return blocks
    .map((block) => {
      const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
      if (lines.every((line) => line.startsWith("- "))) {
        const items = lines
          .map((line) => `<li>${escapeHtml(line.slice(2))}</li>`)
          .join("");
        return `<ul>${items}</ul>`;
      }
      return `<p>${escapeHtml(lines.join(" "))}</p>`;
    })
    .join("");
}

function sourceNote(panel: ExplainPanel): string {
  const parts: string[] = [];
  if ("source" in panel && panel.source) {
    parts.push(`材料原句：「${escapeHtml(panel.source)}」`);
  } else if (panel.added) {
    parts.push("模型补充（材料里没有直接对应的句子）");
  }
  if (parts.length === 0) return "";
  return `<span class="src">${parts.join(" · ")}</span>`;
}

function titleOf(panel: ExplainPanel): string {
  const tag = panel.added ? '<span class="tag tag--added">模型补充</span>' : "";
  return `<h2>${escapeHtml(panel.title)}${tag}</h2>`;
}

function renderPanel(panel: ExplainPanel): string {
  const head = titleOf(panel);
  const tail = sourceNote(panel);
  switch (panel.kind) {
    case "prose":
      return `<section class="panel">${head}${paragraphs(panel.body)}${tail}</section>`;
    case "steps": {
      const items = panel.steps.map((step) => `<li>${escapeHtml(step)}</li>`).join("");
      return `<section class="panel">${head}<ol class="steps">${items}</ol>${tail}</section>`;
    }
    case "flow": {
      const items = panel.edges
        .map(
          (edge) =>
            `<li><strong>${escapeHtml(edge.from)}</strong><span aria-hidden="true">→</span>` +
            `<strong>${escapeHtml(edge.to)}</strong>` +
            (edge.label ? `<span class="edge-label">（${escapeHtml(edge.label)}）</span>` : "") +
            `</li>`,
        )
        .join("");
      return `<section class="panel">${head}<ul class="edges">${items}</ul>${tail}</section>`;
    }
    case "compare": {
      const head_ = panel.columns
        .map((column) => `<th>${escapeHtml(column)}</th>`)
        .join("");
      const rows = panel.rows
        .map(
          (row) =>
            `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`,
        )
        .join("");
      return `<section class="panel">${head}<div class="table-wrap"><table><thead><tr>${head_}</tr></thead><tbody>${rows}</tbody></table></div>${tail}</section>`;
    }
    case "code": {
      const notes = panel.notes?.length
        ? `<ul class="notes">${panel.notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}</ul>`
        : "";
      return `<section class="panel">${head}<pre><code>${escapeHtml(panel.code)}</code></pre>${notes}${tail}</section>`;
    }
    case "callout":
      return `<section class="panel callout callout--${panel.tone}">${head}${paragraphs(panel.body)}${tail}</section>`;
  }
}

export type RenderExplainerOptions = {
  materialTitle: string;
  /** 材料内容指纹的前 8 位：产物要能对上它到底是基于哪一版材料生成的 */
  materialHash: string;
  model: string;
  generatedAt: Date;
  /** 引文校验中被降级为「模型补充」的面板数，如实写在页脚 */
  ungroundedCount?: number;
};

export function renderExplainerHtml(doc: ExplainDoc, options: RenderExplainerOptions): string {
  const panels = doc.panels.map(renderPanel).join("\n");
  const lead = doc.lead ? `<p class="lead">${escapeHtml(doc.lead)}</p>` : "";
  const subtitle = doc.subtitle ? `<p class="subtitle">${escapeHtml(doc.subtitle)}</p>` : "";
  const ungrounded = options.ungroundedCount
    ? `其中 ${options.ungroundedCount} 个面板的引文没能在材料里定位，已改标为「模型补充」。`
    : "";

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(doc.title)}</title>
<style>${STYLE}</style>
</head>
<body>
<main class="page">
<p class="eyebrow">点睛 · 一页图解</p>
<h1>${escapeHtml(doc.title)}</h1>
${subtitle}
${lead}
${panels}
<p class="foot">
基于《${escapeHtml(options.materialTitle)}》（材料版本 ${escapeHtml(options.materialHash.slice(0, 8))}）由
<code>${escapeHtml(options.model)}</code> 生成于 ${escapeHtml(
    options.generatedAt.toISOString().slice(0, 16).replace("T", " "),
  )} UTC。
标「材料原句」的内容可在材料中逐字定位；标「模型补充」的不在你的材料里。${escapeHtml(ungrounded)}
</p>
</main>
</body>
</html>
`;
}
