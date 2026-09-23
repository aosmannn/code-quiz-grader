import { NextResponse } from "next/server";
import { readLtiSession, clearLtiSession } from "@/lib/lti/session";
import { getPublicToolRegistration } from "@/lib/lti/config";

export const runtime = "nodejs";

export async function GET() {
  const session = await readLtiSession();
  return NextResponse.json({
    session,
    registration: getPublicToolRegistration(),
  });
}

export async function DELETE() {
  await clearLtiSession();
  return NextResponse.json({ ok: true });
}
