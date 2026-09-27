import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";

export type LoginCodeDelivery = {
  provider: "webhook" | "resend" | "console";
  /** 仅本地开发/测试返回，生产环境绝不会下发到浏览器 */
  devCode?: string;
};

export type EmailDeliveryMode = "webhook" | "resend" | "console" | "none";

/** 供健康检查阅读：只返回模式，不返回任何密钥或地址。 */
export function emailDeliveryMode(): EmailDeliveryMode {
  if (env("AUTH_EMAIL_WEBHOOK_URL")) return "webhook";
  if (env("RESEND_API_KEY") && env("AUTH_EMAIL_FROM")) return "resend";
  if (process.env.NODE_ENV !== "production" || env("AUTH_DEV_MODE") === "1") return "console";
  return "none";
}

function subject(): string {
  return "登录验证码";
}

function textFor(code: string): string {
  return [
    `你的登录验证码是：${code}`,
    "",
    "验证码 10 分钟内有效，只能使用一次。",
    "如果这不是你本人的操作，可以忽略这封邮件。",
  ].join("\n");
}

async function postJson(url: string, body: unknown, headers: Record<string, string> = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 200);
    throw new AppError(`登录邮件发送失败：${response.status} ${detail}`, 502, "email_failed");
  }
}

/**
 * 发送登录验证码。
 *
 * 生产环境必须配置以下任一通道：
 * - AUTH_EMAIL_WEBHOOK_URL（可选 AUTH_EMAIL_WEBHOOK_TOKEN）：POST 一个简单 JSON，便于接国内邮件服务；
 * - RESEND_API_KEY + AUTH_EMAIL_FROM：直接调用 Resend。
 *
 * 本地开发与测试允许控制台输出，便于无邮件服务时跑通；生产环境不会回退到明文控制台。
 */
export async function deliverLoginCode(
  email: string,
  code: string,
): Promise<LoginCodeDelivery> {
  const mode = emailDeliveryMode();
  if (mode === "webhook") {
    const webhookUrl = env("AUTH_EMAIL_WEBHOOK_URL")!;
    const token = env("AUTH_EMAIL_WEBHOOK_TOKEN");
    await postJson(
      webhookUrl,
      { to: email, subject: subject(), text: textFor(code), code },
      token ? { Authorization: `Bearer ${token}` } : {},
    );
    return { provider: "webhook" };
  }

  if (mode === "resend") {
    const resendKey = env("RESEND_API_KEY")!;
    const from = env("AUTH_EMAIL_FROM")!;
    await postJson(
      "https://api.resend.com/emails",
      { from, to: email, subject: subject(), text: textFor(code) },
      { Authorization: `Bearer ${resendKey}` },
    );
    return { provider: "resend" };
  }

  if (mode === "console") {
    console.info(`[auth] ${email} 的登录验证码：${code}`);
    return { provider: "console", devCode: code };
  }

  throw new AppError(
    "登录邮件服务尚未配置，请联系管理员配置 AUTH_EMAIL_WEBHOOK_URL 或 RESEND_API_KEY。",
    503,
    "email_unavailable",
  );
}
