export const COURSE_PASSING_GRADE = 6;
export const COURSE_GRADE_RULE_VERSION = "course-grade-v1-pass-6";

export type CourseGradeResult = "approved" | "rejected";

export type CourseGradeEvaluation = {
  grade: number;
  passingGrade: number;
  result: CourseGradeResult;
  ruleVersion: string;
};

export function normalizeCourseGrade(value: unknown): number {
  const parsed = parseCourseGrade(value);
  if (parsed === null) {
    throw Object.assign(new Error("Nota inválida. Informe um número válido."), { statusCode: 400 });
  }
  if (parsed < 0 || parsed > 10) {
    throw Object.assign(new Error("Nota inválida. Informe um número entre 0 e 10."), { statusCode: 400 });
  }
  return roundCourseGrade(parsed);
}

export function evaluateCourseGrade(value: unknown): CourseGradeEvaluation {
  const grade = normalizeCourseGrade(value);
  return {
    grade,
    passingGrade: COURSE_PASSING_GRADE,
    result: grade >= COURSE_PASSING_GRADE ? "approved" : "rejected",
    ruleVersion: COURSE_GRADE_RULE_VERSION
  };
}

export function optionalCourseGrade(value: unknown, fallback: number): number {
  if (value === null || value === undefined || value === "") return normalizeCourseGrade(fallback);
  return normalizeCourseGrade(value);
}

export function roundCourseGrade(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function parseCourseGrade(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(",", ".");
  if (!normalized || !/^[+-]?(?:\d+|\d+\.\d+|\.\d+)$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}
