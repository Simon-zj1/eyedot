import { describe, expect, it } from "vitest";
import { sanitizeExplainerHtml } from "@/lib/security/html-sandbox";

/**
 * 图解 HTML 由模型生成、读的是用户上传的材料，所以是不可信输出。
 * 清洗不追求完备（正则做不到），但必须拦住最明显的那几类。
 */
describe("图解 HTML 清洗", () => {
  it("删掉脚本与内嵌框架", () => {
    const { html, removed } = sanitizeExplainerHtml(
      `<h1>要点</h1><script>alert(1)</script><iframe src="https://x.test"></iframe>`,
    );
    expect(html).not.toContain("script");
    expect(html).not.toContain("iframe");
    expect(html).toContain("<h1>要点</h1>");
    expect(removed).toEqual(expect.arrayContaining(["script", "iframe"]));
  });

  it("删掉事件处理器与 javascript: 链接", () => {
    const { html } = sanitizeExplainerHtml(
      `<div onclick="steal()">a</div><a href="javascript:alert(1)">b</a>`,
    );
    expect(html).not.toContain("onclick");
    expect(html).not.toContain("javascript:");
  });

  it("去掉外部资源引用，但保留内联样式与 data: 图片", () => {
    const { html, removed } = sanitizeExplainerHtml(
      `<style>h1{color:#333}</style><img src="https://cdn.test/a.png"><img src="data:image/png;base64,AAA">`,
    );
    expect(html).toContain("<style>h1{color:#333}</style>");
    expect(html).not.toContain("cdn.test");
    expect(html).toContain("data:image/png;base64,AAA");
    expect(removed).toContain("外部资源引用");
  });

  it("去掉 markdown 代码围栏，模型常常顺手加上", () => {
    const { html } = sanitizeExplainerHtml("```html\n<p>正文</p>\n```");
    expect(html).toBe("<p>正文</p>");
  });

  it("空产出会被识别出来，由上层拒绝落库", () => {
    const { html } = sanitizeExplainerHtml("<script>a</script>");
    expect(html.trim()).toBe("");
  });
});
