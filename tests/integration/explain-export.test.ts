import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET as explanationRoute } from "@/app/api/explanations/[id]/route";
import { GET as markdownRoute } from "@/app/api/explanations/[id]/markdown/route";
import { SESSION_COOKIE, createSessionForUser } from "@/lib/auth/session";
import type { ExplainDoc } from "@/lib/explain/schema";
import { setChatProviderOverride } from "@/lib/llm/provider";
import { createExplanation, getExplanationForUser } from "@/lib/services/explain";
import { createMaterialForUser } from "@/lib/services/materials";
import {
  FakeChatProvider,
  SAMPLE_MATERIAL,
  loginWithInvite,
  resetOverrides,
  useMemoryStore,
} from "../helpers";

const DOC: ExplainDoc = {
  title: "对比：召回 vs 重排",
  panels: [
    {
      kind: "compare",
      title: "差别",
      columns: ["维度", "召回", "重排"],
      rows: [["规模", "几十到上百", "只对 10–50 条"]],
    },
    { kind: "code", title: "调用", language: "ts", code: "await rerank(cands)", notes: ["逐条重打分"] },
  ],
};

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

function request(path: string, cookie: string) {
  return new NextRequest(`http://localhost${path}`, { headers: { cookie } });
}

describe("图解的导出入口", () => {
  let store: ReturnType<typeof useMemoryStore>;
  let user: Awaited<ReturnType<typeof loginWithInvite>>["user"];
  let cookie: string;
  let materialId: string;

  beforeEach(async () => {
    store = useMemoryStore();
    user = (await loginWithInvite("explain-export@example.com")).user;
    cookie = `${SESSION_COOKIE}=${createSessionForUser(user)}`;
    const material = await createMaterialForUser(user, {
      title: "检索笔记",
      rawText: SAMPLE_MATERIAL,
    });
    materialId = material.id;
  });

  afterEach(() => resetOverrides());

  it("下载 HTML：作为附件返回，且仍带沙箱 CSP", async () => {
    setChatProviderOverride(new FakeChatProvider(() => JSON.stringify(DOC)), {
      countsAgainstQuota: true,
    });
    const created = await createExplanation(user, materialId, "召回与重排");
    const response = await explanationRoute(
      request(`/api/explanations/${created.explanation.id}?download=1`, cookie),
      params(created.explanation.id),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain("attachment");
    expect(response.headers.get("content-security-policy")).toContain("sandbox");
  });

  it("下载 Markdown：同一份内容 JSON 换渲染器，表格竖线被转义", async () => {
    setChatProviderOverride(new FakeChatProvider(() => JSON.stringify(DOC)), {
      countsAgainstQuota: true,
    });
    const created = await createExplanation(user, materialId, "召回与重排");
    const response = await markdownRoute(
      request(`/api/explanations/${created.explanation.id}/markdown`, cookie),
      params(created.explanation.id),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/markdown");
    const body = await response.text();
    expect(body).toContain("# 对比：召回 vs 重排");
    expect(body).toContain("| 维度 | 召回 | 重排 |");
    expect(body).toContain("```ts");
  });

  it("没有内容 JSON 的旧产物：Markdown 明确拒绝，而不是给一份空文件", async () => {
    const legacy = await store.createExplanation({
      userId: user.id,
      materialId,
      topic: "旧图解",
      doc: null,
      materialHash: "legacy",
      html: "<html>旧产物</html>",
      model: "deepseek-flash",
    });
    const response = await markdownRoute(
      request(`/api/explanations/${legacy.id}/markdown`, cookie),
      params(legacy.id),
    );
    expect(response.status).toBe(409);
    const payload = (await response.json()) as { code: string };
    expect(payload.code).toBe("no_doc");
    // HTML 仍然拿得到，用户不至于两头都丢
    const html = await explanationRoute(
      request(`/api/explanations/${legacy.id}`, cookie),
      params(legacy.id),
    );
    expect(html.status).toBe(200);
  });

  it("别人的图解拿不到（按用户隔离）", async () => {
    setChatProviderOverride(new FakeChatProvider(() => JSON.stringify(DOC)), {
      countsAgainstQuota: true,
    });
    const created = await createExplanation(user, materialId, "召回与重排");
    const other = (await loginWithInvite("someone-else@example.com")).user;
    const otherCookie = `${SESSION_COOKIE}=${createSessionForUser(other)}`;
    const response = await markdownRoute(
      request(`/api/explanations/${created.explanation.id}/markdown`, otherCookie),
      params(created.explanation.id),
    );
    expect(response.status).toBe(404);
    expect(await getExplanationForUser(user, created.explanation.id)).toBeTruthy();
  });
});
