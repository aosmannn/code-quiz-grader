export type LabPreset = {
  id: string;
  title: string;
  courseHint: string;
  /** Short learning goals the quiz should emphasize */
  goals: string[];
  /** Symbols / keywords to prefer in questions */
  focus: string[];
  blurb: string;
};

export const LAB_PRESETS: LabPreset[] = [
  {
    id: "inheritance",
    title: "Lab 3 · Inheritance",
    courseHint: "CSc 1301 / 1302",
    goals: [
      "Why a subclass uses extends",
      "What super(...) does in a constructor",
      "What @Override means on a method",
      "What an overridden method returns",
    ],
    focus: ["extends", "super", "@Override", "getStudentClass"],
    blurb: "Subclassing, constructors, and overriding — students only upload.",
  },
  {
    id: "twos-complement",
    title: "Lab · Two’s complement & bits",
    courseHint: "CSc 1301",
    goals: [
      "Signed decimal vs bit pattern",
      "Why int8_t / uint8_t matter",
      "What %d vs %02X show",
    ],
    focus: ["int8_t", "uint8_t", "printf", "%d", "%02X"],
    blurb: "Signed values and hex bit patterns from their C file.",
  },
  {
    id: "basics",
    title: "Lab · Program basics",
    courseHint: "Any intro lab",
    goals: [
      "What the program is trying to do",
      "Key functions / methods in their upload",
      "One edge case a careful reader should notice",
    ],
    focus: [],
    blurb: "General understanding check grounded in whatever they upload.",
  },
];

export function getLabPreset(id: string | null | undefined): LabPreset | null {
  if (!id) return null;
  return LAB_PRESETS.find((l) => l.id === id) ?? null;
}

export function studentLinkForLab(labId: string, base = "http://127.0.0.1:43127") {
  return `${base.replace(/\/$/, "")}/try?lab=${encodeURIComponent(labId)}`;
}
