import { getStore } from "@/lib/db";
import type { AttemptRecord, JudgmentRecord, QuestionRecord, UserRecord } from "@/lib/db/types";
import { resolveDecisionEngine } from "@/lib/engine";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { gradeQuestion, type AnswerPayload } from "@/lib/grading";
import { topicKeyOf } from "@/lib/ids";
import { usageCollector } from "@/lib/llm/usage";
import { consumeQuota, refundQuota } from "@/lib/quota";
import { readByok } from "@/lib/services/byok";
import { getExamForUser } from "@/lib/services/generation";
import { toGeneratedQuestion } from "@/lib/services/questions";
import { syncReviewsFromAttempt } from "@/lib/services/reviews";
import { assertWithinSpendCap, recordChatUsage } from "@/lib/services/usage";
import type { AnswerKey, Judgment } from "@/lib/types";

const MISTAKE_THRESHOLD_PERCENT = 60;

export type SubmitAnswerInput = {
  questionId: string;
  payload: AnswerPayload | null;
};

export type SubmitResult = {
  attemptId: string;
  scorePercent: number;
  needsReviewCount: number;
  engineId: string;
  engineMode: "byok" | "platform" | "offline";
  judgedCount: number;
};

/** 逐题判定返回给前端的最小结果，用于把「判定过程」显示出来。 */
export type JudgeOneResult = {
  questionId: string;
  method: Judgment["method"];
  scorePercent: number;
  needsReview: boolean;
  reviewReasons: string[];
  engineId: string;
  model: string;
  latencyMs: number;
  points: Judgment["points"];
};

export async function startAttemptForUser(
  user: UserRecord,
  examId: string,
): Promise<AttemptRecord> {
  const exam = await getExamForUser(user, examId);
  const store = getStore();
  const open = await store.getOpenAttempt(exam.id, user.id);
  if (open) return open;
  return store.createAttempt(exam.id, user.id);
}

/**
 * 判定单题：落库作答与判定结果，并返回可立即展示的结论。
 * 拆出来是为了让界面能逐题显示进度——一次判 14 个得分点是并行的，
 * 没必要让用户盯着一个转圈等到全部结束。
 */
export async function judgeOneAnswerForUser(
  user: UserRecord,
  examId: string,
  questionId: string,
  payload: AnswerPayload | null,
): Promise<JudgeOneResult> {
  const exam = await getExamForUser(user, examId);
  const store = getStore();
  const questionIds = await store.listExamQuestionIds(exam.id);
  if (!questionIds.includes(questionId)) throw new NotFoundError("该题目不属于这份试卷");

  const question = await store.getQuestion(questionId);
  if (!question) throw new NotFoundError("题目不存在");

  const attempt = (await store.getOpenAttempt(exam.id, user.id)) ?? (await store.createAttempt(exam.id, user.id));

  const byok = readByok(user);
  const usage = usageCollector();
  const selection = resolveDecisionEngine({ byok, onChatUsage: usage.onChatUsage });
  const engine = selection.engine;

  const needsEngine = question.type === "short_answer" || question.type === "cloze";
  let judgmentQuotaReserved = false;
  if (selection.countsAgainstQuota && needsEngine) {
    await assertWithinSpendCap(user.id);
    await consumeQuota(user.id, { judgment: 1 });
    judgmentQuotaReserved = true;
  }

  const blueprint = await store.getBlueprintById(exam.blueprintId);
  const topicSpans = new Map<string, string>();
  for (const topic of blueprint?.topics ?? []) {
    topicSpans.set(topic.id, topic.source_spans.join("\n"));
  }

  let judgment;
  try {
    judgment = await gradeQuestion(toGeneratedQuestion(question), payload, {
      engine,
      materialExcerpt: topicSpans.get(question.topicId) ?? "",
    });
  } catch (error) {
    if (judgmentQuotaReserved) await refundQuota(user.id, { judgment: 1 });
    throw error;
  } finally {
    // 判定已经调用过模型就产生了成本，即便随后写库失败也要记账
    await recordChatUsage(user.id, usage.pending);
  }

  await store.transaction(async (tx) => {
    const answer = await tx.saveAnswer(attempt.id, question.id, payload);
    await tx.saveJudgment({
      answerId: answer.id,
      attemptId: attempt.id,
      questionId: question.id,
      userId: user.id,
      method: judgment.method,
      score: judgment.score,
      scorePercent: judgment.scorePercent,
      confidence: judgment.confidence,
      needsReview: judgment.needsReview,
      reviewReasons: judgment.reviewReasons,
      points: judgment.points,
      penalties: judgment.penalties,
      scoreLow: judgment.scoreRange?.[0] ?? null,
      scoreHigh: judgment.scoreRange?.[1] ?? null,
      engineId: judgment.engineId,
      model: judgment.model,
      latencyMs: judgment.latencyMs,
      request: {
        questionId: question.id,
        payload,
        materialExcerptLength: (topicSpans.get(question.topicId) ?? "").length,
      },
      response: judgment.raw ?? null,
    });
  });

  if (selection.countsAgainstQuota && !judgment.usedEngine && judgmentQuotaReserved) {
    await refundQuota(user.id, { judgment: 1 });
  }

  return {
    questionId: question.id,
    method: judgment.method,
    scorePercent: judgment.scorePercent,
    needsReview: judgment.needsReview,
    reviewReasons: judgment.reviewReasons,
    engineId: engine.id,
    model: judgment.model,
    latencyMs: judgment.latencyMs,
    points: judgment.points,
  };
}

/**
 * 收卷：把所有已判定题目的结果汇总，更新掌握度与错题本，写入最终分数。
 * 重复调用会直接返回已提交的结果，避免掌握度被重复计入。
 */
export async function finalizeAttemptForUser(
  user: UserRecord,
  examId: string,
): Promise<SubmitResult> {
  const exam = await getExamForUser(user, examId);
  const store = getStore();
  const questionIds = await store.listExamQuestionIds(exam.id);
  if (questionIds.length === 0) throw new NotFoundError("试卷中没有题目");

  /*
   * 收卷必须是一个事务：提交 attempt、更新掌握度、写错题、推进复习排期要么全部成功，
   * 要么全部回滚。否则并发请求会重复累计掌握度，部分失败会留下半套学习状态。
   */
  const finalized = await store.transaction(async (tx) => {
    const attempt = await tx.getOpenAttempt(exam.id, user.id);
    if (!attempt) return null;

    const questions = await tx.getQuestions(questionIds);
    const judgments = await tx.listJudgmentsByAttempt(attempt.id);
    if (judgments.length === 0) throw new ValidationError("还没有任何判定结果，请先提交作答");

    const averageScore = judgments.length
      ? Math.round(
          (judgments.reduce((sum, judgment) => sum + judgment.score, 0) / judgments.length) * 100,
        )
      : 0;
    const needsReviewCount = judgments.filter((judgment) => judgment.needsReview).length;

    // 条件更新只允许 in_progress -> submitted 一次；并发第二个请求会在这里拿到 false。
    const claimed = await tx.submitAttempt(attempt.id, {
      scorePercent: averageScore,
      needsReviewCount,
      submittedAt: new Date(),
    });
    if (!claimed) return null;

    const judgmentByQuestion = new Map(
      judgments.map((judgment) => [judgment.questionId, judgment]),
    );
    for (const question of questions) {
      const judgment = judgmentByQuestion.get(question.id);
      if (!judgment) continue;

      // 待复核的题目不计入掌握度，避免用不确定的分数误导用户。
      if (!judgment.needsReview) {
        await tx.applyMastery(
          user.id,
          topicKeyOf(question.topicTitle),
          question.topicTitle,
          judgment.score,
        );
      }

      if (judgment.scorePercent < MISTAKE_THRESHOLD_PERCENT) {
        await tx.upsertMistake({
          userId: user.id,
          questionId: question.id,
          materialId: question.materialId,
          topicKey: topicKeyOf(question.topicTitle),
          topicTitle: question.topicTitle,
          lastScorePercent: judgment.scorePercent,
          lastAttemptId: attempt.id,
          increment: true,
        });
      } else {
        await tx.deleteMistake(user.id, question.id);
      }
    }

    // 失分的题目进入复习队列；已在队列里的题目按本次结果推进排期
    await syncReviewsFromAttempt(user, attempt.id, tx);

    const engineId = judgments[0]?.engineId ?? "unknown";
    return {
      attemptId: attempt.id,
      scorePercent: averageScore,
      needsReviewCount,
      engineId,
      engineMode: engineId === "typesafe" ? "platform" : "offline",
      judgedCount: judgments.length,
    } satisfies SubmitResult;
  });

  if (finalized) return finalized;

  const submitted = (await store.listAttemptsByUser(user.id))
    .filter((entry) => entry.examId === exam.id && entry.status === "submitted")
    .sort((a, b) => (b.submittedAt?.getTime() ?? 0) - (a.submittedAt?.getTime() ?? 0))[0];
  if (submitted) {
    return {
      attemptId: submitted.id,
      scorePercent: submitted.scorePercent ?? 0,
      needsReviewCount: submitted.needsReviewCount ?? 0,
      engineId: "unknown",
      engineMode: "platform",
      judgedCount: questionIds.length,
    };
  }
  throw new NotFoundError("没有进行中的答题记录");
}

/** 一次性作答：逐题判定 + 收卷（HTTP 与 CLI 的兼容入口）。 */
export async function submitAttemptForUser(
  user: UserRecord,
  examId: string,
  answers: SubmitAnswerInput[],
): Promise<SubmitResult> {
  const exam = await getExamForUser(user, examId);
  const store = getStore();
  const questionIds = await store.listExamQuestionIds(exam.id);
  if (questionIds.length === 0) throw new NotFoundError("试卷中没有题目");

  const payloadMap = new Map(answers.map((answer) => [answer.questionId, answer.payload]));
  for (const questionId of questionIds) {
    await judgeOneAnswerForUser(user, exam.id, questionId, payloadMap.get(questionId) ?? null);
  }
  return finalizeAttemptForUser(user, exam.id);
}

export function answerKeyOfRecord(record: QuestionRecord): AnswerKey {
  return record.answerKey;
}

export async function getAttemptForUser(user: UserRecord, attemptId: string): Promise<AttemptRecord> {
  const attempt = await getStore().getAttempt(attemptId);
  if (!attempt) throw new NotFoundError("答题记录不存在");
  if (attempt.userId !== user.id) throw new ForbiddenError();
  return attempt;
}

export function assertAnswerShape(payload: unknown): AnswerPayload | null {
  if (payload === null || payload === undefined) return null;
  if (typeof payload !== "object") throw new ValidationError("作答格式不正确");
  const record = payload as Record<string, unknown>;
  switch (record.type) {
    case "mcq":
      return { type: "mcq", index: typeof record.index === "number" ? record.index : null };
    case "true_false":
      return { type: "true_false", value: typeof record.value === "boolean" ? record.value : null };
    case "cloze":
      return { type: "cloze", text: typeof record.text === "string" ? record.text : "" };
    case "short_answer":
      return { type: "short_answer", text: typeof record.text === "string" ? record.text : "" };
    default:
      throw new ValidationError("未知的作答类型");
  }
}
