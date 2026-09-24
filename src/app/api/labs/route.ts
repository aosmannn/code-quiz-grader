import { NextResponse } from "next/server";
import { LAB_PRESETS, getLabPreset } from "@/lib/lab-presets";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (id) {
    const lab = getLabPreset(id);
    if (!lab) {
      return NextResponse.json({ error: "Unknown lab preset." }, { status: 404 });
    }
    return NextResponse.json({ lab });
  }
  return NextResponse.json({ labs: LAB_PRESETS });
}
