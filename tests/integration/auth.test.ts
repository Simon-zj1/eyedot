import { afterEach, describe, expect, it } from "vitest";
import {
  loginWithCode,
  requestLoginCode,
  sessionFromCookieValue,
  userFromSession,
} from "@/lib/auth/session";
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

  it("新用户必须有邀请码；邀请码在验证码校验成功后再生效", async () => {
    const store = useMemoryStore();
    await expect(requestLoginCode("new@example.com")).rejects.toThrow(/邀请码/);

    await store.upsertInviteCode("AUTH-CODE", 1);
    const requested = await requestLoginCode("new@example.com", "AUTH-CODE");
    const result = await loginWithCode("new@example.com", requested.devCode!);
    expect(result.created).toBe(true);
    expect((await store.getInviteCode("AUTH-CODE"))?.usedCount).toBe(1);
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
});
