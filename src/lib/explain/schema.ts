import { z } from "zod";

/**
 * 一页图解的**内容契约**。
 *
 * 为什么不让模型直接写 HTML：那样每次生成的版式都不一样，手机上会不会横向滚动、
 * 字号会不会小到看不清、深浅色能不能读，全都靠运气；而且要在不可信 HTML 上做清洗和沙箱。
 * 换成「模型只产出这份 JSON，渲染器负责出 HTML」之后：
 * 版式稳定、可回归测试、内容天然被转义、同一份 JSON 还能再导出 Markdown。
 *
 * 这条和出题链路是同一个契约：模型产 JSON，脚本/渲染器负责把它变成人能看的东西。
 */

/** 面板里的材料出处：必须是材料里原样出现过的一段话，由 verifyExplainGrounding 校验。 */
const sourceSchema = z.string().min(4).max(400);

const panelBase = {
  /** 面板标题：一个面板只回答一个问题 */
  title: z.string().min(1).max(60),
  /** 取自材料的原句片段；没有就说明这块是模型补充 */
  source: sourceSchema.optional(),
  /** 模型自己加的内容，必须在页面上标出来（和报告里的「模型补充」同一套规矩） */
  added: z.boolean().optional(),
};

export const explainPanelSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("prose"),
    ...panelBase,
    /** 空行分段；以 "- " 开头的行渲染成列表 */
    body: z.string().min(1).max(2000),
  }),
  z.object({
    kind: z.literal("steps"),
    ...panelBase,
    steps: z.array(z.string().min(1).max(300)).min(1).max(12),
  }),
  z.object({
    kind: z.literal("flow"),
    ...panelBase,
    edges: z
      .array(
        z.object({
          from: z.string().min(1).max(60),
          to: z.string().min(1).max(60),
          label: z.string().max(60).optional(),
        }),
      )
      .min(1)
      .max(12),
  }),
  z.object({
    kind: z.literal("compare"),
    ...panelBase,
    columns: z.array(z.string().min(1).max(40)).min(2).max(4),
    rows: z.array(z.array(z.string().max(200)).min(2).max(4)).min(1).max(8),
  }),
  z.object({
    kind: z.literal("code"),
    ...panelBase,
    language: z.string().max(20).optional(),
    code: z.string().min(1).max(2000),
    /** 逐行或逐段说明，按顺序对应 */
    notes: z.array(z.string().max(200)).max(12).optional(),
  }),
  z.object({
    kind: z.literal("callout"),
    ...panelBase,
    tone: z.enum(["info", "ok", "warn", "err"]),
    body: z.string().min(1).max(800),
  }),
]);

export const explainDocSchema = z.object({
  title: z.string().min(1).max(80),
  subtitle: z.string().max(120).optional(),
  /** 第一屏的结论：这是什么、为什么值得看 */
  lead: z.string().max(600).optional(),
  panels: z.array(explainPanelSchema).min(1).max(8),
});

export type ExplainPanel = z.infer<typeof explainPanelSchema>;
export type ExplainDoc = z.infer<typeof explainDocSchema>;

/** 给提示词用的紧凑结构说明（模型看不到 zod schema，得用文字讲清）。 */
export const EXPLAIN_DOC_SHAPE = `{
  "title": "一问就能看懂的标题",
  "subtitle": "一句话补充（可选）",
  "lead": "第一屏结论：这是什么、为什么重要（可选）",
  "panels": [
    { "kind": "prose",   "title": "…", "body": "空行分段，行首 '- ' 变列表", "source": "材料原句片段（可选）" },
    { "kind": "steps",   "title": "…", "steps": ["第 1 步", "第 2 步"] },
    { "kind": "flow",    "title": "…", "edges": [{ "from": "A", "to": "B", "label": "触发条件" }] },
    { "kind": "compare", "title": "…", "columns": ["维度", "方案 A", "方案 B"], "rows": [["成本", "低", "高"]] },
    { "kind": "code",    "title": "…", "language": "ts", "code": "…", "notes": ["这行在做什么"] },
    { "kind": "callout", "title": "…", "tone": "info|ok|warn|err", "body": "结论或提醒" }
  ]
}`;
