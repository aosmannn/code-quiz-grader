import { NextResponse } from "next/server";
import { getOllamaStatus } from "@/lib/ollama";

export const runtime = "nodejs";

export async function GET() {
  const status = await getOllamaStatus();
  return NextResponse.json(status);
}
