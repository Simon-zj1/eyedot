/**
 * 一页图解的 HTML 清洗。
 *
 * 前提：这份 HTML 由模型生成，而模型读的是用户上传的材料——**材料是不可信输入**，
 * 所以产物也是不可信输出，不能直接当页面渲染。
 *
 * 两层防线，顺序不能反：
 * 1. 这里做清洗，是为了减少噪音（脚本、外链、事件处理器）；
 * 2. 真正的防线是 EXPLAINER_CSP：即使清洗漏了，浏览器也不给它加载资源、拿 Cookie 的机会。
 *    正则在 HTML 上做不到完备（这正是不要只靠第一层的原因）。
 */

/** 整段删掉的标签，连带内容：这些标签的存在本身就意味着「这不是一份静态讲解页」。 */
const BLOCKED_PAIRED = [
  "script",
  "iframe",
  "object",
  "embed",
  "form",
  "noscript",
  "template",
];

/**
 * 自闭合或单标签，直接删标签本身。
 *
 * 注意 meta 不在这里：渲染器自己要输出 `<meta charset>` 与 viewport，
 * 全删会把页面的编码和移动端缩放一起删掉。只删 http-equiv 那一类（跳转/刷新），见下面。
 */
const BLOCKED_VOID = ["link", "base", "embed", "iframe", "object"];

export type SanitizeReport = {
  html: string;
  /** 清掉了哪几类东西，用于在界面上如实说明「这份图解被处理过」 */
  removed: string[];
};

function stripPaired(html: string, tag: string, removed: string[]): string {
  const pattern = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}\\s*>`, "gi");
  if (pattern.test(html)) removed.push(tag);
  return html.replace(pattern, "");
}

export function sanitizeExplainerHtml(raw: string): SanitizeReport {
  const removed: string[] = [];
  let html = raw.trim();

  // 去掉 markdown 代码围栏：模型有时会把它当成「代码」来答
  html = html
    .replace(/^```(?:html)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  for (const tag of BLOCKED_PAIRED) html = stripPaired(html, tag, removed);
  for (const tag of BLOCKED_VOID) {
    const pattern = new RegExp(`<${tag}\\b[^>]*?/?>`, "gi");
    if (pattern.test(html)) removed.push(tag);
    html = html.replace(pattern, "");
  }

  // http-equiv 类 meta（refresh / 跳转）能改页面行为，删掉；charset 与 viewport 保留
  const metaRefresh = /<meta\b[^>]*http-equiv[^>]*>/gi;
  if (metaRefresh.test(html)) removed.push("http-equiv");
  html = html.replace(metaRefresh, "");

  // 事件处理器（onclick 之类）
  const eventPattern = /\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
  if (eventPattern.test(html)) removed.push("事件处理器");
  html = html.replace(eventPattern, "");

  // 危险协议
  const dangerous = /(href|src|xlink:href)\s*=\s*(?:"|')?\s*(?:javascript|vbscript|data:text\/html)[^"'\s>]*(?:"|')?/gi;
  if (dangerous.test(html)) removed.push("危险链接协议");
  html = html.replace(dangerous, 'href="#"');

  // 外部资源：单文件、离线可读是这份产物的卖点，顺带也断掉外链追踪与远程加载
  const remote = /(src|href|poster|xlink:href)\s*=\s*(?:"|')?\s*(?:https?:)?\/\/[^"'\s>]*(?:"|')?/gi;
  if (remote.test(html)) removed.push("外部资源引用");
  html = html.replace(remote, "");

  return { html, removed: [...new Set(removed)] };
}

/**
 * 把清洗后的 HTML 当独立文档返回时用的响应头。
 *
 * `sandbox` 让文档处于唯一源：拿不到本站 Cookie、localStorage，也不能跳转顶层页面；
 * `default-src 'none'` 断掉一切外部加载，只留内联样式与 data: 图片。
 */
export const EXPLAINER_CSP =
  "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'";
