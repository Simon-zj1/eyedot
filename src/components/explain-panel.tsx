"use client";

import { useState } from "react";

type ExplainSummary = {
  id: string;
  topic: string;
  model: string;
};

/**
 * 一页图解：选一个知识点，生成一页可以离线打开的 HTML。
 *
 * 内嵌用 <iframe sandbox>：模型产出的是完整 HTML 文档，只能关在唯一源里看，
 * 既不能读本站 Cookie，也不能跳转顶层页面（这一点和「判定可核对」是同一套思路：
 * 不确定的东西就把它关起来展示，而不是假装它一定安全）。
 */
export function ExplainPanel({
  materialId,
  topics,
  initial,
}: {
  materialId: string;
  topics: string[];
  initial: ExplainSummary[];
}) {
  const [items, setItems] = useState<ExplainSummary[]>(initial);
  const [current, setCurrent] = useState<string | null>(initial[0]?.id ?? null);
  const [topic, setTopic] = useState(topics[0] ?? "");
  const [notes, setNotes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function generate(): Promise<void> {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/materials/${materialId}/explain`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic }),
      });
      const payload = (await response.json()) as {
        error?: string;
        explanation?: ExplainSummary;
        sanitized?: string[];
      };
      if (!response.ok || !payload.explanation) {
        setError(payload.error ?? "生成失败");
        return;
      }
      setItems((prev) => [payload.explanation as ExplainSummary, ...prev]);
      setCurrent(payload.explanation.id);
      setNotes(payload.sanitized ?? []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <div className="field">
        <label htmlFor="explain-topic">要讲解的知识点</label>
        <input
          id="explain-topic"
          type="text"
          list="explain-topics"
          value={topic}
          onChange={(event) => setTopic(event.target.value)}
          placeholder="例如：注意力机制为什么需要缩放"
        />
        <datalist id="explain-topics">
          {topics.map((item) => (
            <option key={item} value={item} />
          ))}
        </datalist>
      </div>
      <button
        className="btn-primary"
        type="button"
        onClick={() => void generate()}
        disabled={pending || topic.trim().length === 0}
      >
        {pending ? "生成中…（约 10–30 秒）" : "生成一页图解"}
      </button>

      {error ? <div className="banner banner--err">{error}</div> : null}
      {notes.length > 0 ? (
        <p className="small muted" style={{ marginTop: 12 }}>
          为安全起见，生成结果里的{notes.join("、")}已被去掉。
        </p>
      ) : null}

      {items.length > 1 ? (
        <div className="row" style={{ marginTop: 16, flexWrap: "wrap", gap: 8 }}>
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`btn btn--quiet${item.id === current ? " btn--active" : ""}`}
              onClick={() => setCurrent(item.id)}
            >
              {item.topic}
            </button>
          ))}
        </div>
      ) : null}

      {current ? (
        <>
          <iframe
            key={current}
            src={`/api/explanations/${current}`}
            sandbox=""
            title="一页图解"
            style={{
              width: "100%",
              height: 640,
              marginTop: 16,
              border: "1px solid var(--line, #e3e6eb)",
              borderRadius: 12,
              background: "#fff",
            }}
          />
          <p className="small muted">
            这份图解由模型生成，标「模型补充」的内容不在你的材料里。单文件、可离线：{" "}
            <a href={`/api/explanations/${current}`} target="_blank" rel="noopener noreferrer">
              新标签页打开
            </a>
            {" · "}
            <a href={`/api/explanations/${current}?download=1`}>下载 HTML</a>
            {" · "}
            <a href={`/api/explanations/${current}/markdown`}>下载 Markdown</a>
            。
          </p>
        </>
      ) : null}
    </>
  );
}
