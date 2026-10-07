"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Mode = "platform" | "byok";

/**
 * 模型来源二选一。
 *
 * 用显式选择而不是「有 Key 就用 Key」：用户选平台额度却把账单花到他自己账号上，
 * 是这类产品最容易失去信任的一种错。选错方向用户自己能看出来，前提是这个选项摆在明面上。
 */
export function ModelModeForm({
  initial,
  byokConfigured,
}: {
  initial: Mode;
  byokConfigured: boolean;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(initial);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function save(next: Mode): Promise<void> {
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/model-mode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: next }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(payload.error ?? "切换失败");
        return;
      }
      setMode(next);
      setMessage(next === "platform" ? "已切换到平台额度。" : "已切换到自己的模型 Key。");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <div className="field">
        <label>
          <input
            type="radio"
            name="model-mode"
            checked={mode === "platform"}
            disabled={pending}
            onChange={() => void save("platform")}
          />{" "}
          用平台额度（消耗积分，不用自己申请 Key）
        </label>
        <label style={{ marginTop: 8 }}>
          <input
            type="radio"
            name="model-mode"
            checked={mode === "byok"}
            disabled={pending}
            onChange={() => void save("byok")}
          />{" "}
          用我自己的模型 Key（不消耗积分）
        </label>
      </div>
      {!byokConfigured ? (
        <p className="small muted" style={{ marginTop: 8 }}>
          还没有填自己的 Key，所以第二个选项暂时切不过去。填好 Key 之后就能切。
        </p>
      ) : null}
      {message ? <div className="banner banner--info">{message}</div> : null}
      {error ? <div className="banner banner--err">{error}</div> : null}
    </>
  );
}
