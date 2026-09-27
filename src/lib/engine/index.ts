import type { ByokConfig } from "@/lib/byok";
import { LexicalJudgeEngine } from "@/lib/engine/lexical";
import { LLMJudgeEngine } from "@/lib/engine/llm-judge";
import { TypeSafeEngine } from "@/lib/engine/typesafe";
import { resolveChatProvider, resolvePlatformChatProvider } from "@/lib/llm/provider";
import type { ChatUsageEvent } from "@/lib/llm/usage";
import type {
  DecideOptions,
  DecisionEngine,
  DecisionQuestion,
  DecisionResult,
} from "@/lib/types";

export type EngineMode = "byok" | "platform" | "offline";

export type EngineSelection = {
  engine: DecisionEngine;
  mode: EngineMode;
  /** 是否计入平台额度：byok 不计 */
  countsAgainstQuota: boolean;
};

export type EngineContext = {
  byok?: ByokConfig | null;
  /** 测试注入 */
  override?: DecisionEngine | null;
  /** 计量回调：LLM 判定基线也会产生 token 成本，必须一并记录 */
  onChatUsage?: (event: ChatUsageEvent) => void;
};

let globalOverride: DecisionEngine | null = null;

/**
 * 统一记录判定引擎的 usage。
 *
 * 之前的缺口是 TypeSafeEngine 明明返回了 usage，却没有接进成本表；
 * 出题和问答会记账，主观题判定这条最核心的路径反而不记账。
 */
class RecordingDecisionEngine implements DecisionEngine {
  readonly id: string;
  readonly inner: DecisionEngine;
  private readonly onUsage: (event: ChatUsageEvent) => void;

  constructor(inner: DecisionEngine, onUsage: (event: ChatUsageEvent) => void) {
    this.inner = inner;
    this.id = inner.id;
    this.onUsage = onUsage;
  }

  get model(): string {
    return this.inner.model;
  }

  async decide(
    state: string | Record<string, unknown>,
    questions: Record<string, DecisionQuestion>,
    options?: DecideOptions,
  ): Promise<DecisionResult> {
    const result = await this.inner.decide(state, questions, options);
    if (result.usage?.inputTokens || result.usage?.outputTokens) {
      this.onUsage({
        model: result.model,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
      });
    }
    return result;
  }
}

function recordDecisionUsage(
  engine: DecisionEngine,
  onUsage?: (event: ChatUsageEvent) => void,
): DecisionEngine {
  return onUsage ? new RecordingDecisionEngine(engine, onUsage) : engine;
}

/** 测试/评测专用：强制所有判定走同一个引擎。 */
export function setDecisionEngineOverride(engine: DecisionEngine | null): void {
  globalOverride = engine;
}

/**
 * 引擎选择顺序：
 * 1. 用户自带 Jev key（BYOK）
 * 2. 平台 TYPESAFE_API_KEY
 * 3. 平台出题模型的 LLM 判定（降级，供对比）
 * 4. 离线词面判定（仅演示，无任何密钥时）
 */
export function resolveDecisionEngine(context: EngineContext = {}): EngineSelection {
  if (context.override) {
    return { engine: context.override, mode: "offline", countsAgainstQuota: false };
  }
  if (globalOverride) {
    return { engine: globalOverride, mode: "offline", countsAgainstQuota: false };
  }

  const judge = context.byok?.judge;
  if (judge?.apiKey) {
    return {
      engine: recordDecisionUsage(
        new TypeSafeEngine({
          apiKey: judge.apiKey,
          baseUrl: judge.baseUrl,
          model: judge.model,
        }),
        context.onChatUsage,
      ),
      mode: "byok",
      countsAgainstQuota: false,
    };
  }

  const platform = TypeSafeEngine.fromEnv();
  if (platform) {
    return {
      engine: recordDecisionUsage(platform, context.onChatUsage),
      mode: "platform",
      countsAgainstQuota: true,
    };
  }

  const chatProvider = resolvePlatformChatProvider();
  if (chatProvider) {
    return {
      engine: recordDecisionUsage(new LLMJudgeEngine(chatProvider), context.onChatUsage),
      mode: "platform",
      countsAgainstQuota: true,
    };
  }

  return { engine: new LexicalJudgeEngine(), mode: "offline", countsAgainstQuota: false };
}

/** 用户自带出题模型。 */
export function resolveByokChatProvider(byok?: ByokConfig | null) {
  const llm = byok?.llm;
  if (!llm?.apiKey) return null;
  return resolveChatProvider(llm).provider;
}

export { LexicalJudgeEngine, LLMJudgeEngine, TypeSafeEngine };
