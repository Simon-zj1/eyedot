import { NextResponse, type NextRequest } from "next/server";
import { requireUserFromRequest } from "@/lib/auth/request";
import { toErrorResponse, ValidationError } from "@/lib/errors";
import { rateLimitResponse } from "@/lib/http/rate-guard";
import {
  createExplanation,
  isExplanationStale,
  listExplanations,
} from "@/lib/services/explain";
import { getMaterialForUser } from "@/lib/services/materials";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * 就这份材料里的一个知识点生成一页图解。
 *
 * 返回 sanitize.removed 而不是假装「原文照搬」：模型产出被清洗过这件事，
 * 用户有权知道（也可能据此判断这份图能不能直接用）。
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const limited = rateLimitResponse(request, "generate");
    if (limited) return limited;

    const user = await requireUserFromRequest(request);
    const { id } = await context.params;
    const body = (await request.json()) as { topic?: unknown };
    if (typeof body.topic !== "string") throw new ValidationError("请先选择要讲解的知识点");

    const result = await createExplanation(user, id, body.topic);
    return NextResponse.json({
      explanation: {
        id: result.explanation.id,
        topic: result.explanation.topic,
        model: result.explanation.model,
      },
      sanitized: result.sanitize.removed,
      ungroundedPanels: result.ungrounded,
      mode: result.mode,
    });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUserFromRequest(request);
    const { id } = await context.params;
    const material = await getMaterialForUser(user, id);
    const explanations = await listExplanations(user, id);
    return NextResponse.json({
      explanations: explanations.map((record) => ({
        id: record.id,
        topic: record.topic,
        model: record.model,
        createdAt: record.createdAt,
        materialVersion: record.materialHash?.slice(0, 8) ?? null,
        stale: isExplanationStale(record, material),
      })),
    });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
