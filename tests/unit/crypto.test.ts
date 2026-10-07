import {
  createCipheriv,
  createHmac,
  randomBytes,
  scryptSync,
} from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  decryptSecret,
  encryptSecret,
  signSessionToken,
  verifyLoginCodeHash,
  verifySessionToken,
} from "@/lib/crypto";

/**
 * 这个文件守的是「改名不伤数据」：产品从 jev-exam 改名成 eyedot 时，
 * 域分隔标签也跟着换了，但改名之前签发的会话、发出去的验证码、存好的 BYOK 密文
 * 必须继续解得开，否则一次改名就等于把用户踢下线并弄丢他们的密钥。
 */

// 测试环境没有 SESSION_SECRET，crypto.ts 会退回这个开发值（见 src/lib/crypto.ts）。
const DEV_SECRET = "dev-only-session-secret-do-not-use-in-production";

function legacySessionMac(data: string): string {
  return createHmac("sha256", scryptSync(DEV_SECRET, "jev-exam/session", 32))
    .update(data)
    .digest("base64url");
}

function legacyEncrypt(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(
    "aes-256-gcm",
    scryptSync(DEV_SECRET, "jev-exam/byok", 32),
    iv,
  );
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64url")}:${tag.toString("base64url")}:${ciphertext.toString("base64url")}`;
}

describe("会话令牌", () => {
  it("新签发的令牌可以验签", () => {
    const token = signSessionToken({ userId: "u1" }, 3600);
    expect(verifySessionToken<{ userId: string }>(token)?.userId).toBe("u1");
  });

  it("改名之前签发的令牌仍然验得过", () => {
    const data = Buffer.from(
      JSON.stringify({ userId: "u1", exp: Math.floor(Date.now() / 1000) + 3600 }),
    ).toString("base64url");
    const token = `${data}.${legacySessionMac(data)}`;
    expect(verifySessionToken<{ userId: string }>(token)?.userId).toBe("u1");
  });

  it("签名被改过的令牌一律拒绝", () => {
    const token = signSessionToken({ userId: "u1" }, 3600);
    const [data] = token.split(".");
    expect(verifySessionToken(`${data}.${legacySessionMac("别的数据")}`)).toBeNull();
  });

  it("过期的令牌不再放行", () => {
    const token = signSessionToken({ userId: "u1" }, -10);
    expect(verifySessionToken(token)).toBeNull();
  });
});

describe("BYOK 密钥的加解密", () => {
  it("新写入的密文能解回原文", () => {
    expect(decryptSecret(encryptSecret("sk-live-1234"))).toBe("sk-live-1234");
  });

  it("改名之前写入的密文仍然解得开", () => {
    expect(decryptSecret(legacyEncrypt("sk-old-5678"))).toBe("sk-old-5678");
  });

  it("不是 v1 格式或密文被改动的一律返回 null，而不是抛异常", () => {
    expect(decryptSecret("v2:a:b:c")).toBeNull();
    expect(decryptSecret("乱码")).toBeNull();
    const tampered = encryptSecret("sk-live-1234").slice(0, -4) + "AAAA";
    expect(decryptSecret(tampered)).toBeNull();
  });
});

describe("登录验证码哈希", () => {
  it("新哈希验得过", () => {
    const hash = createHmac("sha256", scryptSync(DEV_SECRET, "eyedot/session", 32))
      .update("a@b.com:123456")
      .digest("base64url");
    expect(verifyLoginCodeHash("a@b.com", "123456", hash)).toBe(true);
  });

  it("改名之前发出的验证码哈希仍然验得过", () => {
    const hash = createHmac("sha256", scryptSync(DEV_SECRET, "jev-exam/session", 32))
      .update("a@b.com:123456")
      .digest("base64url");
    expect(verifyLoginCodeHash("a@b.com", "123456", hash)).toBe(true);
  });

  it("验证码不对就是不对", () => {
    const hash = createHmac("sha256", scryptSync(DEV_SECRET, "eyedot/session", 32))
      .update("a@b.com:123456")
      .digest("base64url");
    expect(verifyLoginCodeHash("a@b.com", "000000", hash)).toBe(false);
  });
});
