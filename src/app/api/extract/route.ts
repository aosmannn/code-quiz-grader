import { NextResponse } from "next/server";
import { extractDocument } from "@/lib/extract-document";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "Missing file. Upload a PDF or DOCX." },
        { status: 400 },
      );
    }
    const name = file.name || "document.pdf";
    const buf = Buffer.from(await file.arrayBuffer());
    if (buf.length === 0) {
      return NextResponse.json({ error: "Empty file." }, { status: 400 });
    }
    if (buf.length > 12 * 1024 * 1024) {
      return NextResponse.json(
        { error: "File too large (max 12 MB)." },
        { status: 400 },
      );
    }

    const extracted = await extractDocument(buf, name, file.type || "");
    return NextResponse.json({
      name: extracted.name,
      content: extracted.content,
      kind: extracted.kind,
      chars: extracted.content.length,
    });
  } catch (e) {
    const message =
      e instanceof Error
        ? e.message
        : "Could not read that file. Try a text PDF or paste.";
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
