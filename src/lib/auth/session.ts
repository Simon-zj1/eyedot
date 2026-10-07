import { cookies } from "next/headers";
import { deliverLoginCode } from "@/lib/auth/mailer";
import { normalizeEmail, isValidEmail } from "@/lib/auth/email";
import {
  generateLoginCode,
  hashLoginCode,
  signSessionToken,
  verifyLoginCodeHash,
  verifySessionToken,
} from "@/lib/crypto";
import { bootstrapStore, getStore } from "@/lib/db";
import { env } from "@/lib/env";
import type { UserRecord } from "@/lib/db/types";
import { AppError, UnauthorizedError, ValidationError } from "@/lib/errors";
import { grantSignupCredits } from "@/lib/services/credits";

/**
 * 注册模式：open = 邮箱验证通过即可注册（默认）；invite = 仍要邀请码。
 *
 * 留这个开关是因为「开放注册」和「平台额度」叠在一起就是一台撒钱的机器：
 * 万一被刷，改环境变量就能立刻关闸，不需要回滚代码。
 */
export function registrationMode(): "open" | "invite" {
  return env("REGISTRATION_MODE")?.toLowerCase() === "invite" ? "invite" : "open";
}

export const SESSION_COOKIE = "eyedot_session";
/**
 * 改名前的会话 Cookie 名。
 *
 * 只换新名字会让改名当天所有在线的人凭空登出；旧名字只读不写，新会话一律写新名字，
 * 旧 Cookie 下次登录时自然被替换掉。清理时两个名字都要清，否则退出登录后会留下
 * 一条仍然能被读到的旧 Cookie。
 */
export const LEGACY_SESSION_COOKIE = "jev_session";
export const SESSION_COOKIE_NAMES = [SESSION_COOKIE, LEGACY_SESSION_COOKIE] as const;

/** 先读新 Cookie，读不到再读改名前的旧 Cookie。 */
export function readSessionCookie(cookies: {
  get(name: string): { value: string } | undefined;
}): string | undefined {
  return cookies.get(SESSION_COOKIE)?.value ?? cookies.get(LEGACY_SESSION_COOKIE)?.value;
}
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const LOGIN_CODE_TTL_SECONDS = 10 * 60;
const MAX_LOGIN_CODE_ATTEMPTS = 5;

export type Session = {
  userId: string;
  email: string;
  sessionVersion: number;
};

/**
 * 认证提供方抽象。
 *
 * MVP 默认实现是「邀请码 + 邮箱」的签名 Cookie 会话（无需外部服务即可运行）。
 * 要换成 Supabase Auth（邮箱 OTP + RLS），只需实现同一个接口并在 resolveAuthProvider 里替换，
 * 业务代码与路由都不需要改动。
 */
export interface AuthProvider {
  readonly id: string;
  getSession(cookieValue: string | undefined): Session | null;
  createSessionCookieValue(session: Session): string;
}

export class SignedCookieAuthProvider implements AuthProvider {
  readonly id = "signed-cookie";

  getSession(cookieValue: string | undefined): Session | null {
    if (!cookieValue) return null;
    const payload = verifySessionToken<Session & { exp?: number }>(cookieValue);
    if (!payload?.userId || typeof payload.sessionVersion !== "number") return null;
    return {
      userId: payload.userId,
      email: payload.email,
      sessionVersion: payload.sessionVersion,
    };
  }

  createSessionCookieValue(session: Session): string {
    return signSessionToken(
      {
        userId: session.userId,
        email: session.email,
        sessionVersion: session.sessionVersion,
      },
      SESSION_TTL_SECONDS,
    );
  }
}

export function resolveAuthProvider(): AuthProvider {
  return new SignedCookieAuthProvider();
}

export type LoginResult = { user: UserRecord; created: boolean; cookieValue: string };
export type RequestLoginCodeResult = {
  email: string;
  expiresAt: Date;
  provider: "webhook" | "resend" | "console";
  devCode?: string;
};

export function createSessionForUser(user: UserRecord): string {
  return resolveAuthProvider().createSessionCookieValue({
    userId: user.id,
    email: user.email,
    sessionVersion: user.sessionVersion,
  });
}

/**
 * 第一步：请求登录验证码。
 *
 * 已有用户也需要邮箱验证码。新用户在 open 模式下直接放行，
 * 邀请码变成「可选，填了多送积分」；invite 模式下才必须提供。
 * 无论哪种模式，邀请码都要等到验证码校验成功后才真正消费，避免「请求了但没登录」白白浪费。
 */
export async function requestLoginCode(
  email: string,
  inviteCode?: string,
): Promise<RequestLoginCodeResult> {
  if (!isValidEmail(email)) throw new ValidationError("邮箱格式不正确");
  const store = getStore();
  await bootstrapStore(store);
  const normalized = normalizeEmail(email);

  const existing = await store.getUserByEmail(normalized);
  const normalizedInvite = inviteCode?.trim().toUpperCase() ?? null;
  if (!existing && normalizedInvite) {
    const invite = await store.getInviteCode(normalizedInvite);
    if (!invite || invite.usedCount >= invite.maxUses || (invite.expiresAt && invite.expiresAt < new Date())) {
      throw new AppError("邀请码无效、已过期或已用完", 403, "invite_invalid");
    }
  }
  if (!existing && !normalizedInvite && registrationMode() === "invite") {
    throw new ValidationError("当前是邀请制，首次使用需要邀请码");
  }

  const code = generateLoginCode();
  const expiresAt = new Date(Date.now() + LOGIN_CODE_TTL_SECONDS * 1000);
  await store.createLoginChallenge({
    email: normalized,
    codeHash: hashLoginCode(normalized, code),
    inviteCode: existing ? null : normalizedInvite,
    expiresAt,
  });

  const delivery = await deliverLoginCode(normalized, code);
  return {
    email: normalized,
    expiresAt,
    provider: delivery.provider,
    devCode: delivery.devCode,
  };
}

/** 第二步：校验验证码，签发带会话版本的 Cookie。 */
export async function loginWithCode(email: string, code: string): Promise<LoginResult> {
  if (!isValidEmail(email)) throw new ValidationError("邮箱格式不正确");
  if (!/^\d{6}$/.test(code)) throw new ValidationError("验证码应为 6 位数字");

  const store = getStore();
  await bootstrapStore(store);
  const normalized = normalizeEmail(email);
  const challenge = await store.getLatestLoginChallenge(normalized);
  if (!challenge) throw new AppError("验证码不存在或已失效，请重新获取", 403, "code_invalid");
  if (challenge.expiresAt < new Date()) {
    await store.consumeLoginChallenge(challenge.id);
    throw new AppError("验证码已过期，请重新获取", 403, "code_expired");
  }
  if (challenge.attempts >= MAX_LOGIN_CODE_ATTEMPTS) {
    await store.consumeLoginChallenge(challenge.id);
    throw new AppError("验证码尝试次数过多，请重新获取", 429, "code_locked");
  }

  if (!verifyLoginCodeHash(normalized, code, challenge.codeHash)) {
    const attempts = await store.incrementLoginChallengeAttempts(challenge.id);
    if (attempts >= MAX_LOGIN_CODE_ATTEMPTS) {
      await store.consumeLoginChallenge(challenge.id);
    }
    throw new AppError("验证码不正确", 403, "code_invalid");
  }

  const consumed = await store.consumeLoginChallenge(challenge.id);
  if (!consumed) throw new AppError("验证码已被使用，请重新获取", 403, "code_used");

  let user = await store.getUserByEmail(normalized);
  let created = false;
  if (!user) {
    if (!challenge.inviteCode && registrationMode() === "invite") {
      throw new AppError("首次登录缺少邀请码，请重新获取验证码", 403, "invite_invalid");
    }
    if (challenge.inviteCode) {
      const inviteConsumed = await store.consumeInviteCode(challenge.inviteCode);
      if (!inviteConsumed) {
        throw new AppError("邀请码无效、已过期或已用完", 403, "invite_invalid");
      }
    }
    user = await store.createUser(normalized);
    created = true;
  }

  // 赠送注册额度。函数本身是幂等的（已有 grant 记录就跳过），
  // 所以「建号成功但发额度失败」的用户下次登录还能补上，不会凭空少一笔。
  await grantSignupCredits(user.id, {
    invited: created && Boolean(challenge.inviteCode),
  });

  return { user, created, cookieValue: createSessionForUser(user) };
}

export function sessionFromCookieValue(cookieValue: string | undefined): Session | null {
  return resolveAuthProvider().getSession(cookieValue);
}

export async function getCurrentUser(): Promise<UserRecord | null> {
  const cookieStore = await cookies();
  const session = sessionFromCookieValue(readSessionCookie(cookieStore));
  if (!session) return null;
  return userFromSession(session);
}

/** 校验会话版本，保证旧 Cookie 在“退出所有设备”或密钥轮换后立即失效。 */
export async function userFromSession(session: Session): Promise<UserRecord | null> {
  const user = await getStore().getUser(session.userId);
  if (!user || user.sessionVersion !== session.sessionVersion) return null;
  return user;
}

export async function requireCurrentUser(): Promise<UserRecord> {
  const user = await getCurrentUser();
  if (!user) throw new UnauthorizedError();
  return user;
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
    secure: process.env.NODE_ENV === "production",
  };
}
