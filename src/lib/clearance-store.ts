import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type ClearanceRecord = {
  code: string;
  submittedAt: string;
  userName: string;
  userId?: string;
  courseTitle: string;
  assignmentTitle: string;
  labId?: string | null;
  fileNames: string[];
  fileFingerprint: string;
  understandingPct: number;
  mode: "ags" | "stub";
  isDevSim?: boolean;
};

const mem = new Map<string, ClearanceRecord>();
const DATA_DIR = path.join(process.cwd(), ".data");
const DATA_FILE = path.join(DATA_DIR, "clearances.json");

async function loadDisk(): Promise<void> {
  try {
    const raw = await readFile(DATA_FILE, "utf8");
    const list = JSON.parse(raw) as ClearanceRecord[];
    if (Array.isArray(list)) {
      for (const row of list) {
        if (row?.code) mem.set(row.code.toLowerCase(), row);
      }
    }
  } catch {
    /* first run */
  }
}

let loaded = false;
async function ensureLoaded() {
  if (loaded) return;
  await loadDisk();
  loaded = true;
}

async function persist() {
  await mkdir(DATA_DIR, { recursive: true });
  const list = [...mem.values()].sort((a, b) =>
    a.submittedAt < b.submittedAt ? 1 : -1,
  );
  await writeFile(DATA_FILE, JSON.stringify(list.slice(0, 500), null, 2), "utf8");
}

export function fingerprintFiles(files: { name: string; content: string }[]) {
  const h = createHash("sha256");
  for (const f of files) {
    h.update(f.name);
    h.update("\0");
    h.update(f.content);
    h.update("\n");
  }
  return h.digest("hex").slice(0, 16);
}

export async function saveClearance(
  row: ClearanceRecord,
): Promise<ClearanceRecord> {
  await ensureLoaded();
  mem.set(row.code.toLowerCase(), row);
  await persist();
  return row;
}

export async function lookupClearance(
  code: string,
): Promise<ClearanceRecord | null> {
  await ensureLoaded();
  const key = code.trim().toLowerCase();
  if (!key) return null;
  return mem.get(key) ?? null;
}

export async function listRecentClearances(limit = 40): Promise<ClearanceRecord[]> {
  await ensureLoaded();
  return [...mem.values()]
    .sort((a, b) => (a.submittedAt < b.submittedAt ? 1 : -1))
    .slice(0, limit);
}
