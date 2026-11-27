/**
 * Mastery Lab competency exam pass threshold (%).
 * Backend-authoritative: CPD certificates auto-issue only when score >= this.
 * Override via MASTERY_PASS_SCORE (default 50 per client requirement).
 */
export const MASTERY_PASS_SCORE = Number(process.env.MASTERY_PASS_SCORE ?? 50);

export const isMasteryPassingScore = (overallScore: number): boolean =>
  Number(overallScore) >= MASTERY_PASS_SCORE;
