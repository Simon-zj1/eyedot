"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function RevokeSessionsButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  return (
    <div>
      <button
        type="button"
        className="pill"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          setMessage(null);
          const response = await fetch("/api/auth/revoke", { method: "POST" });
          if (!response.ok) {
            const body = (await response.json().catch(() => ({}))) as { error?: string };
            setMessage(body.error ?? "退出失败，请稍后重试。");
            setPending(false);
            return;
          }
          router.replace("/login");
          router.refresh();
        }}
      >
        {pending ? "处理中…" : "退出所有设备"}
      </button>
      {message ? <p className="small muted">{message}</p> : null}
    </div>
  );
}
