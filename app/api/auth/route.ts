import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const { pin } = (await req.json()) as { pin?: string };

  const expectedPin = process.env.PITSTOP_PIN;
  if (!expectedPin) {
    return NextResponse.json({ error: "Auth not configured" }, { status: 500 });
  }
  if (!pin || pin !== expectedPin) {
    return NextResponse.json({ error: "Invalid PIN" }, { status: 401 });
  }

  const cookieValue = createHash("sha256").update(expectedPin).digest("hex");
  const from = req.nextUrl.searchParams.get("from") ?? "/dashboard";

  const res = NextResponse.json({ ok: true, redirect: from });
  res.cookies.set("pitstop_auth", cookieValue, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30, // 30 days
    path: "/",
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set("pitstop_auth", "", { maxAge: 0, path: "/" });
  return res;
}
