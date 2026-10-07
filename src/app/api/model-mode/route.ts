import { NextResponse, type NextRequest } from "next/server";
import { requireUserFromRequest } from "@/lib/auth/request";
import { getStore } from "@/lib/db";
import { toErrorResponse, ValidationError } from "@/lib/errors";
import { readByok } from "@/lib/services/byok";
import { creditBalanceMilli } from "@/lib/services/credits";

/**
 * 切换模型来源。
 *
 * 切到「自己的 Key」时先检查 Key 是否配好：让错误停在切换这一步，
 * 而不是等到用户点了「生成试卷」才发现没有 Key。
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireUserFromRequest(request);
    const body = (await request.json().catch(() => ({}))) as { mode?: unknown };
    const mode = body.mode;
    if (mode !== "platform" && mode !== "byok") {
      throw new ValidationError("模型来源只能是 platform 或 byok");
    }
    if (mode === "byok" && !readByok(user)) {
      throw new ValidationError("还没有配置模型 Key，先填写 Key 再切换");
    }

    await getStore().setUserModelMode(user.id, mode);
    return NextResponse.json({
      modelMode: mode,
      creditsMilli: await creditBalanceMilli(user.id),
    });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
