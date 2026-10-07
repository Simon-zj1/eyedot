import { NextResponse, type NextRequest } from "next/server";
import { requireUserFromRequest } from "@/lib/auth/request";
import { toErrorResponse, ValidationError } from "@/lib/errors";
import { rateLimitResponse } from "@/lib/http/rate-guard";
import { creditBalanceLabel, redeemCredits } from "@/lib/services/credits";

export async function POST(request: NextRequest) {
  try {
    const user = await requireUserFromRequest(request);
    // 兑换码可以被暴力猜（尤其面额大的），必须限流
    const limited = rateLimitResponse(request, "redeem");
    if (limited) return limited;

    const body = (await request.json().catch(() => ({}))) as { code?: unknown };
    if (typeof body.code !== "string") throw new ValidationError("请输入兑换码");

    const result = await redeemCredits(user, body.code);
    return NextResponse.json({
      amount: creditBalanceLabel(result.amountMilli),
      balance: creditBalanceLabel(result.balanceMilli),
    });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
