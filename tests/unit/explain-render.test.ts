import { describe, expect, it } from "vitest";
import { parseExplainDoc } from "@/lib/explain/generate";
import { verifyExplainGrounding } from "@/lib/explain/grounding";
import { renderExplainerHtml } from "@/lib/explain/render";
import type { ExplainDoc } from "@/lib/explain/schema";

const MATERIAL = [
  "光合作用分为光反应和暗反应两个阶段。",
  "光反应发生在类囊体薄膜上，需要光照，水在光下分解产生氧气。",
  "暗反应发生在叶绿体基质中，不需要光照。",
].join("\n");

const doc: ExplainDoc = {
  title: "光反应和暗反应的分工",
  lead: "简单说：一个负责把光变成能量，一个负责把二氧化碳变成糖。",
  panels: [
    {
      kind: "prose",
      title: "两个阶段",
      body: "光合作用分两个阶段。\n\n- 光反应：需要光\n- 暗反应：不需要光",
      source: "光合作用分为光反应和暗反应两个阶段。",
    },
    {
      kind: "steps",
      title: "光反应的过程",
      steps: ["吸收光能", "水被分解并放出氧气", "把能量存进 ATP"],
      source: "光反应发生在类囊体薄膜上，需要光照，水在光下分解产生氧气。",
    },
    { kind: "callout", title: "一个常见误解", tone: "warn", body: "「暗反应」不是必须在黑暗里发生，只是不需要光。", added: true },
  ],
};

describe("图解渲染器", () => {
  it("内容里的 HTML 会被转义，不会变成标签", () => {
    const hostile: ExplainDoc = {
      title: "<script>alert(1)</script>",
      panels: [{ kind: "prose", title: "带 <img onerror=x> 的标题", body: "<b>加粗</b>" }],
    };
    const html = renderExplainerHtml(hostile, {
      materialTitle: "材料 <x>",
      materialHash: "abcdef0123456789",
      model: "deepseek-flash",
      generatedAt: new Date("2026-10-08T00:00:00Z"),
    });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<b>加粗</b>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("单文件、自包含：没有外链资源，且带 charset 与 viewport", () => {
    const html = renderExplainerHtml(doc, {
      materialTitle: "生物笔记",
      materialHash: "abcdef0123456789",
      model: "deepseek-flash",
      generatedAt: new Date("2026-10-08T00:00:00Z"),
    });
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain("width=device-width");
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).toContain("<style>");
  });

  it("手机端与深浅色是代码决定的，不靠模型自由发挥", () => {
    const html = renderExplainerHtml(doc, {
      materialTitle: "生物笔记",
      materialHash: "abcdef0123456789",
      model: "deepseek-flash",
      generatedAt: new Date("2026-10-08T00:00:00Z"),
    });
    expect(html).toContain("prefers-color-scheme:dark");
    expect(html).toContain("font:400 16px/1.75"); // 正文不小于 16px
    expect(html).toContain("max-width:820px");
  });

  it("页脚写明材料版本、模型与「模型补充」的说明", () => {
    const html = renderExplainerHtml(doc, {
      materialTitle: "生物笔记",
      materialHash: "abcdef0123456789",
      model: "deepseek-flash",
      generatedAt: new Date("2026-10-08T09:30:00Z"),
      ungroundedCount: 1,
    });
    expect(html).toContain("材料版本 abcdef01");
    expect(html).toContain("deepseek-flash");
    expect(html).toContain("1 个面板的引文没能在材料里定位");
    expect(html).toContain("模型补充");
  });
});

describe("图解内容契约", () => {
  it("接受合法 JSON，容忍代码围栏与前后客套话", () => {
    const raw = `好的，这是你要的内容：\n\`\`\`json\n${JSON.stringify(doc)}\n\`\`\`\n希望有用。`;
    const parsed = parseExplainDoc(raw);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.doc.panels).toHaveLength(3);
  });

  it("面板数量超出上限、kind 不认识，都会被拒绝并说明原因", () => {
    const tooMany = parseExplainDoc(
      JSON.stringify({
        title: "t",
        panels: Array.from({ length: 9 }, () => ({ kind: "prose", title: "x", body: "y" })),
      }),
    );
    expect(tooMany.ok).toBe(false);

    const badKind = parseExplainDoc(JSON.stringify({ title: "t", panels: [{ kind: "html", title: "x", body: "y" }] }));
    expect(badKind.ok).toBe(false);
    if (!badKind.ok) expect(badKind.error).toContain("结构不符合契约");
  });

  it("完全没有 JSON 时给出明确错误，而不是抛异常", () => {
    const parsed = parseExplainDoc("抱歉，我无法完成。");
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toContain("没有 JSON");
  });
});

describe("引文落地校验", () => {
  it("能在材料里逐字定位的引文保持不变", () => {
    const result = verifyExplainGrounding(doc, MATERIAL);
    expect(result.checked).toBe(2);
    expect(result.ungrounded).toEqual([]);
    expect(result.doc.panels[0]).toHaveProperty("source");
  });

  it("定位不到的引文被降级为「模型补充」，而不是让读者以为它有出处", () => {
    const forged: ExplainDoc = {
      title: "t",
      panels: [
        { kind: "prose", title: "伪造出处", body: "正文", source: "这句话材料里根本没有出现过" },
      ],
    };
    const result = verifyExplainGrounding(forged, MATERIAL);
    expect(result.ungrounded).toEqual(["伪造出处"]);
    const panel = result.doc.panels[0];
    expect(panel).not.toHaveProperty("source");
    expect(panel.added).toBe(true);
  });

  it("换行与空格被改写不影响判定", () => {
    const spaced = verifyExplainGrounding(
      { title: "t", panels: [{ kind: "prose", title: "x", body: "y", source: "光合作用 分为光反应和暗反应\n两个阶段" }] },
      MATERIAL,
    );
    expect(spaced.ungrounded).toEqual([]);
  });
});
