/** Sample program for one-click demo — no upload required. */
export const SAMPLE_PROGRAM = {
  name: "grade_book.py",
  content: `"""Simple grade book: store student scores and compute averages."""

from typing import Dict, List


class GradeBook:
    def __init__(self) -> None:
        self._scores: Dict[str, List[float]] = {}

    def add_score(self, student: str, score: float) -> None:
        if score < 0 or score > 100:
            raise ValueError("score must be between 0 and 100")
        self._scores.setdefault(student, []).append(score)

    def average(self, student: str) -> float:
        scores = self._scores.get(student)
        if not scores:
            raise KeyError(f"no scores for {student!r}")
        return sum(scores) / len(scores)

    def class_average(self) -> float:
        all_scores = [s for scores in self._scores.values() for s in scores]
        if not all_scores:
            return 0.0
        return sum(all_scores) / len(all_scores)

    def roster(self) -> List[str]:
        return sorted(self._scores.keys())


if __name__ == "__main__":
    book = GradeBook()
    book.add_score("Ada", 92)
    book.add_score("Ada", 88)
    book.add_score("Grace", 95)
    print(book.average("Ada"))
    print(book.class_average())
`,
};
