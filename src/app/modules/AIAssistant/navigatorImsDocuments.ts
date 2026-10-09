/**
 * ISO Navigator — IMS Documents & Records inventory.
 * Source-driven extraction from IMS Practical Guide + selected ISO standards.
 * Produces three categories: mandatory documents, mandatory records, and
 * additional documented information necessary for IMS effectiveness.
 */

import axios from "axios";
import FormData from "form-data";
import { getNavigatorGroundingExcerpt } from "./navigatorGenerate.grounding";
import {
  collectImsIntegrationStandardTokens,
  looksLikeImsRequirement,
} from "./navigatorIms";
import { mergeChecklistPreferredInventory } from "./ims27001_42001Checklist";

export type ImsDocumentedInfoItem = {
  title: string;
  description?: string;
  type: "document" | "record" | "additional";
  clause: string;
  standard?: string;
  standards?: string[];
  /** Per-standard clause refs when an integrated item maps to multiple clauses. */
  clausesByStandard?: Record<string, string>;
  requirement?: "required" | "necessary" | "recommended";
  category?: "integrated" | "standard_specific";
  isIntegrated?: boolean;
  isStandardSpecific?: boolean;
  taxonomy?:
    | "mandatory_document"
    | "mandatory_record"
    | "additional"
    | "recommended";
  /** Org-grounded application text (from Step 1/2 context when available). */
  organizational_application?: string;
  sourceDocument?: string;
  sourceReference?: string;
  integration_note?: string;
};

export type ImsDocumentedInfoInventory = {
  documents: ImsDocumentedInfoItem[];
  records: ImsDocumentedInfoItem[];
  /** Additional documented information necessary for IMS effectiveness. */
  additional: ImsDocumentedInfoItem[];
  imsGuideTitle?: string;
  imsGuideAvailable?: boolean;
  missingEditions?: string[];
  groundingSources?: Array<{
    standard: string;
    documentId?: string;
    version?: string;
  }>;
  excerptChars?: number;
};

export type ImsNormalizedBuckets = {
  documents: ImsDocumentedInfoItem[];
  records: ImsDocumentedInfoItem[];
  additional: ImsDocumentedInfoItem[];
};

const ANALYSIS_TITLE_RE =
  /documented information required for the integrated management system|integrated\s*\/\s*common requirements|standard-specific requirements|maintain vs retain|integration\s*\/\s*ims mapping|ims evidence\s*\/\s*records overview/i;

/** Families that should consolidate across HLS-aligned standards when multi-selected. */
const INTEGRATABLE_FAMILIES: Array<{
  key: string;
  titleMatch: RegExp;
  integratedTitle: string;
  preferType: "document" | "record";
}> = [
  {
    key: "policy",
    titleMatch:
      /^(?:integrated\s+)?(?:management\s+system\s+)?(?:quality|environmental|environment|oh&?s|occupational|information\s+security|ai\s+management)?\s*(?:&|and)?\s*(?:quality|environmental|oh&?s)?\s*policy$/i,
    integratedTitle: "Integrated Policy",
    preferType: "document",
  },
  {
    key: "scope",
    titleMatch:
      /^(?:integrated\s+)?(?:(?:ims|management\s+system)\s+)?scope(?:\s+of\s+the\s+management\s+system)?$/i,
    integratedTitle: "Scope of the Management System",
    preferType: "document",
  },
  {
    key: "objectives",
    titleMatch:
      /^(?:integrated\s+)?(?:(?:ims|quality|environmental|oh&?s|information\s+security|ai)\s+)?objectives(?:\s+framework)?$/i,
    integratedTitle: "IMS Objectives",
    preferType: "document",
  },
  {
    // Keep separate from "Risks and Opportunities" register (client reference: 6.1.1 vs 6.1.4)
    key: "process_risks_opportunities",
    titleMatch:
      /process\s+for\s+addressing\s+risks?\s*(?:and|&)\s*opportunities|addressing\s+risks?\s*(?:and|&)\s*opportunities/i,
    integratedTitle: "Process for Addressing Risks & Opportunities",
    preferType: "document",
  },
  {
    key: "risks_opportunities_register",
    titleMatch:
      /^(?:integrated\s+)?risks?\s*(?:and|&)\s*opportunities(?:\s+register)?$/i,
    integratedTitle: "Risks and Opportunities",
    preferType: "document",
  },
  {
    key: "operational_planning",
    titleMatch: /operational\s+planning(?:\s+and\s+control)?/i,
    integratedTitle: "Operational Planning and Control",
    preferType: "document",
  },
  {
    key: "competence",
    titleMatch: /evidence\s+of\s+competence|competence\s+records?/i,
    integratedTitle: "Evidence of Competence",
    preferType: "record",
  },
  {
    key: "monitoring",
    titleMatch:
      /monitoring[,\s]+measurement|analysis\s*(?:and|&)\s*evaluation/i,
    integratedTitle: "Monitoring, Measurement, Analysis and Evaluation Results",
    preferType: "record",
  },
  {
    key: "external_provider",
    titleMatch: /external\s+provider|supplier\s+evaluat/i,
    integratedTitle: "External Provider Evaluations",
    preferType: "record",
  },
  {
    key: "internal_audit",
    titleMatch: /internal\s+audit\s+(?:programme|program|results?)/i,
    integratedTitle: "Internal Audit Programme and Results",
    preferType: "record",
  },
  {
    key: "management_review",
    titleMatch: /management\s+review(?:\s+results?)?/i,
    integratedTitle: "Management Review Results",
    preferType: "record",
  },
  {
    key: "ncr_ca",
    titleMatch:
      /nonconformit(?:y|ies)|corrective\s+action|incidents?\s+and\s+corrective/i,
    integratedTitle: "Nonconformities, Incidents and Corrective Actions",
    preferType: "record",
  },
];

/** Digits → selected tokens that belong to that ISO family. */
function tokensMatchingFamilies(
  selectedTokens: string[],
  families: string[],
): string[] {
  return selectedTokens.filter((t) => {
    const digits = t.match(/(\d{4,5})/)?.[1];
    return Boolean(digits && families.includes(digits));
  });
}

/**
 * Restrict applicable standards by requirement title so e.g. aspects/hazards
 * are never assigned to 9001-only when 14001/45001 are the real hosts.
 */
export function applyTitleApplicabilityFilters(
  buckets: ImsNormalizedBuckets,
  selectedTokens: string[],
): ImsNormalizedBuckets {
  type Rule = { match: RegExp; families: string[] };
  const rules: Rule[] = [
    {
      match: /environmental\s+aspects|oh&?s\s+hazards|aspects?\s*(?:and|&)\s*hazards/i,
      families: ["14001", "45001"],
    },
    {
      match: /compliance\s+obligations/i,
      families: ["14001", "45001"],
    },
    {
      match: /emergency\s+preparedness/i,
      families: ["14001", "45001"],
    },
    {
      match: /statement\s+of\s+applicability|\bsoa\b/i,
      families: ["27001"],
    },
    {
      match: /worker\s+consultation|consultation\s+and\s+participation/i,
      families: ["45001"],
    },
    {
      match: /requirements?\s+review|design\s+and\s+development/i,
      families: ["9001"],
    },
    {
      // Explicit communication evidence is strongest under ISO 14001 7.4.x
      match: /evidence\s+of\s+communication/i,
      families: ["14001"],
    },
    {
      match: /evaluation\s+of\s+compliance/i,
      families: ["14001", "45001"],
    },
    {
      match: /ai\s+system|ai\s+risk|ai\s+impact|system\s+impact\s+assessment/i,
      families: ["42001"],
    },
  ];

  const filterItem = (item: ImsDocumentedInfoItem): ImsDocumentedInfoItem | null => {
    for (const rule of rules) {
      if (!rule.match.test(item.title)) continue;
      const allowed = tokensMatchingFamilies(selectedTokens, rule.families);
      if (!allowed.length) return null; // requirement not applicable to selection
      const current = item.standards?.length
        ? item.standards
        : item.standard
          ? [item.standard]
          : selectedTokens;
      const next = current.filter((s) =>
        allowed.some((a) => familyKey(a) === familyKey(s) || matchSelectedStandard(s, [a])),
      );
      const standards = next.length ? next : allowed;
      return {
        ...item,
        standards,
        standard: standards[0],
        category: standards.length >= 2 ? "integrated" : "standard_specific",
        isIntegrated: standards.length >= 2,
        isStandardSpecific: standards.length < 2,
      };
    }
    return item;
  };

  const mapList = (list: ImsDocumentedInfoItem[]) =>
    list.map(filterItem).filter(Boolean) as ImsDocumentedInfoItem[];

  return {
    documents: mapList(buckets.documents),
    records: mapList(buckets.records),
    additional: mapList(buckets.additional),
  };
}

type CoverageCandidate = {
  title: string;
  bucket: "documents" | "records" | "additional";
  clause: string;
  /** ISO family digits that must be present (empty = all selected). */
  families: string[];
  /** Must match grounding excerpt before the item may be added. */
  evidence: RegExp;
  description: string;
};

/** Airport/DXB-style details from the client example — never inject unless org context supports them. */
const CLIENT_EXAMPLE_ORG_RE =
  /\b(DXB|Dubai International(?:\s+Airport)?|DAFZA|dnata|Mirsal(?:\s*2)?|DCAA|Dubai Civil Aviation|concourse[s]?|runway operations|passenger terminals?|ground support equipment|\bGSE\b|baggage tractor|jet emissions?|aircraft noise|air traffic coordination|cargo clearance)\b/i;

function orgContextSupportsAirportExamples(orgContext: string): boolean {
  return /\b(dxb|dubai|airport|aviation|airline|aircraft|terminal|runway|cargo\s+facilit)/i.test(
    orgContext || "",
  );
}

function stripAlienOrgDetails(text: string, orgContext: string): string {
  const raw = String(text || "").trim();
  if (!raw) return "";
  if (orgContextSupportsAirportExamples(orgContext)) return raw;
  if (!CLIENT_EXAMPLE_ORG_RE.test(raw)) return raw;
  const kept = raw
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => !CLIENT_EXAMPLE_ORG_RE.test(sentence))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return kept;
}

/**
 * Build reference-quality Organizational Context & Application text from the
 * user's Step 1/2 context — never invent DXB/airport facts.
 */
export function buildOrganizationalApplication(params: {
  title: string;
  description?: string;
  orgContext?: string;
  existingApplication?: string;
}): string {
  const org = String(params.orgContext || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 400);
  const desc = stripAlienOrgDetails(
    String(params.description || "").trim(),
    org,
  );
  let existing = stripAlienOrgDetails(
    String(params.existingApplication || "").trim(),
    org,
  );

  // Drop weak placeholder applications
  if (/^Apply this requirement in the context of:/i.test(existing)) {
    existing = "";
  }

  const requirementCore =
    desc ||
    `${params.title} shall be available as documented information to the extent required by the applicable standard(s).`;

  if (existing && existing.length >= 24) {
    // If existing already ties to org, keep (after sanitization)
    if (!org || existing.toLowerCase().includes(org.slice(0, 32).toLowerCase())) {
      return existing.slice(0, 600);
    }
    return `${existing} Organizational context: ${org}.`.slice(0, 600);
  }

  if (org) {
    return `${requirementCore} For this organization — ${org} — maintain and apply this documented information across the relevant operations, roles, and processes described in the organizational context.`.slice(
      0,
      600,
    );
  }

  // No org context: standards-grounded general explanation only
  return requirementCore.slice(0, 600);
}

export function enrichOrganizationalApplications(
  buckets: ImsNormalizedBuckets,
  orgContext?: string,
): ImsNormalizedBuckets {
  const mapItem = (item: ImsDocumentedInfoItem): ImsDocumentedInfoItem => {
    const description =
      stripAlienOrgDetails(item.description || "", orgContext || "") ||
      item.description ||
      `${item.title} documented information for the applicable management system requirements.`;
    const organizational_application = buildOrganizationalApplication({
      title: item.title,
      description,
      orgContext,
      existingApplication: item.organizational_application,
    });
    return { ...item, description, organizational_application };
  };
  return {
    documents: buckets.documents.map(mapItem),
    records: buckets.records.map(mapItem),
    additional: buckets.additional.map(mapItem),
  };
}

/** Remove ISO tokens from prose that are outside the user's selection. */
export function stripUnselectedStandardMentions(
  text: string,
  selectedTokens: string[],
): string {
  const raw = String(text || "");
  if (!raw || !selectedTokens.length) return raw;
  const selectedDigits = new Set(
    selectedTokens
      .map((t) => t.match(/(\d{4,5})/)?.[1])
      .filter((d): d is string => Boolean(d)),
  );
  return raw
    .replace(
      /\b((?:ISO(?:\s*\/\s*IEC)?|IEC)\s*\d{4,5}(?::\d{4})?)\b/gi,
      (match) => {
        const d = match.match(/(\d{4,5})/)?.[1];
        if (d && selectedDigits.has(d)) return match;
        return "the selected standard(s)";
      },
    )
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Lock inventory items to selected standards only and stabilize predetermined
 * catalogue titles/clauses so AI does not rewrite fixed wording each run.
 */
export function lockInventoryToSelectedStandards(
  buckets: ImsNormalizedBuckets,
  selectedTokens: string[],
): ImsNormalizedBuckets {
  const mapItem = (item: ImsDocumentedInfoItem): ImsDocumentedInfoItem | null => {
    const standards = (item.standards?.length
      ? item.standards
      : item.standard
        ? [item.standard]
        : []
    ).filter((s) =>
      selectedTokens.some(
        (t) => familyKey(t) === familyKey(s) || matchSelectedStandard(s, [t]),
      ),
    );
    if (!standards.length && selectedTokens.length) {
      // No valid mapping left — drop rather than attach unselected standards
      if (item.standard || item.standards?.length) return null;
    }
    const nextStandards = standards.length ? standards : undefined;
    let clausesByStandard = item.clausesByStandard;
    if (clausesByStandard && nextStandards) {
      const kept: Record<string, string> = {};
      for (const [k, v] of Object.entries(clausesByStandard)) {
        const matched = matchSelectedStandard(k, selectedTokens);
        if (matched && nextStandards.some((s) => familyKey(s) === familyKey(matched))) {
          kept[matched] = v;
        }
      }
      clausesByStandard = Object.keys(kept).length ? kept : undefined;
    }
    return {
      ...item,
      standard: nextStandards?.[0] || item.standard,
      standards: nextStandards,
      clausesByStandard,
      description: stripUnselectedStandardMentions(
        item.description || "",
        selectedTokens,
      ),
      organizational_application: stripUnselectedStandardMentions(
        item.organizational_application || "",
        selectedTokens,
      ),
      integration_note: stripUnselectedStandardMentions(
        item.integration_note || "",
        selectedTokens,
      ),
    };
  };

  const mapList = (list: ImsDocumentedInfoItem[]) =>
    list.map(mapItem).filter(Boolean) as ImsDocumentedInfoItem[];

  return {
    documents: mapList(buckets.documents),
    records: mapList(buckets.records),
    additional: mapList(buckets.additional),
  };
}

/** Canonical predetermined titles — prefer stable wording over AI paraphrase churn. */
const PREDETERMINED_TITLE_CANON: Array<{ match: RegExp; title: string; clause?: string }> = [
  { match: /scope of the management system|(?:management\s+system\s+)?scope(?:\s+statement)?$/i, title: "Scope of the Management System", clause: "4.3" },
  { match: /integrated\s+(?:management\s+)?policy|^quality policy$|^environmental policy$|^oh&?s policy$/i, title: "Integrated Policy", clause: "5.2" },
  { match: /process for addressing risks/i, title: "Process for Addressing Risks & Opportunities", clause: "6.1.1" },
  { match: /environmental aspects|oh&?s hazards/i, title: "Environmental Aspects & OH&S Hazards", clause: "6.1.2" },
  { match: /compliance obligations/i, title: "Compliance Obligations", clause: "6.1.3" },
  { match: /^(?:integrated\s+)?risks?\s*(?:and|&)\s*opportunities$/i, title: "Risks and Opportunities", clause: "6.1.4" },
  { match: /ims objectives|^(?:quality|environmental|oh&?s)\s+objectives$/i, title: "IMS Objectives", clause: "6.2.1" },
  { match: /operational planning/i, title: "Operational Planning and Control", clause: "8.1" },
  { match: /emergency preparedness/i, title: "Emergency Preparedness and Response", clause: "8.2" },
  { match: /evidence of competence/i, title: "Evidence of Competence", clause: "7.2" },
  { match: /evidence of communication/i, title: "Evidence of Communication", clause: "7.4.1" },
  { match: /requirements?\s+review/i, title: "Requirements Review for Products/Services", clause: "8.2.3" },
  { match: /design and development/i, title: "Design and Development Records", clause: "8.3" },
  { match: /external provider/i, title: "External Provider Evaluations", clause: "8.4.1" },
  { match: /monitoring.*measurement|analysis.*evaluation results/i, title: "Monitoring, Measurement, Analysis and Evaluation Results", clause: "9.1.1" },
  { match: /evaluation of compliance/i, title: "Evaluation of Compliance", clause: "9.1.2" },
  { match: /internal audit/i, title: "Internal Audit Programme and Results", clause: "9.2.2" },
  { match: /management review/i, title: "Management Review Results", clause: "9.3.3" },
  { match: /nonconform|corrective action/i, title: "Nonconformities, Incidents and Corrective Actions", clause: "10.2" },
  { match: /worker consultation/i, title: "Worker Consultation and Participation" },
  { match: /calibration/i, title: "Calibration Records" },
  { match: /change management/i, title: "Change Management Logs" },
];

export function stabilizePredeterminedInventoryItems(
  buckets: ImsNormalizedBuckets,
): ImsNormalizedBuckets {
  const stabilize = (item: ImsDocumentedInfoItem): ImsDocumentedInfoItem => {
    for (const canon of PREDETERMINED_TITLE_CANON) {
      if (!canon.match.test(item.title)) continue;
      return {
        ...item,
        title: canon.title,
        clause:
          item.clause && !/^ims$/i.test(item.clause)
            ? item.clause
            : canon.clause || item.clause,
      };
    }
    return item;
  };
  return {
    documents: buckets.documents.map(stabilize),
    records: buckets.records.map(stabilize),
    additional: buckets.additional.map(stabilize),
  };
}

/**
 * Evidence-gated coverage fill — only adds reference-pattern items when the
 * selected standards apply AND the grounding excerpt supports them.
 * Does NOT blind-insert the client example catalogue.
 */
export function fillCoverageFromGroundingEvidence(
  buckets: ImsNormalizedBuckets,
  selectedTokens: string[],
  excerpt: string,
  orgContext?: string,
): ImsNormalizedBuckets {
  const hay = (excerpt || "").toLowerCase();
  if (hay.length < 80) return buckets;

  const orgSnippet = String(orgContext || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 350);

  const candidates: CoverageCandidate[] = [
    {
      title: "Scope of the Management System",
      bucket: "documents",
      clause: "4.3",
      families: [],
      evidence: /4\.3|scope of the (?:(?:quality|environmental|oh&?s|information security|ai|management) )?system|shall maintain documented information.*(scope)/i,
      description:
        "Documented information defining the boundaries and applicability of the integrated management system.",
    },
    {
      title: "Integrated Policy",
      bucket: "documents",
      clause: "5.2",
      families: [],
      evidence: /5\.2|quality policy|environmental policy|oh&?s policy|information security policy|management.*policy|shall.*(establish|maintain).*policy/i,
      description:
        "The policy must be available as documented information, be communicated within the organization, and be available to interested parties, covering the commitments required by the selected standards.",
    },
    {
      title: "Process for Addressing Risks & Opportunities",
      bucket: "documents",
      clause: "6.1.1",
      families: [],
      evidence: /6\.1\.1|actions to address risks and opportunities|process.*(risks|opportunities)/i,
      description:
        "Documented process for planning actions to address risks and opportunities to the extent necessary to have confidence they are carried out as planned.",
    },
    {
      title: "Environmental Aspects & OH&S Hazards",
      bucket: "documents",
      clause: "6.1.2",
      families: ["14001", "45001"],
      evidence: /environmental aspects|oh&?s hazard|hazard.*risk|significant environmental aspects|6\.1\.2/i,
      description:
        "Documented information on environmental aspects/impacts and/or OH&S hazards and associated criteria, where those standards apply.",
    },
    {
      title: "Compliance Obligations",
      bucket: "documents",
      clause: "6.1.3",
      families: ["14001", "45001"],
      evidence: /compliance obligations|legal requirements|6\.1\.3/i,
      description:
        "Documented information on compliance obligations applicable to the environmental and/or OH&S management system.",
    },
    {
      title: "Risks and Opportunities",
      bucket: "documents",
      clause: "6.1.4",
      families: [],
      evidence: /6\.1\.4|risks and opportunities that need to be addressed|documented information.*(risks and opportunities)/i,
      description:
        "Documented information on the risks and opportunities that need to be addressed.",
    },
    {
      title: "IMS Objectives",
      bucket: "documents",
      clause: "6.2",
      families: [],
      evidence: /6\.2|quality objectives|environmental objectives|oh&?s objectives|objectives.*documented/i,
      description:
        "Measurable integrated management-system objectives available as documented information.",
    },
    {
      title: "Operational Planning and Control",
      bucket: "documents",
      clause: "8.1",
      families: [],
      evidence: /8\.1|operational planning and control|documented information.*(processes).*carried out as planned/i,
      description:
        "Documented operational processes and controls to the extent necessary to have confidence they are carried out as planned.",
    },
    {
      title: "Emergency Preparedness and Response",
      bucket: "documents",
      clause: "8.2",
      families: ["14001", "45001"],
      evidence: /emergency preparedness|emergency response|8\.2/i,
      description:
        "Documented processes for emergency preparedness and response where environmental and/or OH&S standards apply.",
    },
    {
      title: "Statement of Applicability",
      bucket: "documents",
      clause: "6.1.3",
      families: ["27001"],
      evidence: /statement of applicability|\bsoa\b|annex a controls/i,
      description:
        "Statement of Applicability for the information security management system controls.",
    },
    {
      title: "Evidence of Competence",
      bucket: "records",
      clause: "7.2",
      families: [],
      evidence: /7\.2|evidence of competence|competence.*documented|retain.*competence/i,
      description:
        "Retained documented information as evidence of competence.",
    },
    {
      title: "Evidence of Communication",
      bucket: "records",
      clause: "7.4.1",
      families: ["14001"],
      evidence: /7\.4|evidence of.*communication|communications.*documented/i,
      description:
        "Appropriate documented information shall be available as evidence of the organization's communications.",
    },
    {
      title: "Requirements Review for Products/Services",
      bucket: "records",
      clause: "8.2.3",
      families: ["9001"],
      evidence: /8\.2\.3|review of requirements|requirements related to products/i,
      description:
        "Records of the review of requirements related to products and services.",
    },
    {
      title: "Design and Development Records",
      bucket: "records",
      clause: "8.3",
      families: ["9001"],
      evidence: /8\.3|design and development/i,
      description:
        "Records of design and development inputs, controls, and outputs where design applies.",
    },
    {
      title: "External Provider Evaluations",
      bucket: "records",
      clause: "8.4",
      families: ["9001"],
      evidence: /8\.4|external provider|supplier evaluation|control of externally provided/i,
      description:
        "Records of evaluation and monitoring of external providers.",
    },
    {
      title: "Monitoring, Measurement, Analysis and Evaluation Results",
      bucket: "records",
      clause: "9.1.1",
      families: [],
      evidence: /9\.1|monitoring, measurement, analysis|evidence of the monitoring/i,
      description:
        "Retained documented information as evidence of monitoring, measurement, analysis and evaluation results.",
    },
    {
      title: "Evaluation of Compliance",
      bucket: "records",
      clause: "9.1.2",
      families: ["14001", "45001"],
      evidence: /9\.1\.2|evaluation of compliance|compliance evaluation/i,
      description:
        "Retained documented information as evidence of compliance evaluation results.",
    },
    {
      title: "Internal Audit Programme and Results",
      bucket: "records",
      clause: "9.2",
      families: [],
      evidence: /9\.2|internal audit|audit programme|audit program/i,
      description:
        "Audit programme(s) and evidence of implementation and results.",
    },
    {
      title: "Management Review Results",
      bucket: "records",
      clause: "9.3",
      families: [],
      evidence: /9\.3|management review/i,
      description:
        "Documented information as evidence of the results of management reviews.",
    },
    {
      title: "Nonconformities, Incidents and Corrective Actions",
      bucket: "records",
      clause: "10.2",
      families: [],
      evidence: /10\.2|nonconformit|corrective action|incident/i,
      description:
        "Documented information on nonconformities/incidents, actions taken, and results of corrective action.",
    },
    {
      title: "Worker Consultation and Participation",
      bucket: "additional",
      clause: "5.4",
      families: ["45001"],
      evidence: /consultation and participation|worker consultation|5\.4/i,
      description:
        "Additional documented information supporting worker consultation and participation for OH&S effectiveness.",
    },
    {
      title: "Calibration Records",
      bucket: "additional",
      clause: "7.1.5",
      families: ["9001", "14001", "45001"],
      evidence: /calibrat|measuring equipment|monitoring and measuring resources|7\.1\.5/i,
      description:
        "Calibration and verification records for monitoring and measuring resources necessary for IMS effectiveness.",
    },
    {
      title: "Change Management Logs",
      bucket: "additional",
      clause: "8.1",
      families: [],
      evidence: /change management|planned changes|control of changes|managing change/i,
      description:
        "Records of planned changes affecting the IMS, retained as needed for effective operation and control.",
    },
  ];

  const alreadyHas = (title: string, list: ImsDocumentedInfoItem[]) => {
    const key = titleKey(title);
    return list.some((i) => {
      const t = titleKey(i.title);
      if (t === key) return true;
      // fuzzy: policy family
      if (/policy/.test(key) && /policy/.test(t)) return true;
      if (/scope/.test(key) && /scope/.test(t)) return true;
      if (/objectives/.test(key) && /objectives/.test(t)) return true;
      if (/internal audit/.test(key) && /internal audit/.test(t)) return true;
      if (/management review/.test(key) && /management review/.test(t)) return true;
      if (/nonconform/.test(key) && /nonconform|corrective/.test(t)) return true;
      if (/process for addressing/.test(key) && /process for addressing|addressing risks/.test(t))
        return true;
      if (
        key === titleKey("Risks and Opportunities") &&
        /^(?:integrated\s+)?risks?\s*(?:and|&)\s*opportunities/.test(t) &&
        !/process for addressing/.test(t)
      )
        return true;
      return false;
    });
  };

  const out: ImsNormalizedBuckets = {
    documents: [...buckets.documents],
    records: [...buckets.records],
    additional: [...buckets.additional],
  };

  for (const c of candidates) {
    const applicable =
      c.families.length === 0
        ? selectedTokens
        : tokensMatchingFamilies(selectedTokens, c.families);
    if (!applicable.length) continue;
    if (!c.evidence.test(hay) && !c.evidence.test(excerpt)) continue;

    const list = out[c.bucket];
    if (alreadyHas(c.title, list)) continue;
    // Also skip if present in another mandatory bucket for same title family
    if (
      c.bucket !== "additional" &&
      (alreadyHas(c.title, out.documents) || alreadyHas(c.title, out.records))
    ) {
      continue;
    }

    const isIntegrated = applicable.length >= 2;
    list.push({
      title: c.title,
      description: c.description,
      type: c.bucket === "additional" ? "additional" : c.bucket === "records" ? "record" : "document",
      clause: c.clause,
      standard: applicable[0],
      standards: applicable,
      requirement: c.bucket === "additional" ? "necessary" : "required",
      category: isIntegrated ? "integrated" : "standard_specific",
      isIntegrated,
      isStandardSpecific: !isIntegrated,
      taxonomy:
        c.bucket === "additional"
          ? "additional"
          : c.bucket === "records"
            ? "mandatory_record"
            : "mandatory_document",
      organizational_application: undefined, // filled by enrichOrganizationalApplications
      sourceDocument: "Grounding excerpt (evidence-gated coverage)",
      integration_note: isIntegrated
        ? `Applicable across ${applicable.join(" + ")} based on selected standards and source evidence.`
        : undefined,
    });
  }

  return enrichOrganizationalApplications(out, orgContext);
}

/**
 * Soft-validate clauses against the grounding excerpt. Clears clearly unsupported
 * primary clauses when the excerpt has no matching clause token nearby; does not invent replacements.
 */
export function groundClausesAgainstExcerpt(
  buckets: ImsNormalizedBuckets,
  excerpt: string,
): ImsNormalizedBuckets {
  const hay = excerpt || "";
  if (hay.length < 80) return buckets;

  const clausePresent = (clause: string): boolean => {
    const c = String(clause || "").trim();
    if (!c) return true;
    // multi-clause "4.3 / 5.2"
    const parts = c.split(/\s*\/\s*/);
    return parts.some((p) => {
      const token = p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (!token) return false;
      return new RegExp(`\\b${token}\\b`).test(hay);
    });
  };

  const fix = (item: ImsDocumentedInfoItem): ImsDocumentedInfoItem => {
    if (!item.clause || clausePresent(item.clause)) return item;
    // Prefer a clausesByStandard entry that is present
    if (item.clausesByStandard) {
      const kept: Record<string, string> = {};
      for (const [std, cl] of Object.entries(item.clausesByStandard)) {
        if (clausePresent(cl)) kept[std] = cl;
      }
      if (Object.keys(kept).length) {
        return {
          ...item,
          clausesByStandard: kept,
          clause: Object.values(kept).join(" / "),
        };
      }
    }
    // Keep title/standards but drop unsupported clause rather than inventing
    return { ...item, clause: item.standards?.join(" / ") || item.standard || "" };
  };

  return {
    documents: buckets.documents.map(fix),
    records: buckets.records.map(fix),
    additional: buckets.additional.map(fix),
  };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function normalizeClause(raw: unknown): string {
  const s = String(raw || "")
    .replace(/^clause\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!s || /^ims$/i.test(s) || /^n\/?a$/i.test(s) || /^unknown$/i.test(s)) {
    return "";
  }
  const m = s.match(/\b(\d+(?:\.\d+){0,4}(?:\.[A-Za-z]\d*)?)\b/);
  if (m) return m[1];
  const annex = s.match(/\b(A(?:nnex)?\.?\s*\d+(?:\.\d+)*)\b/i);
  if (annex) return annex[1].replace(/\s+/g, "");
  return s.slice(0, 40);
}

function familyKey(token: string): string {
  return token
    .toLowerCase()
    .replace(/:\d{4}$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function titleKey(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function matchSelectedStandard(
  raw: string | undefined,
  selectedTokens: string[],
): string | undefined {
  if (!raw || !selectedTokens.length) return undefined;
  const hay = raw.toLowerCase();
  for (const token of selectedTokens) {
    const digits = token.match(/(\d{4,5})/)?.[1];
    if (digits && hay.includes(digits)) return token;
    if (hay.includes(familyKey(token))) return token;
  }
  return undefined;
}

function normalizeStandardsField(
  item: Record<string, unknown>,
  selectedTokens: string[],
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (v: unknown) => {
    const matched =
      matchSelectedStandard(String(v || ""), selectedTokens) ||
      (typeof v === "string" && selectedTokens.includes(v) ? v : undefined);
    if (!matched) return;
    const key = familyKey(matched);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(matched);
  };

  if (Array.isArray(item.standards)) {
    for (const s of item.standards) push(s);
  }
  push(item.standard);

  // clausesByStandard keys may also carry standards
  if (isPlainObject(item.clausesByStandard)) {
    for (const k of Object.keys(item.clausesByStandard)) push(k);
  }
  if (isPlainObject(item.clauses_by_standard)) {
    for (const k of Object.keys(item.clauses_by_standard)) push(k);
  }

  return out;
}

function normalizeClausesByStandard(
  raw: Record<string, unknown>,
  selectedTokens: string[],
  fallbackClause: string,
  standards: string[],
): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  const source =
    (isPlainObject(raw.clausesByStandard) && raw.clausesByStandard) ||
    (isPlainObject(raw.clauses_by_standard) && raw.clauses_by_standard) ||
    null;
  if (source) {
    for (const [k, v] of Object.entries(source)) {
      const std = matchSelectedStandard(k, selectedTokens);
      const clause = normalizeClause(v);
      if (std && clause) out[std] = clause;
    }
  }
  if (fallbackClause && standards.length === 1 && !out[standards[0]]) {
    out[standards[0]] = fallbackClause;
  }
  return Object.keys(out).length ? out : undefined;
}

function classifyKind(
  item: Record<string, unknown>,
): "document" | "record" {
  const type = String(item.type || item.kind || "").toLowerCase();
  if (type.includes("record") || type.includes("evidence")) return "record";
  if (type.includes("document") || type.includes("additional")) return "document";
  const title = String(item.title || "").toLowerCase();
  const req = String(item.requirement || item.obligation || "").toLowerCase();
  const desc = String(item.description || item.integration_note || "").toLowerCase();
  const blob = `${title} ${req} ${desc}`;
  if (
    /\bretain(?:ed)?\b/.test(blob) ||
    /\bas evidence\b/.test(blob) ||
    /\brecord(s)?\b/.test(blob) ||
    /\bresults?\b/.test(title)
  ) {
    return "record";
  }
  return "document";
}

function classifyRequirement(
  item: Record<string, unknown>,
): "required" | "necessary" | "recommended" {
  const raw = String(
    item.requirement || item.obligation || item.taxonomy || item.category_bucket || "",
  ).toLowerCase();
  const type = String(item.type || "").toLowerCase();
  if (
    type === "additional" ||
    /additional/.test(raw) ||
    /recommend|guidance|optional|may\b/.test(raw) ||
    raw === "recommended"
  ) {
    if (type === "additional" || /necessary|effectiveness|additional/.test(raw)) {
      return "necessary";
    }
    if (/recommend|guidance|optional/.test(raw) || raw === "recommended") {
      return "recommended";
    }
  }
  if (/necessary|effectiveness|organization determines|determined by|additional/.test(raw)) {
    return "necessary";
  }
  if (/required|mandatory|shall|must/.test(raw)) return "required";
  return "required";
}

function isAnalysisCategoryTitle(title: string): boolean {
  return ANALYSIS_TITLE_RE.test(title || "");
}

function dedupeKey(item: ImsDocumentedInfoItem): string {
  const title = titleKey(item.title);
  const standards = (item.standards || [])
    .map(familyKey)
    .sort()
    .join("|");
  const clause = (item.clause || "").toLowerCase();
  const bucket =
    item.taxonomy === "additional" || item.requirement === "necessary"
      ? "additional"
      : item.type;
  return `${bucket}::${title}::${clause}::${standards || item.category || ""}`;
}

function findIntegratableFamily(title: string) {
  const t = titleKey(title);
  for (const fam of INTEGRATABLE_FAMILIES) {
    if (fam.titleMatch.test(t) || fam.titleMatch.test(title.trim())) {
      return fam;
    }
  }
  // Broader policy / quality policy / environmental policy detection
  if (/\bpolicy\b/i.test(title) && !/statement of applicability|privacy/i.test(title)) {
    return INTEGRATABLE_FAMILIES.find((f) => f.key === "policy")!;
  }
  return undefined;
}

/**
 * Merge HLS-common items (policy, scope, objectives, etc.) into one integrated
 * card when multiple selected standards apply, preserving per-standard clauses.
 */
export function consolidateIntegratableItems(
  buckets: ImsNormalizedBuckets,
  selectedTokens: string[],
): ImsNormalizedBuckets {
  if (selectedTokens.length < 2) return buckets;

  const processList = (
    list: ImsDocumentedInfoItem[],
    preferType: "document" | "record",
  ): ImsDocumentedInfoItem[] => {
    const byFamily = new Map<string, ImsDocumentedInfoItem[]>();
    const rest: ImsDocumentedInfoItem[] = [];

    for (const item of list) {
      // Do not force-merge additional/recommended into mandatory families
      if (
        item.requirement === "necessary" ||
        item.requirement === "recommended" ||
        item.taxonomy === "additional" ||
        item.taxonomy === "recommended"
      ) {
        rest.push(item);
        continue;
      }
      const fam = findIntegratableFamily(item.title);
      if (!fam || fam.preferType !== preferType) {
        rest.push(item);
        continue;
      }
      const arr = byFamily.get(fam.key) || [];
      arr.push(item);
      byFamily.set(fam.key, arr);
    }

    const consolidated: ImsDocumentedInfoItem[] = [];
    for (const fam of INTEGRATABLE_FAMILIES) {
      if (fam.preferType !== preferType) continue;
      const group = byFamily.get(fam.key);
      if (!group?.length) continue;

      if (group.length === 1 && (group[0].standards?.length || 0) >= 2) {
        // Already integrated — normalize title
        const g = { ...group[0] };
        if (!/^integrated\b/i.test(g.title) && fam.key === "policy") {
          g.title = fam.integratedTitle;
        } else if (fam.key !== "policy" && titleKey(g.title).length < 8) {
          g.title = fam.integratedTitle;
        }
        g.category = "integrated";
        g.isIntegrated = true;
        g.isStandardSpecific = false;
        consolidated.push(g);
        continue;
      }

      if (group.length === 1) {
        // Single item for an integratable family — if only one standard, keep;
        // if AI already marked integrated with all tokens missing, keep as-is.
        consolidated.push(group[0]);
        continue;
      }

      // Merge group into one integrated item
      const standardsSet = new Set<string>();
      const clausesByStandard: Record<string, string> = {};
      const descriptions: string[] = [];
      const apps: string[] = [];
      let clauseParts: string[] = [];

      for (const g of group) {
        for (const s of g.standards || (g.standard ? [g.standard] : [])) {
          standardsSet.add(s);
          if (g.clause) clausesByStandard[s] = g.clause;
        }
        if (g.clausesByStandard) {
          Object.assign(clausesByStandard, g.clausesByStandard);
        }
        if (g.description) descriptions.push(g.description);
        if (g.organizational_application) apps.push(g.organizational_application);
        if (g.clause) clauseParts.push(g.clause);
      }

      // Only consolidate when ≥2 standards are represented (real integration)
      if (standardsSet.size < 2 && group.length >= 2) {
        // Same family but same standard — keep first, drop dupes
        consolidated.push(group[0]);
        continue;
      }

      const standards = [...standardsSet];
      const uniqueClauses = [...new Set(clauseParts.filter(Boolean))];
      let mergedDescription = descriptions[0];
      if (fam.key === "policy") {
        mergedDescription =
          "The integrated policy must be available as documented information, be communicated within the organization, and be available to interested parties. It must cover the commitments required by the selected standards (for example quality, environmental protection including prevention of pollution, OH&S injury prevention, and compliance obligations where those standards apply).";
      } else if (fam.key === "objectives") {
        mergedDescription =
          "Integrated management-system objectives must be measurable and available as documented information across the selected standards.";
      } else if (!mergedDescription || mergedDescription.length < 20) {
        mergedDescription = `Integrated documented information addressing ${fam.integratedTitle.toLowerCase()} across ${standards.join(", ")}.`;
      }
      const merged: ImsDocumentedInfoItem = {
        title: fam.integratedTitle,
        description: mergedDescription,
        type: preferType,
        clause: uniqueClauses.join(" / ") || group[0].clause,
        standard: standards[0],
        standards,
        clausesByStandard:
          Object.keys(clausesByStandard).length > 0
            ? clausesByStandard
            : undefined,
        requirement: "required",
        category: "integrated",
        isIntegrated: true,
        isStandardSpecific: false,
        taxonomy:
          preferType === "record" ? "mandatory_record" : "mandatory_document",
        organizational_application: apps[0],
        sourceDocument: group.find((g) => g.sourceDocument)?.sourceDocument,
        integration_note: `Consolidated across ${standards.join(" + ")} where HLS-aligned requirements allow a shared IMS artefact.`,
      };
      consolidated.push(merged);
    }

    return [...consolidated, ...rest];
  };

  return {
    documents: processList(buckets.documents, "document"),
    records: processList(buckets.records, "record"),
    additional: buckets.additional,
  };
}

/**
 * Validate and prune unsupported / empty items. Does not invent clauses.
 */
export function validateImsInventoryBuckets(
  buckets: ImsNormalizedBuckets,
  selectedTokens: string[],
): ImsNormalizedBuckets {
  const clean = (list: ImsDocumentedInfoItem[]): ImsDocumentedInfoItem[] => {
    const out: ImsDocumentedInfoItem[] = [];
    const seen = new Set<string>();
    for (const item of list) {
      if (!item.title || item.title.length < 3) continue;
      if (isAnalysisCategoryTitle(item.title)) continue;
      if (/^ims$/i.test(item.clause)) {
        item.clause = item.standards?.join(" / ") || item.standard || "";
      }
      // Drop standards not in selection
      if (item.standards?.length) {
        item.standards = item.standards.filter((s) =>
          selectedTokens.some(
            (t) => familyKey(t) === familyKey(s) || matchSelectedStandard(s, [t]),
          ),
        );
        if (!item.standards.length) item.standards = undefined;
        else item.standard = item.standards[0];
      }
      if (
        item.standard &&
        !matchSelectedStandard(item.standard, selectedTokens) &&
        !selectedTokens.includes(item.standard)
      ) {
        item.standard = undefined;
      }
      // Require some grounding signal
      if (
        !item.clause &&
        !item.standard &&
        !(item.standards && item.standards.length) &&
        !item.sourceDocument
      ) {
        continue;
      }
      // Ensure meaningful description (requirement language) — org application enriched later
      if (!item.description || item.description.length < 12) {
        item.description =
          item.integration_note ||
          `${item.title} shall be available as documented information for the applicable management system requirements.`;
      }
      // Additional must never be labelled mandatory
      if (
        item.taxonomy === "additional" ||
        item.type === "additional" ||
        item.requirement === "necessary" ||
        item.requirement === "recommended"
      ) {
        item.type = "additional";
        item.taxonomy =
          item.requirement === "recommended" ? "recommended" : "additional";
        if (item.requirement === "required") item.requirement = "necessary";
      }
      const key = dedupeKey(item);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
    return out;
  };

  // Ensure additional items are not left inside documents/records
  const documents: ImsDocumentedInfoItem[] = [];
  const records: ImsDocumentedInfoItem[] = [];
  const additional: ImsDocumentedInfoItem[] = [];

  const route = (item: ImsDocumentedInfoItem) => {
    if (
      item.type === "additional" ||
      item.taxonomy === "additional" ||
      item.taxonomy === "recommended" ||
      item.requirement === "necessary" ||
      item.requirement === "recommended"
    ) {
      additional.push(item);
    } else if (item.type === "record" || item.taxonomy === "mandatory_record") {
      records.push(item);
    } else {
      documents.push(item);
    }
  };

  for (const item of clean(buckets.documents)) route(item);
  for (const item of clean(buckets.records)) route(item);
  for (const item of clean(buckets.additional)) route(item);

  return { documents, records, additional };
}

/**
 * Normalize AI / heuristic items into Navigator document/record/additional cards.
 * Drops analysis headings, fabrications without title, and Clause:IMS placeholders.
 */
export function normalizeImsDocumentedInfoItems(
  rawItems: unknown[],
  selectedTokens: string[],
  orgContext?: string,
): ImsNormalizedBuckets {
  const documents: ImsDocumentedInfoItem[] = [];
  const records: ImsDocumentedInfoItem[] = [];
  const additional: ImsDocumentedInfoItem[] = [];
  const seen = new Set<string>();
  const orgSnippet = String(orgContext || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 400);

  for (const raw of rawItems) {
    if (!isPlainObject(raw)) continue;
    const title = String(raw.title || raw.name || "")
      .replace(/\s+/g, " ")
      .trim();
    if (!title || title.length < 3) continue;
    if (isAnalysisCategoryTitle(title)) continue;

    const clause = normalizeClause(raw.clause || raw.reference || raw.sourceReference);
    const standards = normalizeStandardsField(raw, selectedTokens);
    const kind = classifyKind(raw);
    const requirement = classifyRequirement(raw);
    const clausesByStandard = normalizeClausesByStandard(
      raw,
      selectedTokens,
      clause,
      standards,
    );

    let category: "integrated" | "standard_specific" =
      String(raw.category || "").toLowerCase().includes("integr") ||
      raw.isIntegrated === true ||
      standards.length >= 2
        ? "integrated"
        : "standard_specific";

    if (raw.isStandardSpecific === true) category = "standard_specific";
    if (standards.length >= 2) category = "integrated";
    if (standards.length === 1 && category === "integrated") {
      if (raw.isIntegrated !== true) category = "standard_specific";
    }

    const isAdditional =
      requirement === "necessary" ||
      requirement === "recommended" ||
      String(raw.type || "").toLowerCase() === "additional" ||
      String(raw.bucket || raw.category_bucket || "")
        .toLowerCase()
        .includes("additional");

    const taxonomy = isAdditional
      ? requirement === "recommended"
        ? "recommended"
        : "additional"
      : kind === "record"
        ? "mandatory_record"
        : "mandatory_document";

    const primaryStandard =
      standards[0] ||
      matchSelectedStandard(String(raw.standard || ""), selectedTokens);

    const description =
      String(raw.description || "").trim() || undefined;
    const organizational_application = buildOrganizationalApplication({
      title,
      description,
      orgContext: orgSnippet,
      existingApplication: String(
        raw.organizational_application ||
          raw.organizationalApplication ||
          raw.organization_context_application ||
          "",
      ).trim(),
    });

    const item: ImsDocumentedInfoItem = {
      title,
      description,
      type: isAdditional ? "additional" : kind,
      clause: clause || (standards.length ? standards.join(" / ") : ""),
      standard: primaryStandard,
      standards: standards.length ? standards : undefined,
      clausesByStandard,
      requirement,
      category,
      isIntegrated: category === "integrated",
      isStandardSpecific: category === "standard_specific",
      taxonomy,
      organizational_application,
      sourceDocument: String(raw.sourceDocument || raw.source || "").trim() || undefined,
      sourceReference: String(raw.sourceReference || "").trim() || undefined,
      integration_note:
        String(raw.integration_note || raw.note || "").trim() || undefined,
    };

    if (!item.clause && !item.standard && !item.standards?.length) {
      if (/^ims\b/i.test(title) || /analysis|overview|mapping/i.test(title)) {
        continue;
      }
    }

    if (/^ims$/i.test(item.clause)) {
      item.clause = item.standards?.join(" / ") || item.standard || "";
    }

    const key = dedupeKey(item);
    if (seen.has(key)) continue;
    seen.add(key);

    const targetList = isAdditional
      ? additional
      : kind === "record"
        ? records
        : documents;

    const sameTitle = targetList.find(
      (d) =>
        titleKey(d.title) === titleKey(title) &&
        d.clause === item.clause,
    );
    if (sameTitle && item.standard && sameTitle.standard !== item.standard) {
      const merged = new Set([
        ...(sameTitle.standards || (sameTitle.standard ? [sameTitle.standard] : [])),
        ...(item.standards || (item.standard ? [item.standard] : [])),
      ]);
      if (merged.size >= 2) {
        sameTitle.standards = [...merged];
        sameTitle.standard = sameTitle.standards[0];
        sameTitle.category = "integrated";
        sameTitle.isIntegrated = true;
        sameTitle.isStandardSpecific = false;
        if (item.clausesByStandard || sameTitle.clausesByStandard) {
          sameTitle.clausesByStandard = {
            ...(sameTitle.clausesByStandard || {}),
            ...(item.clausesByStandard || {}),
          };
        }
        if (
          !isAdditional &&
          !/^integrated\b/i.test(sameTitle.title) &&
          findIntegratableFamily(sameTitle.title)
        ) {
          const fam = findIntegratableFamily(sameTitle.title);
          if (fam) sameTitle.title = fam.integratedTitle;
          else sameTitle.title = `Integrated ${sameTitle.title}`;
        }
        continue;
      }
    }

    targetList.push(item);
  }

  return consolidateIntegratableItems(
    { documents, records, additional },
    selectedTokens,
  );
}

function extractJsonObject(text: string): unknown {
  const raw = String(text || "").trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    /* fall through */
  }
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {
      /* fall through */
    }
  }
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(raw.slice(start, end + 1));
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Lightweight heuristic fallback when the AI JSON extract fails.
 * Only surfaces items that look grounded (clause-like + documented-info wording).
 */
export function heuristicExtractFromGrounding(
  excerpt: string,
  selectedTokens: string[],
  orgContext?: string,
): ImsNormalizedBuckets {
  const items: Record<string, unknown>[] = [];
  const text = (excerpt || "").replace(/\s+/g, " ");
  if (!text) return { documents: [], records: [], additional: [] };

  const blocks = text.split(
    /(?=PRIMARY IMS SOURCE|ISO STANDARD \(|SELECTED ISO STANDARDS)/i,
  );

  for (const block of blocks) {
    const stdMatch = block.match(/ISO STANDARD \(([^)]+)\)/i);
    const blockStandard =
      matchSelectedStandard(stdMatch?.[1] || "", selectedTokens) ||
      matchSelectedStandard(block.slice(0, 200), selectedTokens);

    const re =
      /(?:clause\s*)?(\d+(?:\.\d+){0,4})\s[^.]{0,80}?\b(shall\s+(?:maintain|retain|establish|keep|document)|documented information|as evidence of)\b[^.]{10,180}/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(block)) !== null) {
      const clause = m[1];
      const snippet = m[0].replace(/\s+/g, " ").trim();
      const isRecord =
        /\bretain\b|\bas evidence\b|\brecord/i.test(snippet) ||
        /\bresults?\b/i.test(snippet);
      let title = snippet
        .replace(/^(?:clause\s*)?\d+(?:\.\d+){0,4}\s*/i, "")
        .replace(/\bshall\s+/i, "")
        .slice(0, 90)
        .trim();
      title = title.charAt(0).toUpperCase() + title.slice(1);
      if (title.length < 12) continue;
      items.push({
        title,
        clause,
        type: isRecord ? "record" : "document",
        standard: blockStandard,
        standards: blockStandard ? [blockStandard] : undefined,
        requirement: /shall/i.test(snippet) ? "required" : "necessary",
        category:
          !blockStandard && selectedTokens.length >= 2
            ? "integrated"
            : "standard_specific",
        description: snippet.slice(0, 220),
      });
      if (items.length >= 60) break;
    }
    if (items.length >= 60) break;
  }

  return normalizeImsDocumentedInfoItems(items, selectedTokens, orgContext);
}

async function callImsInventoryAi(params: {
  imsLabel: string;
  selectedTokens: string[];
  excerpt: string;
  imsGuideTitle?: string;
  organizationContext?: string;
}): Promise<Record<string, unknown>[]> {
  const standardsList = params.selectedTokens.join(", ");
  const orgCtx = String(params.organizationContext || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1200);

  const prompt = `You extract documented information and records for an Integrated Management System (IMS).

SELECTED IMS LABEL:
${params.imsLabel}

SELECTED STANDARDS ONLY (do not invent or add others):
${standardsList}

ORGANIZATIONAL CONTEXT (from Navigator Steps 1–2 — use for application text only; do NOT invent facts beyond this):
<<<
${orgCtx || "(No organizational context provided — use standards-grounded general application text only.)"}
>>>

PRIMARY IMS GUIDE:
${params.imsGuideTitle || "Integrated Management System – A Practical Guide"}

SOURCE EXCERPTS (IMS Practical Guide + selected standards only):
<<<
${params.excerpt.slice(0, 28000)}
>>>

TASK — produce THREE categories of documented information (reference table fields for each item):
  1) clause
  2) title (Documented Information Requirement)
  3) standards (Applicable Standards — only those that truly apply)
  4) organizational_application (Organizational Context & Application for THIS organization)
  5) description (what the requirement covers)

A) MANDATORY IMS DOCUMENTS (requirement: "required", type: "document")
   Policies, plans, frameworks, scopes, objectives, and operational documentation the selected standards require the organization to maintain/establish.
   When HLS-aligned and evidence supports it, prefer ONE Integrated Management Policy and ONE IMS Objectives set — not separate Quality/Environmental/OH&S policies or objectives.
   KEEP THESE AS SEPARATE DOCUMENTS when both are supported (do not merge them):
   - "Process for Addressing Risks & Opportunities" (typically ~6.1.1)
   - "Risks and Opportunities" register/list (typically ~6.1.4)
   Include where applicable to SELECTED standards only:
   - Scope of the Management System; Integrated Management Policy; Environmental Aspects & OH&S Hazards (14001/45001); Compliance Obligations (14001/45001); Operational Planning and Control; Emergency Preparedness and Response (14001/45001); Statement of Applicability (27001); AI-specific documented information (42001).

B) MANDATORY IMS RECORDS — Evidence of Implementation (requirement: "required", type: "record")
   Evidence retained for competence, communication (where applicable), requirements review / design & development (9001 where applicable), external provider evaluations, monitoring/measurement/analysis/evaluation, evaluation of compliance (14001/45001), internal audit programme & results, management review results, nonconformities/incidents/corrective actions.
   Integrate shared evidence records where justified; keep unique records separate.

C) ADDITIONAL DOCUMENTED INFORMATION NECESSARY FOR IMS EFFECTIVENESS (requirement: "necessary", type: "additional")
   Organization-determined items needed for effective IMS operation (e.g. Worker Consultation and Participation for 45001, Calibration Records, Change Management Logs) — NOT labelled mandatory.
   Only include when grounded in sources or clearly justified by organizational context.

INTEGRATION RULES:
- Evaluate requirements TOGETHER across selected standards — do NOT emit three separate per-standard lists glued together.
- Merge equivalent common requirements into ONE integrated item with "standards": [all applicable selected tokens] and optional "clausesByStandard".
- Do NOT merge merely to shorten the list if substance would be lost.
- Do NOT assign every selected standard to every item — only standards supported by source evidence.
- Matching clause numbers across standards do NOT prove identical requirements.
- Never invent clause numbers, document names, or standards not in SELECTED STANDARDS / SOURCE EXCERPTS.
- Never use "IMS" as the clause value.
- Do NOT return analysis headings ("Integrated / Common Requirements", "Maintain vs Retain", etc.).
- Use organizational context for "organizational_application" — tailor to THIS organization; never invent airport/DXB or other fictional org details.
- Include as many grounded items as the excerpts support (completeness over a fixed count).

Return ONLY valid JSON (no markdown):
{
  "items": [
    {
      "title": "string",
      "description": "string — what the document/record covers",
      "organizational_application": "string — how it applies to THIS organization",
      "type": "document" | "record" | "additional",
      "clause": "primary clause e.g. 4.3 or 6.1.2",
      "clausesByStandard": { "ISO 9001:2015": "5.2", "ISO 14001:2015": "5.2" },
      "standard": "one selected token when standard-specific",
      "standards": ["selected tokens when integrated / multi-applicable"],
      "requirement": "required" | "necessary" | "recommended",
      "category": "integrated" | "standard_specific",
      "sourceDocument": "IMS guide or standard title if known"
    }
  ]
}`;

  const formData = new FormData();
  formData.append("messages", prompt);
  formData.append(
    "context",
    JSON.stringify({
      purpose: "navigator_ims_documented_information_inventory",
      specific_requirements: params.imsLabel,
      selected_standards: params.selectedTokens,
      locked_standards: params.selectedTokens,
      allow_unselected_standards: false,
      ims_guide_title: params.imsGuideTitle || undefined,
      has_iso_grounding: true,
      has_organization_context: Boolean(orgCtx),
      instruction:
        "Use ONLY locked_standards / selected_standards. Never add, invent, or mention ISO families outside that list.",
    }),
  );

  const response = await axios.post(
    `${process.env.AI_BASE_URL}/chat`,
    formData,
    {
      headers: formData.getHeaders(),
      timeout: 120000,
    },
  );
  const data = response.data;
  const text = String(
    data?.response ||
      data?.reply ||
      data?.message ||
      data?.content ||
      data?.data?.response ||
      data?.data?.content ||
      "",
  ).trim();

  const parsed = extractJsonObject(text);
  if (!isPlainObject(parsed)) return [];
  if (Array.isArray(parsed.items)) {
    return parsed.items.filter(isPlainObject) as Record<string, unknown>[];
  }
  const docs = Array.isArray(parsed.documents) ? parsed.documents : [];
  const recs = Array.isArray(parsed.records) ? parsed.records : [];
  const add =
    Array.isArray(parsed.additional) ? parsed.additional :
    Array.isArray(parsed.additional_documented_information)
      ? parsed.additional_documented_information
      : [];
  return [...docs, ...recs, ...add].filter(isPlainObject) as Record<
    string,
    unknown
  >[];
}

/**
 * Build source-grounded Documents & Records for an IMS Navigator selection.
 */
export async function buildImsDocumentedInformationInventory(
  specificRequirements: string,
  options?: { organizationContext?: string },
): Promise<ImsDocumentedInfoInventory> {
  const imsLabel = String(specificRequirements || "").trim();
  const orgContext = String(options?.organizationContext || "").trim();
  if (!looksLikeImsRequirement(imsLabel)) {
    return { documents: [], records: [], additional: [] };
  }
  const selectedTokens = collectImsIntegrationStandardTokens(imsLabel);
  if (selectedTokens.length < 2) {
    return { documents: [], records: [], additional: [] };
  }

  const grounding = await getNavigatorGroundingExcerpt({
    specificRequirements: imsLabel,
    documentTitle:
      "Documented information and records required for the Integrated Management System",
    queryHints:
      "documented information maintain retain mandatory documents records evidence internal audit management review risk assessment statement of applicability policy objectives scope competence nonconformity corrective action environmental aspects OH&S hazards compliance obligations operational planning emergency preparedness calibration change management worker consultation",
    skipSupporting: true,
    deepInventory: true,
  });

  if (!grounding.imsGuideAvailable) {
    console.log(
      "[Navigator][IMS inventory] IMS Practical Guide unavailable — refusing invented document list",
    );
    return {
      documents: [],
      records: [],
      additional: [],
      imsGuideAvailable: false,
      missingEditions: grounding.missingEditions,
      groundingSources: grounding.groundingSources?.map((s) => ({
        standard: s.standard,
        documentId: s.documentId,
        version: s.version,
      })),
      excerptChars: 0,
    };
  }

  if (!grounding.excerpt || grounding.excerpt.length < 200) {
    console.log(
      "[Navigator][IMS inventory] grounding excerpt too small — returning empty",
    );
    return {
      documents: [],
      records: [],
      additional: [],
      imsGuideTitle: grounding.imsGuideTitle,
      imsGuideAvailable: grounding.imsGuideAvailable,
      missingEditions: grounding.missingEditions,
      groundingSources: grounding.groundingSources?.map((s) => ({
        standard: s.standard,
        documentId: s.documentId,
        version: s.version,
      })),
      excerptChars: grounding.excerpt?.length || 0,
    };
  }

  let rawItems: Record<string, unknown>[] = [];
  try {
    rawItems = await callImsInventoryAi({
      imsLabel,
      selectedTokens,
      excerpt: grounding.excerpt,
      imsGuideTitle: grounding.imsGuideTitle,
      organizationContext: orgContext,
    });
  } catch (err) {
    console.log("[Navigator][IMS inventory] AI extract failed", err);
  }

  let normalized = normalizeImsDocumentedInfoItems(
    rawItems,
    selectedTokens,
    orgContext,
  );

  if (
    normalized.documents.length +
      normalized.records.length +
      normalized.additional.length <
    6
  ) {
    const heuristic = heuristicExtractFromGrounding(
      grounding.excerpt,
      selectedTokens,
      orgContext,
    );
    normalized = normalizeImsDocumentedInfoItems(
      [
        ...normalized.documents,
        ...normalized.records,
        ...normalized.additional,
        ...heuristic.documents,
        ...heuristic.records,
        ...heuristic.additional,
      ],
      selectedTokens,
      orgContext,
    );
  }

  // Evidence-gated coverage fill (completeness without blind catalogue dump)
  normalized = fillCoverageFromGroundingEvidence(
    normalized,
    selectedTokens,
    grounding.excerpt,
    orgContext,
  );
  normalized = applyTitleApplicabilityFilters(normalized, selectedTokens);
  normalized = groundClausesAgainstExcerpt(normalized, grounding.excerpt);
  normalized = validateImsInventoryBuckets(normalized, selectedTokens);
  normalized = stabilizePredeterminedInventoryItems(normalized);
  // Client Excel checklist for 27001+42001 IMS (video / attached workbook)
  normalized = mergeChecklistPreferredInventory(
    normalized,
    selectedTokens,
    orgContext,
  );
  normalized = lockInventoryToSelectedStandards(normalized, selectedTokens);
  normalized = enrichOrganizationalApplications(normalized, orgContext);
  // Final lock after org enrichment (prevents unselected ISO mentions in application text)
  normalized = lockInventoryToSelectedStandards(normalized, selectedTokens);

  console.log(
    `[Navigator][IMS inventory] docs=${normalized.documents.length} records=${normalized.records.length} additional=${normalized.additional.length} excerptChars=${grounding.excerpt.length} guide=${grounding.imsGuideTitle || "n/a"} standards=${selectedTokens.join("+")}`,
  );

  return {
    documents: normalized.documents,
    records: normalized.records,
    additional: normalized.additional,
    imsGuideTitle: grounding.imsGuideTitle,
    imsGuideAvailable: grounding.imsGuideAvailable,
    missingEditions: grounding.missingEditions,
    groundingSources: grounding.groundingSources?.map((s) => ({
      standard: s.standard,
      documentId: s.documentId,
      version: s.version,
    })),
    excerptChars: grounding.excerpt.length,
  };
}

/** True when suggestion docs are still analysis placeholders or pending enrichment. */
export function imsSuggestionNeedsDocumentInventory(sug: Record<string, unknown>): boolean {
  if (sug.ims_inventory_pending === true) return true;
  const docs = Array.isArray(sug.documents) ? sug.documents : [];
  if (!docs.length) return true;
  return docs.every(
    (d) =>
      isPlainObject(d) &&
      (d.ims_role === "analysis" ||
        /^ims$/i.test(String(d.clause || "")) ||
        isAnalysisCategoryTitle(String(d.title || ""))),
  );
}
