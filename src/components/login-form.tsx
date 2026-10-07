"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [code, setCode] = useState("");
  const [codeRequested, setCodeRequested] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        setPending(true);
        setError(null);
        try {
          const response = await fetch("/api/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, inviteCode, code: codeRequested ? code : undefined }),
          });
          const payload = (await response.json()) as {
            error?: string;
            requested?: boolean;
            devCode?: string;
            provider?: string;
          };
          if (!response.ok) {
            setError(payload.error ?? "登录失败");
            return;
          }
          if (payload.requested) {
            setCodeRequested(true);
            setNotice(
              payload.devCode
                ? `验证码已生成（开发模式）：${payload.devCode}`
                : "验证码已发送到你的邮箱，10 分钟内有效。",
            );
            return;
          }
          router.replace("/");
          router.refresh();
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setPending(false);
        }
      }}
    >
      <div className="field">
        <label htmlFor="email">邮箱</label>
        <input
          id="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
        />
      </div>
      <div className="field">
        <label htmlFor="invite">邀请码（可选，填了多送 100 积分）</label>
        <input
          id="invite"
          type="text"
          value={inviteCode}
          onChange={(event) => setInviteCode(event.target.value)}
          placeholder="没有就留空"
          disabled={codeRequested}
        />
      </div>
      {codeRequested ? (
        <div className="field">
          <label htmlFor="code">邮箱验证码</label>
          <input
            id="code"
            type="text"
            required
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="6 位数字"
          />
        </div>
      ) : null}
      {notice ? <div className="banner banner--info">{notice}</div> : null}
      {error ? <div className="banner banner--err">{error}</div> : null}
      <button className="btn-primary" type="submit" disabled={pending}>
        {pending ? "处理中…" : codeRequested ? "验证并进入" : "获取登录验证码"}
      </button>
    </form>
  );
}
