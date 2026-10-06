# 运营与故障处理（MVP 阶段）

这份文档只讲「现在怎么做」，不引入尚未发生的复杂基建。等真实用户量起来，再按最后一节升级。

## 1. 数据库选择：Neon

当前没有真实用户、没有生产数据，选择 **Neon Free Tier** 起步，够用且能自动休眠省成本：

| 维度 | 决定 |
| --- | --- |
| 档位 | Free Tier（约 0.5 GB 存储、自动休眠） |
| 连接方式 | 应用走 Vercel 注入的 pooled 连接；本地迁移/`pg_dump` 用 unpooled 连接 |
| 迁移 | `npm run db:migrate`（生产）或 `npm run db:push`（仅本地/预览） |
| 升级触发 | 出现真实用户、需要 PITR 备份、免费档存储接近上限，或冷启动影响体验时 |
| 升级目标 | Neon Launch（付费）并开启 **Point-in-Time Recovery** 与 **branch backups** |

不要在生产长期用 `db:push --force`。正式数据一旦出现，只允许通过 `drizzle/migrations` 的
`db:migrate` 变更结构；`db:push` 只给本地和 Preview 用。

### 早期 `db:push` 数据库的 baseline

如果你接手的是“以前只用 `db:push` 建过表、没有 `drizzle.__drizzle_migrations` 历史”的数据库，
直接跑 `db:migrate` 会从 `0000` 重放并失败。正确顺序是先 baseline 已存在的迁移，再跑增量：

1. 备份数据库；
2. 比对当前表结构与 `drizzle/` 迁移快照，确认已存在的是哪几个版本；
3. 把这些版本的 `tag/hash/when` 写入 `drizzle.__drizzle_migrations`（hash = 对应 SQL 文件的
   SHA-256），只写入真实已应用到的版本；
4. 再执行 `npm run db:migrate`，让后续增量迁移正常应用。

本轮线上库就属于这种情况：先 baseline `0000–0003`，再应用 `0004` 之后的迁移。不要把
“全新库迁移”和“既有库 baseline”混成同一条操作。

## 2. 备份

Neon 的数据库级备份依赖控制台开启 PITR。应用层面每个用户随时可在“设置 → 导出完整备份”拿到
自己的 JSON；但那不是平台级灾难恢复。

拿到 unpooled `DATABASE_URL` 后，平台级逻辑备份可以用 `pg_dump`：

```bash
set -a; source /tmp/jev-prod.env; set +a
pg_dump "$DATABASE_URL_UNPOOLED" --no-owner --clean \
  --file="jev-exam-$(date +%F-%H%M).sql"
```

建议频率：每周一次，升级为付费档后由 Neon 的 PITR 覆盖更短窗口。

## 3. 监控与告警

最小监控是 `GET /api/health`：

```bash
npm run healthcheck -- https://exam.simon-zj.top
```

它会失败当且仅当：

- 接口不可达；
- 数据层不是 Postgres；
- 登录邮件通道未配置（`auth.emailDelivery=none`）；
- 判定引擎退化为离线词面引擎；若使用 `llm-judge` 基线则只警告，不判失败；
- 判定或出题引擎掉进离线演示模式（这是线上“分数很怪”最常见的根因）。

建议接入 Vercel 的 Cron（每 5 分钟一次）或 UptimeRobot / Better Stack，失败时给自己发邮件。
成本异常看两条：

1. 平台级每日消费熔断（`src/lib/config.ts` 的 `PLATFORM_DAILY_SPEND_CAP_MICRO_USD`，默认 $10）。
2. 模型服务商自己的 usage 告警；平台内“今日成本”是估算，不等于账单。

## 4. Staging / Preview

继续用 Vercel Preview + 独立 Neon 分支：

- Preview 环境必须有独立的 `DATABASE_URL`（可以是 Neon 分支或独立 Free 项目）；
- 不要把生产 `SESSION_SECRET` 复制给 Preview；轮换生产密钥会同时把 BYOK 密文作废。

当前会话是「签名 Cookie + 用户会话版本」，可以在设置页点“退出所有设备”让旧 Cookie 立即失效。
若怀疑 `SESSION_SECRET` 泄露，立即：

1. 在 Vercel 更新 `SESSION_SECRET` 并重新部署；
2. 告知受影响的 BYOK 用户重新填写密钥（旧密文无法用新派生密钥解密）；
3. 在日志/告警中确认没有继续异常调用。

## 5. 错误追踪与日志

MVP 先不引入 Sentry。所有可预期错误都转成 `AppError` 的中文 `code`（`toErrorResponse`），
排查时优先看：

- `/api/health` 的 engine/ store 状态；
- 用户在设置页看到的“测试连接”结果；
- Vercel 的 Function Logs 里按 request id 与 `code` 过滤。

## 6. 什么时候升级

出现以下任一情况，再进入更正式的运营阶段：

- 开始有真实注册用户或平台 Key 成本可见；
- 需要按用户隔离地恢复单份数据（开启 Neon PITR）；
- 需要跨实例限流（把进程内限流换成 Upstash/Vercel WAF）；
- 需要撤回单台设备会话（引入数据库会话表或 Supabase Auth）。
