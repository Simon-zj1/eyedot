import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAMES } from "@/lib/auth/session";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  for (const name of SESSION_COOKIE_NAMES) {
    response.cookies.set(name, "", { path: "/", maxAge: 0 });
  }
  return response;
}
