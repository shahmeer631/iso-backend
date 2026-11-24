/**
 * Must Know / Good to Know = ISOBrain library CATEGORY FAMILIES for a RACI profile.
 * Client (video): for Construction + Entry + EHS, Must Know = Environment + OH&S
 * families (all child standards), Good to Know = supporting families (Quality,
 * Auditing, Risk, …) — never only ISO 14001 + ISO 45001.
 */

export type LibraryCategoryRef = {
  id: string;
  name: string;
  slug?: string | null;
};

type ProfileHints = {
  mustKeywords: string[];
  goodKeywords: string[];
};

const DEFAULT_GOOD_KEYWORDS = [
  "quality management",
  "auditing",
  "risk management",
  "compliance",
  "business continuity",
  "integrated management",
];

/** Department / industry → preferred Must Know + Good to Know category keywords.
 * Department is checked first so "Education + Clinical Laboratory" maps to lab/healthcare
 * families — not Educational Organisations alone.
 */
export const resolveProfileCategoryHints = (
  industry: string,
  department: string,
): ProfileHints => {
  const dept = String(department || "").toLowerCase();
  const ind = String(industry || "").toLowerCase();
  const blob = `${ind} ${dept}`;

  // --- Department-first (job function wins over industry) ---
  if (/lab|laboratory|clinical|medical lab|patholog|diagnost/.test(dept)) {
    return {
      // Priority order matters: Medical Laboratories family first (15189/15190/22367),
      // then Testing (17025/10012), then broader Healthcare devices/org standards.
      mustKeywords: [
        "medical laboratories",
        "testing and calibration",
        "healthcare",
      ],
      goodKeywords: [
        "quality management",
        "risk management",
        "information security",
        "compliance",
        "educational",
      ],
    };
  }

  if (
    /\behs\b|environment|health\s*&\s*safety|health and safety|oh\s*&\s*s|occupational|hse\b/.test(
      dept,
    )
  ) {
    return {
      mustKeywords: [
        "environmental management",
        "occupational health",
        "oh&s",
        "health & safety",
      ],
      goodKeywords: [
        "quality management",
        "auditing",
        "risk management",
        "compliance",
        "energy management",
      ],
    };
  }

  if (
    /\binformation security|cyber|infosec|data privacy|privacy|it\b|software/.test(
      dept,
    )
  ) {
    return {
      mustKeywords: ["information security", "it service"],
      goodKeywords: [
        "risk management",
        "business continuity",
        "compliance",
        "quality management",
        "auditing",
        "artificial intelligence",
      ],
    };
  }

  if (/\bai\b|artificial intelligence|machine learning|data science/.test(dept)) {
    return {
      mustKeywords: ["artificial intelligence"],
      goodKeywords: [
        "information security",
        "risk management",
        "quality management",
        "compliance",
        "it service",
      ],
    };
  }

  if (/quality|qa\b|qc\b|assurance/.test(dept)) {
    return {
      mustKeywords: ["quality management"],
      goodKeywords: [
        "auditing",
        "risk management",
        "environmental management",
        "occupational health",
        "customer satisfaction",
      ],
    };
  }

  // --- Industry + combined fallbacks ---
  if (
    /\behs\b|environment|health\s*&\s*safety|occupational/.test(blob)
  ) {
    return {
      mustKeywords: [
        "environmental management",
        "occupational health",
        "oh&s",
        "health & safety",
      ],
      goodKeywords: [
        "quality management",
        "auditing",
        "risk management",
        "compliance",
        "energy management",
      ],
    };
  }

  if (/lab|laboratory|clinical|medical lab/.test(blob)) {
    return {
      mustKeywords: [
        "medical laboratories",
        "testing and calibration",
        "healthcare",
      ],
      goodKeywords: [
        "quality management",
        "risk management",
        "information security",
        "compliance",
      ],
    };
  }

  if (/\bai\b|artificial intelligence|machine learning/.test(blob)) {
    return {
      mustKeywords: ["artificial intelligence"],
      goodKeywords: [
        "information security",
        "risk management",
        "quality management",
        "compliance",
        "it service",
      ],
    };
  }

  if (
    /\binformation security|cyber|infosec|it\b|data privacy|privacy/.test(blob)
  ) {
    return {
      mustKeywords: ["information security", "it service"],
      goodKeywords: [
        "risk management",
        "business continuity",
        "compliance",
        "quality management",
        "auditing",
      ],
    };
  }

  if (/quality|manufactur|product/.test(blob)) {
    return {
      mustKeywords: ["quality management"],
      goodKeywords: [
        "auditing",
        "risk management",
        "environmental management",
        "occupational health",
        "customer satisfaction",
      ],
    };
  }

  if (/food|catering|haccp/.test(blob)) {
    return {
      mustKeywords: ["food safety"],
      goodKeywords: [
        "quality management",
        "environmental management",
        "occupational health",
        "risk management",
      ],
    };
  }

  if (/education|academic|university|school/.test(blob)) {
    return {
      mustKeywords: ["educational"],
      goodKeywords: [
        "quality management",
        "risk management",
        "compliance",
        "information security",
      ],
    };
  }

  return {
    mustKeywords: [],
    goodKeywords: DEFAULT_GOOD_KEYWORDS,
  };
};

/** Build a multi-standard exam title from category families (never a single ISO number). */
export const buildCategoryFamilyExamTitle = (params: {
  mustKnowNames: string[];
  goodToKnowNames?: string[];
  industry?: string;
  department?: string;
  managementLevel?: string;
}): string => {
  const must = (params.mustKnowNames || []).filter(Boolean);
  const good = (params.goodToKnowNames || []).filter(Boolean);
  const primary =
    must.length >= 2
      ? `${must[0]} + ${must[1]}`
      : must[0] || good[0] || "ISO Standards";
  const roleBits = [params.department, params.managementLevel]
    .map((s) => String(s || "").trim())
    .filter(Boolean);
  const role =
    roleBits.length > 0
      ? ` for ${roleBits.join(" · ")}`
      : params.industry
        ? ` for ${params.industry}`
        : "";
  return `Expert ${primary} Multi-Standard Knowledge Examination${role}`;
};

/** True when AI titled the exam around one (or two) ISO numbers only. */
export const isSingleStandardExamTitle = (title: string): boolean => {
  const t = String(title || "").trim();
  if (!t) return true;
  const isoHits = t.match(/\bISO(?:\/IEC)?\s*\d{4,5}\b/gi) || [];
  if (isoHits.length > 0 && isoHits.length <= 2) {
    // "ISO 15189:2022 Clinical Laboratory…" / "Integrated ISO 14001 and ISO 45001…"
    return true;
  }
  return false;
};

const categoryMatchesKeywords = (
  cat: LibraryCategoryRef,
  keywords: string[],
): boolean => {
  const hay = `${cat.name} ${cat.slug || ""}`.toLowerCase();
  return keywords.some((k) => k && hay.includes(k.toLowerCase()));
};

/**
 * Pick Must Know (core) and Good to Know (supporting) library categories.
 * Prefer suggestion-hit categories, then profile keyword matches.
 */
export const pickMustKnowGoodToKnowCategories = (params: {
  allCategories: LibraryCategoryRef[];
  suggestionMatchedCategoryIds: string[];
  industry: string;
  department: string;
  mustKnowLimit?: number;
  goodToKnowLimit?: number;
}): {
  mustKnow: LibraryCategoryRef[];
  goodToKnow: LibraryCategoryRef[];
} => {
  const mustLimit = params.mustKnowLimit ?? 2;
  const goodLimit = params.goodToKnowLimit ?? 3;
  const hints = resolveProfileCategoryHints(
    params.industry,
    params.department,
  );
  const byId = new Map(params.allCategories.map((c) => [c.id, c]));
  const used = new Set<string>();

  const take = (
    candidates: LibraryCategoryRef[],
    limit: number,
  ): LibraryCategoryRef[] => {
    const out: LibraryCategoryRef[] = [];
    for (const c of candidates) {
      if (out.length >= limit) break;
      if (!c?.id || used.has(c.id)) continue;
      used.add(c.id);
      out.push(c);
    }
    return out;
  };

  /** Lower index in keyword list = higher priority (e.g. medical laboratories before healthcare). */
  const keywordPriority = (cat: LibraryCategoryRef, keywords: string[]) => {
    const hay = `${cat.name} ${cat.slug || ""}`.toLowerCase();
    let best = Number.MAX_SAFE_INTEGER;
    keywords.forEach((k, i) => {
      if (k && hay.includes(k.toLowerCase())) best = Math.min(best, i);
    });
    return best;
  };

  // 1) Suggestion-matched categories (ranked as provided)
  const fromSuggestions = params.suggestionMatchedCategoryIds
    .map((id) => byId.get(id))
    .filter(Boolean) as LibraryCategoryRef[];

  // 2) Profile Must Know keyword matches — sorted by keyword priority
  const fromMustKeywords = params.allCategories
    .filter((c) => categoryMatchesKeywords(c, hints.mustKeywords))
    .sort(
      (a, b) =>
        keywordPriority(a, hints.mustKeywords) -
        keywordPriority(b, hints.mustKeywords),
    );

  // Lab/clinical profiles need up to 3 Must Know families so 15189 isn't alone
  const dept = String(params.department || "").toLowerCase();
  const effectiveMustLimit = /lab|laboratory|clinical|medical lab|patholog|diagnost|ehs|oh\s*&\s*s|health\s*&\s*safety/.test(
    dept,
  )
    ? Math.max(mustLimit, 3)
    : mustLimit;

  const mustKnow = take(
    [...fromMustKeywords, ...fromSuggestions],
    effectiveMustLimit,
  );

  // If still empty, fall back to first suggestion hits alone
  if (!mustKnow.length) {
    mustKnow.push(...take(fromSuggestions, mustLimit));
  }

  // 3) Good to Know: profile supporting keywords + remaining suggestion hits
  const fromGoodKeywords = params.allCategories.filter((c) =>
    categoryMatchesKeywords(c, hints.goodKeywords),
  );
  const remainingSuggestions = fromSuggestions.filter((c) => !used.has(c.id));
  const goodToKnow = take(
    [...fromGoodKeywords, ...remainingSuggestions],
    goodLimit,
  );

  // Ensure at least one Good to Know when library has other categories
  if (!goodToKnow.length) {
    const filler = params.allCategories.filter((c) => !used.has(c.id));
    goodToKnow.push(...take(filler, Math.min(2, goodLimit)));
  }

  return { mustKnow, goodToKnow };
};
