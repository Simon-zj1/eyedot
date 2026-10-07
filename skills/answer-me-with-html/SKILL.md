---
name: answer-me-with-html
description: >-
  把一个知识点做成一页单文件 HTML 图解（抽象概念给类比、流程给步骤、算法给具体例子）。
  只在用户明确要求「用图文讲一下 / 画个图 / 出一页 / 可视化讲解」时使用，不要主动附页。
  本仓库里它有两个执行入口：命令行 `npx eyedot explain` 与网页端「一页图解」。
---

# 一页图解（answer-me-with-html）

这个 skill 在本仓库里的形态是**能力，不是另一个 CLI**：
生成逻辑写在 [`src/lib/explain/prompt.ts`](../../src/lib/explain/prompt.ts)，
内容契约在 [`src/lib/explain/schema.ts`](../../src/lib/explain/schema.ts)，
渲染器在 [`src/lib/explain/render.ts`](../../src/lib/explain/render.ts)，
清洗与沙箱写在 [`src/lib/security/html-sandbox.ts`](../../src/lib/security/html-sandbox.ts)，
命令行入口是 `eyedot explain`，网页入口是材料页的「一页图解」。

原始形态是 Codex/Claude Code 里的 `answer-me-with-html` skill（自带 `am` 渲染器，带主题、面板与自动校验）。
这里保留它的**内容规则**，因为它要解决的是同一个问题：一页纸讲清一个概念，而不是把答案摊成流量。

## 什么时候产出一页

满足任意一条就值得出页：≥3 个相互关联的概念、有流程/协议/状态流转、有跨 ≥3 个维度的比较、有层级或时间演进。
否则用普通文字回答就够了——**不要为了出页而出页**。

只在用户要求时使用（"用 HTML 讲一下"、"画个图"、"可视化讲解"、"没看懂，给我看一页"）；
用户要纯文本时不要附页。

## 内容规则（提示词里已经写死，这里说明为什么）

1. **模型只输出内容 JSON，HTML 由我们的渲染器生成**（`kind` 取 prose / steps / flow / compare / code / callout）。
   这样单文件自包含、离线可读、移动端不横向滚动都是代码保证的，不靠模型自觉。
2. **先给结论**：第一屏就说清「这是什么、为什么重要」，后面才是证据。
3. **一个面板回答一个问题**；超过 8 个面板就拆页或砍掉。
4. **按信息的形状选讲法**：抽象概念 → 类比 + 边界；流程 → 步骤或思维导图；代码 → 逐行注释；算法 → 先说要解决哪类问题，再用一个例子走一遍。
5. **每个取自材料的说法标出处**（引出原句的前 12 个字），模型补充的内容必须标「补充」——
   这和报告里「材料原文 / 模型补充」是同一套规矩，不能只在报告里守。
6. **不编数据**：没有真实数字就不要画刻度；示意数据要写明是示意。
7. **一屏能读**：正文不小于 16px，不固定宽度、不横向滚动，手机上也能看。

## 执行

```bash
# 命令行：材料和知识点进去，单文件 HTML 出来
npx eyedot explain --material notes.md --topic "注意力机制为什么需要缩放" --out explain.html
```

网页端在材料页的「一页图解」：选知识点 → 生成 → 内嵌在 sandbox iframe 里看，也可以在新标签页打开保存。
两种入口共用同一套提示词与清洗，所以结果不会分叉。

## 安全前提（改这个 skill 时不要绕过）

- 材料是**不可信输入**：拼提示词前必须走 `scanMaterial()` 的 `promptText`。
- 模型产出是**不可信输出**：落库或写文件前必须走 `sanitizeExplainerHtml()`，页面再用 `EXPLAINER_CSP` 关进唯一源。
  正则清洗做不到完备，所以真正的防线是 CSP 的 `sandbox`——两层都要留。
- 平台额度调用要扣积分并记用量：走 `assertPlatformCallAllowed()` 与 `recordChatUsage()`，不要自己直连模型。

## 想要完整的 `am` 体验

原始 skill 自带排版引擎（主题、面板、视频、STE 校验）。需要那种效果时单独安装它：

```bash
npx skills add answer-me-with-html
```

它负责「排版与呈现」，本仓库负责「内容从材料里来、出处可核对、消耗算得清」。两者不冲突。
