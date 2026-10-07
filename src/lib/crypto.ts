import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomInt,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { env } from "@/lib/env";

const DEV_SECRET = "dev-only-session-secret-do-not-use-in-production";

function secret(): string {
  const configured = env("SESSION_SECRET");
  if (configured) return configured;
  // 构建阶段允许用开发值，避免 CI 为了编译而持有生产密钥；真正运行时必须显式配置。
  if (
    process.env.NODE_ENV === "production" &&
    process.env.NEXT_PHASE !== "phase-production-build"
  ) {
    throw new Error("生产环境必须设置 SESSION_SECRET，拒绝使用公开开发密钥。");
  }
  return DEV_SECRET;
}

function signingKey(): Buffer {
  return scryptSync(secret(), "eyedot/session", 32);
}

function encryptionKey(): Buffer {
  return scryptSync(secret(), "eyedot/byok", 32);
}

/**
 * 改名前的域分隔标签。
 *
 * 域分隔标签看着像内部实现，其实承载了数据：改名之前签发的会话 cookie、
 * 改名之前发出去的验证码哈希、以及用户已经存好的 BYOK 密文，全都是用旧标签派生出的
 * 密钥保护的。只换新标签而不认旧标签，等于改名当天把所有人踢下线、并把别人存好的
 * API Key 变成解不开的乱码——所以旧标签只读不写：新数据一律用新标签。
 */
function legacySigningKey(): Buffer {
  return scryptSync(secret(), "jev-exam/session", 32);
}

function legacyEncryptionKey(): Buffer {
  return scryptSync(secret(), "jev-exam/byok", 32);
}

/** 常数时间的字符串比较；用于验证码哈希这种不能提前返回的场景。 */
function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function macMatches(key: Buffer, data: string, mac: string): boolean {
  const expected = createHmac("sha256", key).update(data).digest("base64url");
  return constantTimeEqual(mac, expected);
}

export function signSessionToken(payload: Record<string, unknown>, ttlSeconds: number): string {
  const body = { ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds };
  const data = Buffer.from(JSON.stringify(body)).toString("base64url");
  const mac = createHmac("sha256", signingKey()).update(data).digest("base64url");
  return `${data}.${mac}`;
}

export function verifySessionToken<T = Record<string, unknown>>(token: string): T | null {
  const [data, mac] = token.split(".");
  if (!data || !mac) return null;

  // 新标签验不过再试旧标签（短路的 || 让常见路径仍然只派生一次密钥）。
  if (!macMatches(signingKey(), data, mac) && !macMatches(legacySigningKey(), data, mac)) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(data, "base64url").toString("utf8")) as T & {
      exp?: number;
    };
    if (typeof parsed.exp === "number" && parsed.exp * 1000 < Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** 生成 6 位数字验证码；使用 CSPRNG，避免 Math.random 的可预测性。 */
export function generateLoginCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/** 邮箱 + 验证码的 HMAC；只存哈希，不存明文验证码。 */
export function hashLoginCode(email: string, code: string): string {
  return createHmac("sha256", signingKey())
    .update(`${email.toLowerCase()}:${code}`)
    .digest("base64url");
}

export function verifyLoginCodeHash(email: string, code: string, expected: string): boolean {
  if (constantTimeEqual(hashLoginCode(email, code), expected)) return true;
  // 改名当天已经发出去的验证码是用旧标签哈希的，别让人输对了却登不进去。
  const legacy = createHmac("sha256", legacySigningKey())
    .update(`${email.toLowerCase()}:${code}`)
    .digest("base64url");
  return constantTimeEqual(legacy, expected);
}

/** AES-256-GCM 加密 BYOK 密钥，格式 v1:<iv>:<tag>:<ciphertext>（base64url）。 */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64url")}:${tag.toString("base64url")}:${ciphertext.toString("base64url")}`;
}

export function decryptSecret(payload: string): string | null {
  const parts = payload.split(":");
  if (parts.length !== 4 || parts[0] !== "v1") return null;
  const iv = Buffer.from(parts[1], "base64url");
  const tag = Buffer.from(parts[2], "base64url");
  const ciphertext = Buffer.from(parts[3], "base64url");
  // 先试新标签，再试改名前的标签：用户存好的密钥不能因为改名变成乱码。
  return (
    decryptWith(encryptionKey(), iv, tag, ciphertext) ??
    decryptWith(legacyEncryptionKey(), iv, tag, ciphertext)
  );
}

function decryptWith(key: Buffer, iv: Buffer, tag: Buffer, ciphertext: Buffer): string | null {
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export function maskSecret(value: string): string {
  if (value.length <= 8) return "****";
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}
