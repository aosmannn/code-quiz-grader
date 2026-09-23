/** Lightweight client-side scan of uploaded source for the Symbol Radar. */
export type RadarHit = {
  kind: "fn" | "type" | "format" | "import" | "const";
  label: string;
};

const FN_RE =
  /\b(?:def|function|fn|func|void|int|char|float|double|public|private|static)\s+([A-Za-z_][\w]*)\s*\(/g;
const C_FN_RE = /\b([A-Za-z_][\w]*)\s*\([^;]*\)\s*\{/g;
const TYPE_RE = /\b(int8_t|uint8_t|int16_t|uint16_t|int32_t|uint32_t|size_t|bool|String|List|dict|vector)\b/g;
const FORMAT_RE = /%[-+0#]*\d*(?:\.\d+)?[diouxXeEfFgGaAcspn%]/g;
const IMPORT_RE =
  /(?:^|\n)\s*(?:#include\s*[<"][^>"]+[>"]|import\s+[\w.]+|from\s+[\w.]+\s+import|using\s+[\w.]+)/g;
const CONST_RE = /\b(?:const|let|var|final)\s+([A-Za-z_][\w]*)/g;
const MAIN_RE = /\bmain\s*\(/;

function uniq(hits: RadarHit[], limit = 18): RadarHit[] {
  const seen = new Set<string>();
  const out: RadarHit[] = [];
  for (const h of hits) {
    const key = `${h.kind}:${h.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(h);
    if (out.length >= limit) break;
  }
  return out;
}

export function scanSymbols(
  files: { name: string; content: string }[],
): RadarHit[] {
  const hits: RadarHit[] = [];
  for (const f of files) {
    const text = f.content;
    if (MAIN_RE.test(text)) hits.push({ kind: "fn", label: "main" });

    for (const m of text.matchAll(FN_RE)) {
      if (m[1] && m[1] !== "if" && m[1] !== "for" && m[1] !== "while") {
        hits.push({ kind: "fn", label: m[1] });
      }
    }
    for (const m of text.matchAll(C_FN_RE)) {
      const name = m[1];
      if (
        name &&
        !["if", "for", "while", "switch", "return", "sizeof"].includes(name)
      ) {
        hits.push({ kind: "fn", label: name });
      }
    }
    for (const m of text.matchAll(TYPE_RE)) {
      hits.push({ kind: "type", label: m[1] });
    }
    for (const m of text.matchAll(FORMAT_RE)) {
      hits.push({ kind: "format", label: m[0] });
    }
    for (const m of text.matchAll(IMPORT_RE)) {
      const raw = m[0].trim().replace(/\s+/g, " ");
      hits.push({
        kind: "import",
        label: raw.length > 36 ? `${raw.slice(0, 34)}…` : raw,
      });
    }
    for (const m of text.matchAll(CONST_RE)) {
      hits.push({ kind: "const", label: m[1] });
    }

    // printf / print as signals even if not caught as defs
    if (/\bprintf\s*\(/.test(text)) hits.push({ kind: "fn", label: "printf" });
    if (/\bprint\s*\(/.test(text)) hits.push({ kind: "fn", label: "print" });
  }
  return uniq(hits);
}
