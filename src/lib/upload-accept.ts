/** Shared upload allow-list for student file intake. */
export const SOURCE_ACCEPT =
  ".py,.js,.ts,.jsx,.tsx,.java,.c,.cpp,.cs,.go,.rb,.rs,.txt,.h,.pdf,.docx";

export const LEGACY_QUIZ_ACCEPT =
  ".py,.js,.ts,.jsx,.tsx,.java,.c,.cpp,.cs,.go,.rb,.rs,.txt,.html,.css,.php,.swift,.kt,.r,.m,.sh,.json,.xml,.yaml,.yml,.sql,.lua,.scala,.h,.pdf,.docx";

const DOC_EXTS = new Set(["pdf", "docx"]);
const TEXT_EXTS = new Set([
  "py",
  "js",
  "ts",
  "jsx",
  "tsx",
  "java",
  "c",
  "cpp",
  "cs",
  "go",
  "rb",
  "rs",
  "txt",
  "h",
  "html",
  "css",
  "php",
  "swift",
  "kt",
  "r",
  "m",
  "sh",
  "json",
  "xml",
  "yaml",
  "yml",
  "sql",
  "lua",
  "scala",
]);

export function fileExt(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

export function isDocumentUpload(name: string, mime = ""): boolean {
  const ext = fileExt(name);
  if (DOC_EXTS.has(ext)) return true;
  if (mime === "application/pdf") return true;
  if (
    mime ===
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  )
    return true;
  return false;
}

export function isAllowedUpload(
  name: string,
  mime = "",
  mode: "source" | "legacy" = "source",
): boolean {
  const ext = fileExt(name);
  if (DOC_EXTS.has(ext) || isDocumentUpload(name, mime)) return true;
  if (mode === "legacy") return TEXT_EXTS.has(ext) || ext === "";
  // source mode: core programming + txt
  const core = new Set([
    "py",
    "js",
    "ts",
    "jsx",
    "tsx",
    "java",
    "c",
    "cpp",
    "cs",
    "go",
    "rb",
    "rs",
    "txt",
    "h",
  ]);
  return core.has(ext);
}
