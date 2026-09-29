/** Browser helper: pull text from PDF/DOCX via /api/extract, else read as text. */
import {
  isAllowedUpload,
  isDocumentUpload,
} from "@/lib/upload-accept";

export type IngestedFile = {
  name: string;
  size: number;
  content: string;
};

export async function ingestUploadFile(
  file: File,
  mode: "source" | "legacy" = "source",
): Promise<IngestedFile> {
  if (!isAllowedUpload(file.name, file.type, mode)) {
    throw new Error(
      `Unsupported file type: ${file.name}. Use source code, .pdf, or .docx.`,
    );
  }

  if (isDocumentUpload(file.name, file.type)) {
    const body = new FormData();
    body.append("file", file, file.name);
    const res = await fetch("/api/extract", { method: "POST", body });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Could not extract text from that file.");
    }
    const content = String(data.content || "").trim();
    if (!content) {
      throw new Error(
        "This PDF has no readable text — try a text PDF or paste.",
      );
    }
    return {
      name: String(data.name || file.name),
      size: new TextEncoder().encode(content).length,
      content,
    };
  }

  const content = await file.text();
  if (!content.trim()) {
    throw new Error(`${file.name} is empty.`);
  }
  return { name: file.name, size: file.size, content };
}
