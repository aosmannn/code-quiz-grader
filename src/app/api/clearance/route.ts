import { NextResponse } from "next/server";
import {
  fingerprintFiles,
  listRecentClearances,
  lookupClearance,
  saveClearance,
  type ClearanceRecord,
} from "@/lib/clearance-store";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  if (code) {
    const row = await lookupClearance(code);
    if (!row) {
      return NextResponse.json({ error: "No clearance for that code." }, { status: 404 });
    }
    return NextResponse.json({ clearance: row });
  }
  const recent = await listRecentClearances(50);
  return NextResponse.json({ clearances: recent });
}

type PostBody = {
  code: string;
  userName?: string;
  userId?: string;
  courseTitle?: string;
  assignmentTitle?: string;
  labId?: string | null;
  fileNames?: string[];
  files?: { name: string; content: string }[];
  understandingPct?: number;
  mode?: "ags" | "stub";
  isDevSim?: boolean;
  submittedAt?: string;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as PostBody;
    if (!body.code || typeof body.code !== "string") {
      return NextResponse.json({ error: "Missing clearance code." }, { status: 400 });
    }
    const files = Array.isArray(body.files) ? body.files : [];
    const fileNames =
      Array.isArray(body.fileNames) && body.fileNames.length
        ? body.fileNames
        : files.map((f) => f.name);

    const row: ClearanceRecord = {
      code: body.code.trim(),
      submittedAt: body.submittedAt || new Date().toISOString(),
      userName: body.userName?.trim() || "Student",
      userId: body.userId,
      courseTitle: body.courseTitle?.trim() || "Course",
      assignmentTitle: body.assignmentTitle?.trim() || "Understanding check",
      labId: body.labId ?? null,
      fileNames,
      fileFingerprint: files.length
        ? fingerprintFiles(files)
        : fingerprintFiles(fileNames.map((n) => ({ name: n, content: n }))),
      understandingPct:
        typeof body.understandingPct === "number" ? body.understandingPct : 100,
      mode: body.mode === "ags" ? "ags" : "stub",
      isDevSim: Boolean(body.isDevSim),
    };

    await saveClearance(row);
    return NextResponse.json({ clearance: row });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Save failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
