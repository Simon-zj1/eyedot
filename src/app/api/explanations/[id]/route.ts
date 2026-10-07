import { NextResponse, type NextRequest } from "next/server";
import { requireUserFromRequest } from "@/lib/auth/request";
import { toErrorResponse } from "@/lib/errors";
import { EXPLAINER_CSP } from "@/lib/security/html-sandbox";
import { getExplanationForUser } from "@/lib/services/explain";

export const runtime = "nodejs";

/**
 * 单独把这个图解的 HTML 发出去，供界面用 <iframe sandbox> 内嵌。
 *
 * 不做成页面的一部分，是因为它是一份由模型生成、含内联样式的完整文档；
 * 用独立响应 + CSP sandbox，能把它关在唯一源里——即使里面混进了脚本，
 * 也读不到本站的 Cookie，也发不出请求。
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUserFromRequest(request);
    const { id } = await context.params;
    const record = await getExplanationForUser(user, id);
    return new NextResponse(record.html, {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "content-security-policy": EXPLAINER_CSP,
        "x-content-type-options": "nosniff",
        "cache-control": "private, no-store",
      },
    });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
