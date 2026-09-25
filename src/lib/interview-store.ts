import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { InterviewQuestion } from "@/lib/interview-ladder";
import type { UnderstandingMap } from "@/lib/understanding-map";
import type { EvalResult, ConceptStatus } from "@/lib/interview-eval";
import type { UnderstandingWeights } from "@/lib/interview-ladder";

export type AuditTurn = {
  questionId: string;
  isFollowUp: boolean;
  question: InterviewQuestion;
  studentResponse: string;
  evaluation: EvalResult;
  answeredAt: string;
};

export type InterviewSession = {
  id: string;
  createdAt: string;
  updatedAt: string;
  userName: string;
  courseTitle: string;
  assignmentTitle: string;
  assignmentSpec: string;
  labId?: string | null;
  fileNames: string[];
  map: UnderstandingMap;
  coreQuestions: InterviewQuestion[];
  /** Index into coreQuestions for the next unanswered core (0-based) */
  coreIndex: number;
  followUpsUsed: number;
  maxFollowUps: number;
  pendingFollowUp: InterviewQuestion | null;
  turns: AuditTurn[];
  /** best score per core question id */
  bestByQuestion: Record<string, number>;
  byWeight: Partial<Record<keyof UnderstandingWeights, number[]>>;
  conceptScores: Record<string, number>;
  status:
    | "in_progress"
    | "passed"
    | "needs_retry"
    | "instructor_review";
  scorePct: number | null;
  sufficient: boolean;
  threshold: number;
  breakdown: { key: string; label: string; pct: number }[] | null;
  concepts: ConceptStatus[] | null;
  clearanceCode?: string | null;
};

const mem = new Map<string, InterviewSession>();
const DATA_DIR = path.join(process.cwd(), ".data");
const DATA_FILE = path.join(DATA_DIR, "interviews.json");

let loaded = false;

async function loadDisk() {
  try {
    const raw = await readFile(DATA_FILE, "utf8");
    const list = JSON.parse(raw) as InterviewSession[];
    if (Array.isArray(list)) {
      for (const row of list) {
        if (row?.id) mem.set(row.id, row);
      }
    }
  } catch {
    /* first run */
  }
}

async function ensureLoaded() {
  if (loaded) return;
  await loadDisk();
  loaded = true;
}

async function persist() {
  await mkdir(DATA_DIR, { recursive: true });
  const list = [...mem.values()].sort((a, b) =>
    a.updatedAt < b.updatedAt ? 1 : -1,
  );
  await writeFile(DATA_FILE, JSON.stringify(list.slice(0, 200), null, 2), "utf8");
}

export function newSessionId() {
  return `iv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export async function saveInterview(
  row: InterviewSession,
): Promise<InterviewSession> {
  await ensureLoaded();
  row.updatedAt = new Date().toISOString();
  mem.set(row.id, row);
  await persist();
  return row;
}

export async function getInterview(
  id: string,
): Promise<InterviewSession | null> {
  await ensureLoaded();
  return mem.get(id) ?? null;
}

export async function listInterviews(
  limit = 40,
): Promise<InterviewSession[]> {
  await ensureLoaded();
  return [...mem.values()]
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
    .slice(0, limit);
}
