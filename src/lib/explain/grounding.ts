import type { ExplainDoc } from "@/lib/explain/schema";

/**
 * 图解引文的落地校验。
 *
 * 面板上标了「来自材料」的句子，必须真在材料里逐字出现过——这是「材料事实可核对」这条契约
 * 在图解上的延伸。不通过的处理是**降级而不是丢弃**：去掉 source 并标成「模型补充」，
 * 页面照常能看，但对读者的标注是诚实的。
 *
 * 比对前统一空白与全角空格，避免模型把换行/空格改写一下就判失败。
 */

function normalize(text: string): string {
  return text.replace(/[\s\u3000]+/g, "");
}

export type GroundingReport = {
  doc: ExplainDoc;
  /** 被降级为「模型补充」的面板标题 */
  ungrounded: string[];
  /** 校验过的引文条数 */
  checked: number;
};

export function verifyExplainGrounding(doc: ExplainDoc, materialText: string): GroundingReport {
  const haystack = normalize(materialText);
  const ungrounded: string[] = [];
  let checked = 0;

  const panels = doc.panels.map((panel) => {
    const source = "source" in panel ? panel.source : undefined;
    if (!source) return panel;
    checked += 1;
    if (haystack.includes(normalize(source))) return panel;
    ungrounded.push(panel.title);
    const { source: _dropped, ...rest } = panel;
    return { ...rest, added: true };
  });

  return { doc: { ...doc, panels }, ungrounded, checked };
}
