import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";

export type ExtractResult = {
  name: string;
  content: string;
  kind: "pdf" | "docx" | "text";
};

function cleanText(raw: string): string {
  return raw
    .replace(/\r\n/g, "\n")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/-- \d+ of \d+ --/g, "")
    .trim();
}

export async function extractPdfText(
  buffer: Buffer,
  fileName: string,
): Promise<ExtractResult> {
  const parser = new PDFParse({ data: buffer });
  const result = await parser.getText();
  const content = cleanText(result.text || "");
  if (!content) {
    throw new Error(
      "This PDF has no readable text — try a text PDF or paste the code.",
    );
  }
  return { name: fileName, content, kind: "pdf" };
}

export async function extractDocxText(
  buffer: Buffer,
  fileName: string,
): Promise<ExtractResult> {
  const result = await mammoth.extractRawText({ buffer });
  const content = cleanText(result.value || "");
  if (!content) {
    throw new Error(
      "This Word file has no readable text — try exporting to PDF/TXT or paste the code.",
    );
  }
  return { name: fileName, content, kind: "docx" };
}

export async function extractDocument(
  buffer: Buffer,
  fileName: string,
  mime = "",
): Promise<ExtractResult> {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".pdf") || mime === "application/pdf") {
    return extractPdfText(buffer, fileName);
  }
  if (
    lower.endsWith(".docx") ||
    mime ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return extractDocxText(buffer, fileName);
  }
  throw new Error("Unsupported document type. Use PDF, DOCX, or a source file.");
}
