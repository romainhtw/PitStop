import { NextRequest, NextResponse } from "next/server";

// Routes that bypass auth entirely (have their own HMAC verification)
const WEBHOOK_PATHS = /^\/api\/(billing\/webhook|shopify\/webhooks)/;
// Static assets, Next.js internals
const PUBLIC_PATHS = /^\/(_next|favicon\.ico|logo\.png|public)/;
// The login page and its API endpoint
const AUTH_PATHS = /^\/(login|api\/auth)/;

// Use Web Crypto API (available in Edge runtime) instead of Node's crypto
async function sha256hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function cookieValid(cookieValue: string | undefined, pin: string): Promise<boolean> {
  if (!cookieValue) return false;
  const expected = await sha256hex(pin);
  return cookieValue === expected;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Always allow: webhooks (own HMAC), static, auth routes
  if (WEBHOOK_PATHS.test(pathname)) return NextResponse.next();
  if (PUBLIC_PATHS.test(pathname)) return NextResponse.next();
  if (AUTH_PATHS.test(pathname)) return NextResponse.next();

  // If no PITSTOP_PIN is configured, allow all (dev mode / env not set yet)
  const pin = process.env.PITSTOP_PIN;
  if (!pin) return NextResponse.next();

  const cookie = req.cookies.get("pitstop_auth")?.value;
  if (await cookieValid(cookie, pin)) return NextResponse.next();

  // API routes → 401 JSON (don't redirect — client fetch would silently fail)
  if (pathname.startsWith("/api/")) {
    return new NextResponse(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Page routes → redirect to login
  const loginUrl = req.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.searchParams.set("from", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
