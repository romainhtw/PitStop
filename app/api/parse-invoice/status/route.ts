import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get("jobId");
  if (!jobId) {
    return NextResponse.json({ error: "Missing jobId" }, { status: 400 });
  }

  try {
    const { db } = await import("@/lib/firebase");
    const { doc, getDoc } = await import("firebase/firestore/lite");
    const snap = await getDoc(doc(db, "parseJobs", jobId));
    if (!snap.exists()) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }
    const data = snap.data() as {
      status: string;
      poId?: string;
      error?: string;
      createdAt?: string;
      completedAt?: string;
    };
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
