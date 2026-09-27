import { MemoryStore } from "@/lib/db/memory";
import { getStore, setStoreForTests } from "@/lib/db";
import { createSessionForUser } from "@/lib/auth/session";
import { setDecisionEngineOverride } from "@/lib/engine";
import { setGenerationProviderOverride } from "@/lib/generator";
import { setChatProviderOverride, type ChatProvider, type ChatRequest, type ChatResponse } from "@/lib/llm/provider";
import type { DecisionAnswer, DecisionEngine, DecisionQuestion, DecisionResult } from "@/lib/types";

export function useMemoryStore(): MemoryStore {
  const store = new MemoryStore(`test-${Math.random().toString(36).slice(2)}`);
  setStoreForTests(store);
  return store;
}

/**
 * 测试专用登录捷径。生产登录必须走邮箱验证码；这里只用来快速构造已登录用户，
 * 避免每个业务测试都重复跑一遍验证码流程。
 */
export async function loginWithInvite(email: string, inviteCode?: string) {
  const store = getStore();
  let user = await store.getUserByEmail(email);
  let created = false;
  if (!user) {
    if (!inviteCode) throw new Error("首次使用需要邀请码");
    const invite = await store.getInviteCode(inviteCode);
    if (!invite) throw new Error("邀请码无效、已过期或已用完");
    const consumed = await store.consumeInviteCode(inviteCode);
    if (!consumed) throw new Error("邀请码无效、已过期或已用完");
    user = await store.createUser(email);
    created = true;
  }
  return { user, created, cookieValue: createSessionForUser(user) };
}

export function resetOverrides(): void {
  setDecisionEngineOverride(null);
  setGenerationProviderOverride(null);
  setChatProviderOverride(null);
  setStoreForTests(null);
}

/**
 * 测试用对话模型：由回调决定返回的文本，用来构造「引注越界」「没有引注」等场景。
 */
export class FakeChatProvider implements ChatProvider {
  readonly id = "fake-chat";
  readonly model = "fake-chat-1.0.0";
  readonly origin: "byok" | "platform";
  calls: ChatRequest[] = [];
  private readonly responder: (request: ChatRequest) => string;

  constructor(responder: (request: ChatRequest) => string, origin: "byok" | "platform" = "platform") {
    this.responder = responder;
    this.origin = origin;
  }

  async complete(request: ChatRequest): Promise<ChatResponse> {
    this.calls.push(request);
    return { text: this.responder(request), model: this.model };
  }
}

/**
 * 测试用判定引擎：由回调决定每个问题的答案，方便构造“高置信 / 低置信 / 矛盾”等场景。
 */
export class FakeEngine implements DecisionEngine {
  readonly id = "fake-engine";
  readonly model = "fake-1.0.0";
  private readonly resolver: (
    state: string | Record<string, unknown>,
    questions: Record<string, DecisionQuestion>,
  ) => Record<string, DecisionAnswer>;
  calls = 0;

  constructor(
    resolver: (
      state: string | Record<string, unknown>,
      questions: Record<string, DecisionQuestion>,
    ) => Record<string, DecisionAnswer>,
  ) {
    this.resolver = resolver;
  }

  async decide(
    state: string | Record<string, unknown>,
    questions: Record<string, DecisionQuestion>,
  ): Promise<DecisionResult> {
    this.calls += 1;
    return {
      engineId: this.id,
      model: this.model,
      answers: this.resolver(state, questions),
      latencyMs: 3,
      raw: { fake: true },
    };
  }
}

export function noul(probability: number): DecisionAnswer {
  return { type: "noul", noul: probability };
}

export const SAMPLE_MATERIAL = [
  "光合作用分为光反应和暗反应两个阶段。",
  "光反应发生在类囊体薄膜上，需要光照，水在光下分解产生氧气和还原型辅酶Ⅱ。",
  "光反应把光能转变成活跃的化学能并储存在ATP中。",
  "暗反应发生在叶绿体基质中，不需要光照。",
  "暗反应中二氧化碳被固定后，利用光反应产生的ATP和还原型辅酶Ⅱ还原成糖类。",
  "暗反应把活跃的化学能转变成稳定的化学能。",
  "光合作用的整体意义是把无机物合成有机物，并把光能储存在有机物中。",
  "影响光合作用速率的外界因素包括光照强度、二氧化碳浓度和温度。",
].join("\n");
