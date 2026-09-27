import { SESSION_COOKIE, sessionFromCookieValue, userFromSession } from "@/lib/auth/session";
import type { UserRecord } from "@/lib/db/types";
import { UnauthorizedError } from "@/lib/errors";

type CookieCarrier = {
  cookies: { get(name: string): { value: string } | undefined };
};

/** 路由处理器里解析当前用户（不依赖 next/headers，便于测试直接调用）。 */
export async function userFromRequest(request: CookieCarrier): Promise<UserRecord | null> {
  const session = sessionFromCookieValue(request.cookies.get(SESSION_COOKIE)?.value);
  if (!session) return null;
  return userFromSession(session);
}

export async function requireUserFromRequest(request: CookieCarrier): Promise<UserRecord> {
  const user = await userFromRequest(request);
  if (!user) throw new UnauthorizedError();
  return user;
}
