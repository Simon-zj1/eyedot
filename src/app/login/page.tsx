import { redirect } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import { TopBar } from "@/components/top-bar";
import { getCurrentUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect("/");

  return (
    <>
      <TopBar user={null} />
      <main className="shell" style={{ maxWidth: 520, paddingTop: 40 }}>
        <div className="card">
          <h1>邀请制登录</h1>
          <p className="muted small">
            已有账号和新账号都要先获取邮箱验证码；新账号的邀请码在验证码请求时填写。
            登录态使用 HttpOnly 签名 Cookie，并带服务端会话版本，密钥不会下发到浏览器。
          </p>
          <LoginForm />
        </div>
        <div className="card card--flat small muted">
          <strong>为什么需要邀请码？</strong>
          <p style={{ marginTop: 8 }}>
            出题与判定都会消耗平台成本，邀请制 + 每日额度先把预算与滥用控制住。
            如果你在设置里填入自己的密钥（BYOK），这部分调用不占平台额度。
          </p>
        </div>
      </main>
    </>
  );
}
