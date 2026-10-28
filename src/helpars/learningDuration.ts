/**
 * Content-catalog duration helpers (video length strings).
 *
 * Phase 2 dashboard "Learning time" uses ActivitySession.activeSeconds via
 * the heartbeat engine — do not treat catalog video length as time spent.
 */

/** Parse "M:SS", "MM:SS", or "H:MM:SS" into seconds. Returns 0 if invalid. */
export const parseDurationToSeconds = (raw?: string | null): number => {
  if (!raw || typeof raw !== "string") return 0;

  const cleaned = raw.trim();
  if (!cleaned) return 0;

  // Plain integer → treat as seconds (defensive)
  if (/^\d+$/.test(cleaned)) {
    return Math.max(0, Number(cleaned));
  }

  const parts = cleaned.split(":").map((p) => Number(p));
  if (parts.length < 2 || parts.length > 3 || parts.some((n) => Number.isNaN(n) || n < 0)) {
    return 0;
  }

  if (parts.length === 3) {
    const [h, m, s] = parts;
    return h * 3600 + m * 60 + s;
  }

  const [m, s] = parts;
  return m * 60 + s;
};

/** Human-readable duration for dashboard cards (e.g. "0h", "42m", "2h 15m"). */
export const formatDurationLabel = (totalSeconds: number): string => {
  const safe = Math.max(0, Math.floor(totalSeconds || 0));
  if (safe <= 0) return "0h";

  const totalMinutes = Math.round(safe / 60);
  if (totalMinutes < 60) return `${totalMinutes}m`;

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
};

export const sumVideoDurationsSeconds = (
  lessons: Array<{ video?: { duration?: string | null } | null }>,
): number => {
  return lessons.reduce((sum, lesson) => {
    return sum + parseDurationToSeconds(lesson.video?.duration);
  }, 0);
};
