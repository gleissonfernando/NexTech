export const COURSE_PASSING_GRADE = 6;
export const COURSE_MIN_GRADE = 0;
export const COURSE_MAX_GRADE = 10;
export const COURSE_GRADE_RULE_VERSION = "course-grade-v1-pass-6";

export type CourseGradeResult = "approved" | "rejected";
export type CourseGradeDisplayResult = "APROVADO" | "REPROVADO";

export type CourseGradeEvaluation = {
  aprovado: boolean;
  comparacao: string;
  grade: number;
  mediaMinima: number;
  notaFinal: number;
  passingGrade: number;
  result: CourseGradeResult;
  resultado: CourseGradeDisplayResult;
  ruleVersion: string;
  valorOriginal: string;
};

export function normalizeCourseGrade(value: unknown): number {
  if (value === null || value === undefined) {
    throw Object.assign(new Error("A nota não foi informada."), { statusCode: 400 });
  }

  const original = String(value);
  const text = original.trim();
  if (!text.length) {
    throw Object.assign(new Error("A nota não pode estar vazia."), { statusCode: 400 });
  }

  const parsed = parseCourseGrade(value, text);
  if (parsed === null) {
    throw Object.assign(new Error(`Formato de nota inválido: ${text}`), { statusCode: 400 });
  }

  const rounded = roundCourseGrade(parsed);
  if (rounded < COURSE_MIN_GRADE || rounded > COURSE_MAX_GRADE) {
    throw Object.assign(new Error(`A nota deve estar entre ${COURSE_MIN_GRADE} e ${COURSE_MAX_GRADE}.`), { statusCode: 400 });
  }
  return rounded;
}

export function evaluateCourseGrade(value: unknown): CourseGradeEvaluation {
  const grade = normalizeCourseGrade(value);
  const approved = grade >= COURSE_PASSING_GRADE;
  return {
    aprovado: approved,
    comparacao: approved ? `${grade} >= ${COURSE_PASSING_GRADE}` : `${grade} < ${COURSE_PASSING_GRADE}`,
    grade,
    mediaMinima: COURSE_PASSING_GRADE,
    notaFinal: grade,
    passingGrade: COURSE_PASSING_GRADE,
    result: approved ? "approved" : "rejected",
    resultado: approved ? "APROVADO" : "REPROVADO",
    ruleVersion: COURSE_GRADE_RULE_VERSION,
    valorOriginal: String(value)
  };
}

export function optionalCourseGrade(value: unknown, fallback: number): number {
  if (value === null || value === undefined || value === "") return normalizeCourseGrade(fallback);
  return normalizeCourseGrade(value);
}

export function roundCourseGrade(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function formatCourseGrade(value: unknown): string {
  const grade = typeof value === "number" ? value : normalizeCourseGrade(value);
  return Number(grade).toLocaleString("pt-BR", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 1
  });
}

export const normalizarNota = normalizeCourseGrade;
export const avaliarNota = evaluateCourseGrade;
export const formatarNota = formatCourseGrade;

function parseCourseGrade(value: unknown, text: string): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const withoutSpaces = text.replace(/\s+/g, "");
  if (!/^(?:\d|10)(?:[.,]\d{1,2})?$/.test(withoutSpaces)) return null;
  const normalized = withoutSpaces.replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}
