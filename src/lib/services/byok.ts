import { byokSummary, parseByok, type ByokConfig } from "@/lib/byok";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { getStore } from "@/lib/db";
import type { UserRecord } from "@/lib/db/types";
import { ValidationError } from "@/lib/errors";

export function readByok(user: UserRecord | null): ByokConfig | null {
  if (!user?.byokEncrypted) return null;
  const plaintext = decryptSecret(user.byokEncrypted);
  if (!plaintext) return null;
  try {
    return parseByok(JSON.parse(plaintext));
  } catch {
    return null;
  }
}

/**
 * 按用户选择的模型来源决定要不要用他自己的 Key。
 *
 * 关键差别是：**选了平台额度就不偷偷用他的 Key**。如果这里写成「有 Key 就用」，
 * 用户明明选了平台额度、打算花积分，账单却跑到他自己的账号上——这是最容易失去信任的一类 bug。
 */
export function byokForMode(user: UserRecord | null): ByokConfig | null {
  if (!user || user.modelMode === "platform") return null;
  return readByok(user);
}

/** 选了自带 Key 却还没配：明确报错，而不是悄悄回落到平台额度去扣他的积分。 */
export function assertByokConfigured(user: UserRecord): void {
  if (user.modelMode !== "byok") return;
  const byok = readByok(user);
  if (!byok?.llm && !byok?.judge) {
    throw new ValidationError(
      "你选择了使用自己的模型 Key，但还没有配置。去「设置」里填 Key，或把模型来源切回平台额度。",
    );
  }
}

export async function writeByok(userId: string, patch: Partial<ByokConfig>): Promise<ByokConfig> {
  const store = getStore();
  const user = await store.getUser(userId);
  const current = readByok(user) ?? {};
  const next: ByokConfig = {
    judge: patch.judge ?? current.judge,
    llm: patch.llm ?? current.llm,
  };
  await store.setUserByok(userId, encryptSecret(JSON.stringify(next)));
  return next;
}

export async function clearByok(userId: string): Promise<void> {
  await getStore().setUserByok(userId, null);
}

export function summarizeByok(value: ByokConfig | null) {
  return byokSummary(value);
}
