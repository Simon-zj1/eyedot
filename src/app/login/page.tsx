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
          <h1>注册 / 登录</h1>
          <p className="muted small">
            填邮箱获取验证码即可注册或登录，不需要密码。注册即送 300 积分体验额度
            （约 30 万 token 等值），用完后可以兑换积分，或在设置里换成自己的模型 Key。
            登录态使用 HttpOnly 签名 Cookie，并带服务端会话版本，密钥不会下发到浏览器。
          </p>
          <LoginForm />
        </div>
        <div className="card card--flat small muted">
          <strong>两种用模型的方式</strong>
          <p style={{ marginTop: 8 }}>
            一是用平台额度（消耗积分，按官方价 1.5 倍计费，不用去申请任何 Key）；
            二是填自己的模型 Key（BYOK），调用直接走你的账号，平台不扣积分。
            邀请码不再是入场券，只是一个额外的额度加成。
          </p>
        </div>
      </main>
    </>
  );
}
