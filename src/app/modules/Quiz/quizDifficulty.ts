/** Default Mastery Lab difficulty — expert / extremely hard. */
export const MASTERY_DEFAULT_DIFFICULTY = "expert";

/**
 * Normalize difficulty for the upstream AI service.
 * Missing / unknown values default to EXPERT (mapped to professional for the AI API
 * while difficulty_intent remains extremely difficult).
 */
export const normalizeQuizDifficulty = (raw?: string) => {
  const value = String(raw || MASTERY_DEFAULT_DIFFICULTY)
    .trim()
    .toLowerCase();

  // AI service accepts beginner | intermediate | professional
  if (["beginner", "easy"].includes(value)) return "beginner";
  if (["intermediate", "medium"].includes(value)) return "intermediate";
  if (
    [
      "professional",
      "advanced",
      "hard",
      "expert",
      "extremely difficult",
      "extremely_difficult",
      "extreme",
    ].includes(value)
  ) {
    return "professional";
  }

  // Default: EXPERT
  return "professional";
};
