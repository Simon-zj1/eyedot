import { afterEach, describe, expect, it } from "vitest";
import {
  loginWithCode,
  requestLoginCode,
  sessionFromCookieValue,
  userFromSession,
} from "@/lib/auth/session";
import { emailDeliveryMode } from "@/lib/auth/mailer";
import { INVITE_BONUS_CREDITS, SIGNUP_CREDIT_GRANT } from "@/lib/config";
import { resetOverrides, useMemoryStore } from "../helpers";

afterEach(() => resetOverrides());

describe("邮箱验证码登录", () => {
  it("已有用户也必须验证邮箱；错误验证码不能换取会话", async () => {
    const store = useMemoryStore();
    const user = await store.createUser("existing@example.com");

    const requested = await requestLoginCode("existing@example.com");
    expect(requested.devCode).toMatch(/^\d{6}$/);

    await expect(loginWithCode("existing@example.com", "000000")).rejects.toThrow(/验证码不正确/);

    const result = await loginWithCode("existing@example.com", requested.devCode!);
    expect(result.created).toBe(false);
    expect(result.user.id).toBe(user.id);
    const session = sessionFromCookieValue(result.cookieValue);
    expect(session?.sessionVersion).toBe(0);
    expect(await userFromSession(session!)).toMatchObject({ id: user.id });
  });

  it("开放注册：不带邀请码也能注册，并赠送注册积分", async () => {
    const store = useMemoryStore();
    const requested = await requestLoginCode("new@example.com");
    const result = await loginWithCode("new@example.com", requested.devCode!);
    expect(result.created).toBe(true);
    expect(await store.getCreditBalance(result.user.id)).toBe(SIGNUP_CREDIT_GRANT * 1_000);
  });

  it("邀请码是额度券：验证码校验成功后才消费，并额外送积分", async () => {
    const store = useMemoryStore();
    await store.upsertInviteCode("AUTH-CODE", 1);
    const requested = await requestLoginCode("invited@example.com", "AUTH-CODE");
    // 只是请求了验证码，还没登录，不能先扣掉名额
    expect((await store.getInviteCode("AUTH-CODE"))?.usedCount).toBe(0);

    const result = await loginWithCode("invited@example.com", requested.devCode!);
    expect(result.created).toBe(true);
    expect((await store.getInviteCode("AUTH-CODE"))?.usedCount).toBe(1);
    expect(await store.getCreditBalance(result.user.id)).toBe(
      (SIGNUP_CREDIT_GRANT + INVITE_BONUS_CREDITS) * 1_000,
    );
  });

  it("注册赠送是幂等的：重复登录不会反复发积分", async () => {
    const store = useMemoryStore();
    const first = await requestLoginCode("again@example.com");
    const created = await loginWithCode("again@example.com", first.devCode!);
    const second = await requestLoginCode("again@example.com");
    await loginWithCode("again@example.com", second.devCode!);
    expect(await store.getCreditBalance(created.user.id)).toBe(SIGNUP_CREDIT_GRANT * 1_000);
  });

  it("写着无效邀请码会被拒绝，但不妨碍直接注册", async () => {
    useMemoryStore();
    await expect(requestLoginCode("bad@example.com", "NO-SUCH-CODE")).rejects.toThrow(/邀请码/);
    await expect(requestLoginCode("bad@example.com")).resolves.toBeTruthy();
  });

  it("REGISTRATION_MODE=invite 时仍然要求邀请码（随时能关闸）", async () => {
    const store = useMemoryStore();
    const existing = await store.createUser("old@example.com");
    process.env.REGISTRATION_MODE = "invite";
    try {
      await expect(requestLoginCode("closed@example.com")).rejects.toThrow(/邀请码/);
      // 已有用户不受影响
      const requested = await requestLoginCode("old@example.com");
      const result = await loginWithCode("old@example.com", requested.devCode!);
      expect(result.user.id).toBe(existing.id);
    } finally {
      delete process.env.REGISTRATION_MODE;
    }
  });

  it("会话版本递增会让旧 Cookie 立即失效", async () => {
    const store = useMemoryStore();
    await store.upsertInviteCode("REVOKE-CODE", 1);
    const requested = await requestLoginCode("revoke@example.com", "REVOKE-CODE");
    const result = await loginWithCode("revoke@example.com", requested.devCode!);
    const session = sessionFromCookieValue(result.cookieValue);
    expect(session).not.toBeNull();

    await store.revokeUserSessions(result.user.id);
    expect(await userFromSession(session!)).toBeNull();
  });

  it("删除账号会清理该邮箱的登录挑战记录", async () => {
    const store = useMemoryStore();
    const user = await store.createUser("cleanup@example.com");
    await requestLoginCode("cleanup@example.com");
    expect(await store.getLatestLoginChallenge("cleanup@example.com")).not.toBeNull();

    await store.deleteUserData(user.id);
    expect(await store.getLatestLoginChallenge("cleanup@example.com")).toBeNull();
  });

  it("生产环境即使设置 AUTH_DEV_MODE 也不会下发控制台验证码", () => {
    const original = {
      nodeEnv: process.env.NODE_ENV,
      devMode: process.env.AUTH_DEV_MODE,
      webhook: process.env.AUTH_EMAIL_WEBHOOK_URL,
      resend: process.env.RESEND_API_KEY,
      from: process.env.AUTH_EMAIL_FROM,
    };
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    process.env.AUTH_DEV_MODE = "1";
    delete process.env.AUTH_EMAIL_WEBHOOK_URL;
    delete process.env.RESEND_API_KEY;
    delete process.env.AUTH_EMAIL_FROM;
    try {
      expect(emailDeliveryMode()).toBe("none");
    } finally {
      (process.env as Record<string, string | undefined>).NODE_ENV = original.nodeEnv;
      if (original.devMode === undefined) delete process.env.AUTH_DEV_MODE;
      else process.env.AUTH_DEV_MODE = original.devMode;
      if (original.webhook === undefined) delete process.env.AUTH_EMAIL_WEBHOOK_URL;
      else process.env.AUTH_EMAIL_WEBHOOK_URL = original.webhook;
      if (original.resend === undefined) delete process.env.RESEND_API_KEY;
      else process.env.RESEND_API_KEY = original.resend;
      if (original.from === undefined) delete process.env.AUTH_EMAIL_FROM;
      else process.env.AUTH_EMAIL_FROM = original.from;
    }
  });
});
