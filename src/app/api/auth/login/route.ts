import { NextResponse, type NextRequest } from "next/server";
import {
  SESSION_COOKIE,
  loginWithCode,
  requestLoginCode,
  sessionCookieOptions,
} from "@/lib/auth/session";
import { toErrorResponse } from "@/lib/errors";
import { rateLimitResponse } from "@/lib/http/rate-guard";

export async function POST(request: NextRequest) {
  try {
    // 登录是唯一不需要会话的写接口，必须限流，否则邀请码可以被无限次试
    const limited = rateLimitResponse(request, "login");
    if (limited) return limited;

    const body = (await request.json()) as {
      email?: string;
      inviteCode?: string;
      code?: string;
    };
    const email = body.email ?? "";
    const code = body.code?.trim() ?? "";

    // 没有 code 时只发验证码；有 code 时才真正校验并签发会话。
    if (!code) {
      const requested = await requestLoginCode(email, body.inviteCode);
      return NextResponse.json({
        requested: true,
        email: requested.email,
        expiresAt: requested.expiresAt,
        provider: requested.provider,
        // 仅本地开发返回，用于无邮件服务时联调；生产环境不会出现
        devCode: requested.devCode,
      });
    }

    const result = await loginWithCode(email, code);

    const response = NextResponse.json({
      user: { id: result.user.id, email: result.user.email },
      created: result.created,
    });
    response.cookies.set(SESSION_COOKIE, result.cookieValue, sessionCookieOptions());
    return response;
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
