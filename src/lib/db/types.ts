import type { QuotaKind, QuestionType } from "@/lib/config";
import type { AnswerPayload } from "@/lib/grading";
import type { SourceMap } from "@/lib/ingest/types";
import type {
  AnswerKey,
  JudgmentMethod,
  JudgmentPenalty,
  JudgmentPoint,
  RubricPoint,
  Topic,
} from "@/lib/types";

export type ExamConfigRecord = {
  mix: Record<QuestionType, number>;
  count: number;
  topicIds: string[];
};

export type UserRecord = {
  id: string;
  email: string;
  byokEncrypted: string | null;
  modelMode: ModelMode;
  sessionVersion: number;
  createdAt: Date;
};

/** 模型来源：平台额度（扣积分）或用户自己的 Key。 */
export type ModelMode = "platform" | "byok";

export type InviteCodeRecord = {
  code: string;
  maxUses: number;
  usedCount: number;
  expiresAt: Date | null;
  createdAt: Date;
};

export type LoginChallengeRecord = {
  id: string;
  email: string;
  codeHash: string;
  inviteCode: string | null;
  expiresAt: Date;
  consumedAt: Date | null;
  attempts: number;
  createdAt: Date;
};

export type NewLoginChallenge = Omit<
  LoginChallengeRecord,
  "id" | "createdAt" | "consumedAt" | "attempts"
> & {
  attempts?: number;
};

export type MaterialRecord = {
  id: string;
  userId: string;
  title: string;
  rawText: string;
  tokenCount: number;
  contentHash: string;
  sourceMap: SourceMap | null;
  createdAt: Date;
};

export type NewMaterial = Omit<MaterialRecord, "id" | "createdAt" | "sourceMap"> & {
  sourceMap?: SourceMap | null;
};

export type BlueprintRecord = {
  id: string;
  materialId: string;
  version: number;
  topics: Topic[];
  generatorModel: string;
  createdAt: Date;
};

export type NewBlueprint = Omit<BlueprintRecord, "id" | "createdAt" | "version"> & {
  version?: number;
};

export type QuestionRecord = {
  id: string;
  materialId: string;
  blueprintId: string;
  topicId: string;
  topicTitle: string;
  type: QuestionType;
  stem: string;
  options: string[] | null;
  answerKey: AnswerKey;
  rubricPoints: RubricPoint[] | null;
  sourceAnchor: string;
  difficulty: string;
  explanation: string | null;
  createdAt: Date;
};

export type NewQuestion = Omit<QuestionRecord, "createdAt">;

export type ExamRecord = {
  id: string;
  userId: string;
  materialId: string;
  blueprintId: string;
  title: string;
  kind: "generated" | "mistake_retry";
  config: ExamConfigRecord;
  generatorModel: string;
  createdAt: Date;
};

export type NewExam = Omit<ExamRecord, "id" | "createdAt">;

export type AttemptRecord = {
  id: string;
  examId: string;
  userId: string;
  status: "in_progress" | "submitted";
  startedAt: Date;
  submittedAt: Date | null;
  scorePercent: number | null;
  needsReviewCount: number | null;
};

export type AnswerRecord = {
  id: string;
  attemptId: string;
  questionId: string;
  payload: AnswerPayload | null;
  createdAt: Date;
  updatedAt: Date;
};

export type JudgmentRecord = {
  id: string;
  answerId: string;
  attemptId: string;
  questionId: string;
  userId: string;
  method: JudgmentMethod;
  score: number;
  scorePercent: number;
  confidence: number;
  needsReview: boolean;
  reviewReasons: string[];
  points: JudgmentPoint[];
  penalties: JudgmentPenalty[];
  scoreLow: number | null;
  scoreHigh: number | null;
  engineId: string;
  model: string;
  latencyMs: number;
  request: unknown;
  response: unknown;
  createdAt: Date;
};

export type NewJudgment = Omit<JudgmentRecord, "id" | "createdAt">;

export type MasteryRecord = {
  userId: string;
  topicKey: string;
  topicTitle: string;
  value: number;
  sampleCount: number;
  updatedAt: Date;
};

export type MistakeRecord = {
  id: string;
  userId: string;
  questionId: string;
  materialId: string;
  topicKey: string;
  topicTitle: string;
  lastScorePercent: number;
  wrongCount: number;
  lastAttemptId: string;
  updatedAt: Date;
};

export type NewMistake = Omit<MistakeRecord, "id" | "updatedAt" | "wrongCount"> & {
  /** 追加一次错误；重考答对时传 false 表示修正记录 */
  increment?: boolean;
};

export type UsageSnapshot = Record<QuotaKind, number>;

export type ReviewItemRecord = {
  id: string;
  userId: string;
  questionId: string;
  materialId: string;
  topicKey: string;
  topicTitle: string;
  stability: number;
  difficulty: number;
  reps: number;
  lapses: number;
  state: "new" | "learning" | "review" | "relearning";
  dueAt: Date;
  lastReviewedAt: Date | null;
  lastScorePercent: number | null;
  lastRating: number | null;
  createdAt: Date;
  updatedAt: Date;
};

export type NewReviewItem = Omit<ReviewItemRecord, "id" | "createdAt" | "updatedAt">;

export type ReviewLogRecord = {
  id: string;
  userId: string;
  questionId: string;
  rating: number;
  scorePercent: number;
  stabilityBefore: number;
  difficultyBefore: number;
  stabilityAfter: number;
  difficultyAfter: number;
  elapsedDays: number;
  scheduledDays: number;
  reviewedAt: Date;
};

export type NewReviewLog = Omit<ReviewLogRecord, "id" | "reviewedAt"> & { reviewedAt?: Date };

/** 纠错上报的类型：用户认为哪里错了 */
export type FeedbackKind = "wrong_score" | "wrong_reference" | "bad_question" | "other";

export const FEEDBACK_KIND_LABEL: Record<FeedbackKind, string> = {
  wrong_score: "判定分数不对",
  wrong_reference: "参考答案不对",
  bad_question: "题目本身有问题",
  other: "其它问题",
};

/**
 * 上报时冻结的现场快照。
 * 判定逻辑会迭代，只留 questionId 的话，之后回看已经无法复原当时判了什么。
 */
export type FeedbackSnapshot = {
  materialTitle: string;
  questionType: string;
  stem: string;
  payload: AnswerPayload | null;
  scorePercent: number | null;
  needsReview: boolean;
  engineId: string | null;
  engineModel: string | null;
  referenceAnswer: string | null;
  points: { point_id: string; statement: string; probability: number; awarded: boolean }[];
};

export type FeedbackRecord = {
  id: string;
  userId: string;
  questionId: string;
  attemptId: string | null;
  kind: FeedbackKind;
  note: string | null;
  snapshot: FeedbackSnapshot;
  status: string;
  createdAt: Date;
};

export type NewFeedback = Omit<FeedbackRecord, "id" | "createdAt" | "status"> & {
  status?: string;
};

export type LlmUsageDelta = {
  calls?: number;
  inputTokens?: number;
  outputTokens?: number;
  costMicroUsd?: number;
};

export type LlmUsageOrigin = "platform" | "byok";

export type LlmUsageRecord = {
  model: string;
  origin: LlmUsageOrigin;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costMicroUsd: number;
};

export type CreditLedgerKind = "grant" | "bonus" | "redeem" | "spend" | "adjust";

export type CreditLedgerRecord = {
  id: string;
  userId: string;
  kind: CreditLedgerKind;
  /** 毫积分（1 积分 = 1000 毫积分），正数入账、负数出账 */
  amountMilli: number;
  balanceAfterMilli: number;
  ref: string | null;
  note: string | null;
  createdAt: Date;
};

export type NewCreditLedgerEntry = Omit<
  CreditLedgerRecord,
  "id" | "createdAt" | "balanceAfterMilli"
>;

export type RedemptionCodeRecord = {
  code: string;
  creditsMilli: number;
  maxUses: number;
  usedCount: number;
  expiresAt: Date | null;
  note: string | null;
  createdAt: Date;
};

export type NewRedemptionCode = Omit<RedemptionCodeRecord, "usedCount" | "createdAt"> & {
  usedCount?: number;
};

export type ExplanationRecord = {
  id: string;
  userId: string;
  materialId: string;
  topic: string;
  html: string;
  model: string;
  createdAt: Date;
};

export type NewExplanation = Omit<ExplanationRecord, "id" | "createdAt">;

export interface Store {
  /** 在同一个数据库事务里执行一组写操作；内存实现直接串行执行。 */
  transaction<T>(fn: (tx: Store) => Promise<T>): Promise<T>;

  createUser(email: string): Promise<UserRecord>;
  getUser(id: string): Promise<UserRecord | null>;
  getUserByEmail(email: string): Promise<UserRecord | null>;
  setUserByok(userId: string, encrypted: string | null): Promise<void>;
  /** 切换模型来源：平台额度 / 自己的 Key。 */
  setUserModelMode(userId: string, mode: ModelMode): Promise<void>;
  /** 让该用户所有已签发的会话失效（会话版本 +1）。 */
  revokeUserSessions(userId: string): Promise<void>;

  /** 当前积分余额（毫积分）。没有账目时返回 0。 */
  getCreditBalance(userId: string): Promise<number>;
  /**
   * 记一笔积分账并返回这一笔（含记完之后的余额）。
   * 余额由账本累加得出，所以写入必须与「读当前余额」在同一个事务里，
   * 否则并发扣费会写出两条口径不一致的 balanceAfter。
   */
  applyCreditDelta(entry: NewCreditLedgerEntry): Promise<CreditLedgerRecord>;
  listCreditLedger(userId: string, limit?: number): Promise<CreditLedgerRecord[]>;

  createRedemptionCodes(inputs: NewRedemptionCode[]): Promise<RedemptionCodeRecord[]>;
  getRedemptionCode(code: string): Promise<RedemptionCodeRecord | null>;
  /** 原子占用一次兑换码名额；已用完或过期返回 false。 */
  consumeRedemptionCode(code: string): Promise<boolean>;

  createExplanation(input: NewExplanation): Promise<ExplanationRecord>;
  getExplanation(id: string): Promise<ExplanationRecord | null>;
  listExplanationsByMaterial(materialId: string): Promise<ExplanationRecord[]>;

  upsertInviteCode(code: string, maxUses: number, expiresAt?: Date | null): Promise<InviteCodeRecord>;
  getInviteCode(code: string): Promise<InviteCodeRecord | null>;
  consumeInviteCode(code: string): Promise<boolean>;

  createLoginChallenge(input: NewLoginChallenge): Promise<LoginChallengeRecord>;
  getLatestLoginChallenge(email: string): Promise<LoginChallengeRecord | null>;
  incrementLoginChallengeAttempts(id: string): Promise<number>;
  consumeLoginChallenge(id: string): Promise<boolean>;

  createMaterial(input: NewMaterial): Promise<MaterialRecord>;
  getMaterial(id: string): Promise<MaterialRecord | null>;
  listMaterials(userId: string): Promise<MaterialRecord[]>;
  deleteMaterial(id: string, userId: string): Promise<boolean>;

  saveBlueprint(input: NewBlueprint): Promise<BlueprintRecord>;
  getBlueprintById(id: string): Promise<BlueprintRecord | null>;
  getBlueprintByMaterial(materialId: string): Promise<BlueprintRecord | null>;

  createQuestions(inputs: NewQuestion[]): Promise<QuestionRecord[]>;
  getQuestion(id: string): Promise<QuestionRecord | null>;
  getQuestions(ids: string[]): Promise<QuestionRecord[]>;
  listQuestionsByMaterial(materialId: string): Promise<QuestionRecord[]>;

  createExam(
    input: NewExam,
    questions: { questionId: string; position: number }[],
  ): Promise<ExamRecord>;
  getExam(id: string): Promise<ExamRecord | null>;
  listExams(userId: string): Promise<ExamRecord[]>;
  listExamQuestionIds(examId: string): Promise<string[]>;

  createAttempt(examId: string, userId: string): Promise<AttemptRecord>;
  getAttempt(id: string): Promise<AttemptRecord | null>;
  getOpenAttempt(examId: string, userId: string): Promise<AttemptRecord | null>;
  listAttemptsByUser(userId: string): Promise<AttemptRecord[]>;
  saveAnswer(
    attemptId: string,
    questionId: string,
    payload: AnswerPayload | null,
  ): Promise<AnswerRecord>;
  listAnswers(attemptId: string): Promise<AnswerRecord[]>;
  submitAttempt(
    id: string,
    summary: { scorePercent: number; needsReviewCount: number; submittedAt: Date },
  ): Promise<boolean>;

  saveJudgment(input: NewJudgment): Promise<JudgmentRecord>;
  getJudgmentByAnswer(answerId: string): Promise<JudgmentRecord | null>;
  listJudgmentsByAttempt(attemptId: string): Promise<JudgmentRecord[]>;

  applyMastery(
    userId: string,
    topicKey: string,
    topicTitle: string,
    score: number,
  ): Promise<MasteryRecord>;
  listMastery(userId: string): Promise<MasteryRecord[]>;

  upsertMistake(input: NewMistake): Promise<MistakeRecord>;
  listMistakes(userId: string): Promise<MistakeRecord[]>;
  deleteMistake(userId: string, questionId: string): Promise<boolean>;

  incrementUsage(userId: string, day: string, kind: QuotaKind, amount: number): Promise<number>;
  getUsage(userId: string, day: string): Promise<UsageSnapshot>;
  /**
   * 原子扣减每日次数额度：检查与自增在同一个数据库事务里完成。
   * 超限时不产生任何计数，返回具体是哪一类超限。
   */
  consumeUsage(
    userId: string,
    day: string,
    costs: Partial<Record<QuotaKind, number>>,
  ): Promise<{ allowed: boolean; exceeded?: QuotaKind; usage: UsageSnapshot }>;
  /** 回滚一笔已经占用的额度（例如生成了 10 题但最终只落库 7 题）。 */
  refundUsage(userId: string, day: string, costs: Partial<Record<QuotaKind, number>>): Promise<void>;

  incrementLlmUsage(
    userId: string,
    day: string,
    model: string,
    origin: LlmUsageOrigin,
    delta: LlmUsageDelta,
  ): Promise<LlmUsageRecord>;
  listLlmUsage(userId: string, day: string): Promise<LlmUsageRecord[]>;
  /** 平台级熔断用：当天所有用户的合计用量 */
  sumLlmUsageForDay(day: string, origin?: LlmUsageOrigin): Promise<LlmUsageDelta>;

  createFeedback(input: NewFeedback): Promise<FeedbackRecord>;
  /** userId 为 null 时返回全部用户的上报（供本地导出脚本用） */
  listFeedback(userId: string | null): Promise<FeedbackRecord[]>;

  /** 删除账号：连同该用户的全部派生数据一起删 */
  deleteUserData(userId: string): Promise<void>;

  upsertReviewItem(input: NewReviewItem): Promise<ReviewItemRecord>;
  getReviewItem(userId: string, questionId: string): Promise<ReviewItemRecord | null>;
  listReviewItems(userId: string): Promise<ReviewItemRecord[]>;
  listDueReviewItems(userId: string, dueBefore: Date, limit: number): Promise<ReviewItemRecord[]>;
  deleteReviewItem(userId: string, questionId: string): Promise<boolean>;
  saveReviewLog(input: NewReviewLog): Promise<ReviewLogRecord>;

  /** 测试与本地重置用 */
  reset(): Promise<void>;
}
