import { NextResponse, type NextRequest } from "next/server";
import { requireUserFromRequest } from "@/lib/auth/request";
import { toErrorResponse } from "@/lib/errors";
import { renderExplainerMarkdown } from "@/lib/explain/render-markdown";
import { getExplanationForUser } from "@/lib/services/explain";
import { getStore } from "@/lib/db";

export const runtime = "nodejs";

/**
 * 导出单条图解的 Markdown。
 *
 * 和网页版来自**同一份内容 JSON**：换个渲染器而已，不重新调用模型。
 * 拿去做笔记（Obsidian / Logseq）或塞进 Anki 时，这是比 HTML 更好用的形态。
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUserFromRequest(request);
    const { id } = await context.params;
    const record = await getExplanationForUser(user, id);
    if (!record.doc) {
      return NextResponse.json(
        {
          error: "这条图解生成于「内容 JSON」落库之前，没有结构化内容可转换；可以下载 HTML 原文。",
          code: "no_doc",
        },
        { status: 409 },
      );
    }
    const material = await getStore().getMaterial(record.materialId);
    const markdown = renderExplainerMarkdown(record.doc, {
      materialTitle: material?.title ?? "材料",
      materialHash: record.materialHash ?? material?.contentHash ?? "unknown",
      model: record.model,
      generatedAt: record.createdAt,
    });
    return new NextResponse(markdown, {
      status: 200,
      headers: {
        "content-type": "text/markdown; charset=utf-8",
        "content-disposition": `attachment; filename="explain-${record.id}.md"`,
        "cache-control": "private, no-store",
      },
    });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
