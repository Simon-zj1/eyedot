import { NextResponse, type NextRequest } from "next/server";
import { requireUserFromRequest } from "@/lib/auth/request";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { toErrorResponse } from "@/lib/errors";
import { getStore } from "@/lib/db";

/**
 * 退出所有设备：会话版本 +1，之后旧 Cookie 全部失效。
 * 当前请求也会被清 Cookie 并跳回登录页。
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireUserFromRequest(request);
    await getStore().revokeUserSessions(user.id);
    const response = NextResponse.json({ ok: true });
    response.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
    return response;
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
