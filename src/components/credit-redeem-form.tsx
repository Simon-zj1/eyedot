"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** 兑换码充值。v1 不做在线支付：转账后发码，用户在这里兑换。 */
export function CreditRedeemForm() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        setPending(true);
        setError(null);
        setMessage(null);
        try {
          const response = await fetch("/api/credits/redeem", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code }),
          });
          const payload = (await response.json()) as {
            error?: string;
            amount?: string;
            balance?: string;
          };
          if (!response.ok) {
            setError(payload.error ?? "兑换失败");
            return;
          }
          setCode("");
          setMessage(`已到账 ${payload.amount} 积分，当前余额 ${payload.balance} 积分。`);
          router.refresh();
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setPending(false);
        }
      }}
    >
      <div className="field">
        <label htmlFor="redeem-code">兑换码</label>
        <input
          id="redeem-code"
          type="text"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          placeholder="例如 ED-XXXX-XXXX"
          autoComplete="off"
        />
      </div>
      {message ? <div className="banner banner--info">{message}</div> : null}
      {error ? <div className="banner banner--err">{error}</div> : null}
      <button className="btn-primary" type="submit" disabled={pending || code.trim().length === 0}>
        {pending ? "兑换中…" : "兑换积分"}
      </button>
    </form>
  );
}
