export type DocumentTaxonomy =
  | "mandatory_document"
  | "mandatory_record"
  | "recommended";

export type OrganizationContextStructured = {
  what?: string;
  where?: string;
  why?: string;
  when?: string;
  whom?: string;
};

export type TGenerateISO = {
  organization_context: string | OrganizationContextStructured;
  organization_context_structured?: OrganizationContextStructured;
  output_type: string;
  document_title?: string;
  specific_requirements?: string;
  clause?: string;
  document_taxonomy?: DocumentTaxonomy;
  tone?: string;
  language?: string;
};

export type TGeneratedISODocument = {
  title: string;
  content: string;
  metadata: {
    organization_context: string;
    tone: string;
    language: string;
    clause?: string;
    document_taxonomy?: string;
    iso_standard?: string;
    grounded_standard?: string;
  };
  iso_clauses_referenced: string[];
  generation_timestamp: string;
  word_count: number;
  confidence_score: number;
  documented_template?: string;
  implementation_guidance?: string;
  daily_usability?: string;
};
