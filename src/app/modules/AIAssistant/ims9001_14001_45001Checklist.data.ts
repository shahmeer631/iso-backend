/**
 * Client-provided IMS documented-information checklist for
 * ISO 9001 + ISO 14001 + ISO 45001 (QHSE).
 * Source: downloadfile.docx (client Oct 13 / NotebookLM gold list).
 * Used only when Navigator IMS selection includes 9001, 14001, and 45001.
 *
 * Section order (client requirement):
 * 1 Common Integrated Core → 2 ISO 9001 → 3 ISO 14001 → 4 ISO 45001
 */

export type ImsQhseChecklistSection =
  | "common"
  | "iso9001"
  | "iso14001"
  | "iso45001";

export type ImsQhseChecklistRow = {
  section: ImsQhseChecklistSection;
  /** Sort within docs/records buckets: common first, then 9001, 14001, 45001 */
  sectionOrder: 1 | 2 | 3 | 4;
  docId: string;
  standardReference: string;
  title: string;
  /** "Maintained Document" | "Retained Record" */
  docCategory: string;
  domain: string;
  description: string;
  evidenceCriteria: string;
};

export const IMS_QHSE_9001_14001_45001_CHECKLIST: ImsQhseChecklistRow[] = [
  // ——— 1. Common Integrated Core (Annex SL shared) ———
  {
    section: "common",
    sectionOrder: 1,
    docId: "QHSE-DOC-4.3",
    standardReference: "ISO 9001/14001/45001 Cl. 4.3",
    title: "Scope of the IMS",
    docCategory: "Maintained Document",
    domain: "Common Integrated",
    description:
      "Maintained document detailing physical boundaries, organizational units, activities, products/services, and external dependencies.",
    evidenceCriteria:
      "Approved scope statement covering physical, organizational, and activity boundaries of the integrated QHSE management system.",
  },
  {
    section: "common",
    sectionOrder: 1,
    docId: "QHSE-DOC-5.2",
    standardReference: "ISO 9001/14001/45001 Cl. 5.2",
    title: "Integrated Management Policy",
    docCategory: "Maintained Document",
    domain: "Common Integrated",
    description:
      "Maintained policy statement expressing top management commitments to product/service quality, environmental protection, pollution prevention, legal compliance, and safe/healthy working conditions.",
    evidenceCriteria:
      "Published IMS policy approved by top management and communicated across the organization.",
  },
  {
    section: "common",
    sectionOrder: 1,
    docId: "QHSE-DOC-5.3",
    standardReference: "ISO 9001/14001/45001 Cl. 5.3",
    title: "Roles, Responsibilities & Authorities",
    docCategory: "Maintained Document",
    domain: "Common Integrated",
    description:
      "Maintained organization charts, job descriptions, and governance matrices for the IMS.",
    evidenceCriteria:
      "Current organization charts / RACI / job descriptions defining IMS roles and authorities.",
  },
  {
    section: "common",
    sectionOrder: 1,
    docId: "QHSE-REC-6.1.1",
    standardReference: "ISO 9001/14001/45001 Cl. 6.1.1",
    title: "IMS Risks & Opportunities Register",
    docCategory: "Retained Record",
    domain: "Common Integrated",
    description:
      "Retained documentation addressing organizational risks, business continuity, climate change considerations, and operational opportunities.",
    evidenceCriteria:
      "Signed risks and opportunities register covering quality, environment, and OH&S considerations.",
  },
  {
    section: "common",
    sectionOrder: 1,
    docId: "QHSE-DOC-6.1.3",
    standardReference: "ISO 9001/14001/45001 Cl. 6.1.3 / Cl. 9.1.2",
    title: "Legal & Compliance Obligations Register",
    docCategory: "Maintained Document",
    domain: "Common Integrated",
    description:
      "Maintained register listing applicable statutory, regulatory, and contractual obligations.",
    evidenceCriteria:
      "Up-to-date legal and compliance obligations register with owners and review dates.",
  },
  {
    section: "common",
    sectionOrder: 1,
    docId: "QHSE-DOC-6.2",
    standardReference: "ISO 9001/14001/45001 Cl. 6.2",
    title: "Integrated IMS Objectives & Action Plans",
    docCategory: "Maintained Document",
    domain: "Common Integrated",
    description:
      "Maintained target sheets and strategic programs to achieve quality metrics, environmental goals, and workplace safety performance.",
    evidenceCriteria:
      "Approved IMS objectives with measurable targets, action plans, resources, and timelines.",
  },
  {
    section: "common",
    sectionOrder: 1,
    docId: "QHSE-REC-7.2",
    standardReference: "ISO 9001/14001/45001 Cl. 7.2",
    title: "Evidence of Competence",
    docCategory: "Retained Record",
    domain: "Common Integrated",
    description:
      "Retained records of education, training, certifications, licenses, and skill evaluations.",
    evidenceCriteria:
      "Training records, certificates, competence evaluations, and qualification matrices.",
  },
  {
    section: "common",
    sectionOrder: 1,
    docId: "QHSE-REC-7.4",
    standardReference: "ISO 9001/14001/45001 Cl. 7.4",
    title: "Evidence of Internal & External Communications",
    docCategory: "Retained Record",
    domain: "Common Integrated",
    description:
      "Retained communication logs, stakeholder notices, worker briefings, and regulatory submittals.",
    evidenceCriteria:
      "Communication logs, briefings, notices, and regulatory submission records.",
  },
  {
    section: "common",
    sectionOrder: 1,
    docId: "QHSE-DOC-7.5",
    standardReference: "ISO 9001/14001/45001 Cl. 7.5",
    title: "Control of Documented Information Protocols",
    docCategory: "Maintained Document",
    domain: "Common Integrated",
    description:
      "Maintained system procedures defining creation, revision tracking, approval, access rights, distribution, storage, and secure disposal.",
    evidenceCriteria:
      "Document control procedure covering create, revise, approve, access, store, and dispose.",
  },
  {
    section: "common",
    sectionOrder: 1,
    docId: "QHSE-REC-9.1.1",
    standardReference: "ISO 9001/14001/45001 Cl. 9.1.1",
    title: "Monitoring, Measurement, Analysis & Evaluation Results",
    docCategory: "Retained Record",
    domain: "Common Integrated",
    description:
      "Retained data reports, performance logs, and operational indicators.",
    evidenceCriteria:
      "Performance reports and monitoring/measurement results against IMS indicators.",
  },
  {
    section: "common",
    sectionOrder: 1,
    docId: "QHSE-REC-7.1.5",
    standardReference: "ISO 9001/14001/45001 Cl. 7.1.5 / Cl. 9.1.1",
    title: "Calibration & Verification Records",
    docCategory: "Retained Record",
    domain: "Common Integrated",
    description:
      "Retained proof of fitness for purpose and measurement traceability for inspection and monitoring equipment.",
    evidenceCriteria:
      "Calibration certificates, verification logs, and equipment fitness records.",
  },
  {
    section: "common",
    sectionOrder: 1,
    docId: "QHSE-REC-9.1.2",
    standardReference: "ISO 9001/14001/45001 Cl. 9.1.2",
    title: "Compliance Evaluation Results",
    docCategory: "Retained Record",
    domain: "Common Integrated",
    description:
      "Retained reports verifying periodic evaluations of legal and regulatory compliance.",
    evidenceCriteria:
      "Periodic compliance evaluation reports with findings and follow-up actions.",
  },
  {
    section: "common",
    sectionOrder: 1,
    docId: "QHSE-REC-9.2",
    standardReference: "ISO 9001/14001/45001 Cl. 9.2",
    title: "Internal Audit Program & Audit Results",
    docCategory: "Retained Record",
    domain: "Common Integrated",
    description:
      "Retained audit schedules, auditor competency checks, audit plans, finding logs, and final reports.",
    evidenceCriteria:
      "Audit programme, plans, competency evidence, findings, and audit reports.",
  },
  {
    section: "common",
    sectionOrder: 1,
    docId: "QHSE-REC-9.3",
    standardReference: "ISO 9001/14001/45001 Cl. 9.3",
    title: "Management Review Results",
    docCategory: "Retained Record",
    domain: "Common Integrated",
    description:
      "Retained executive meeting minutes, action items, resource decisions, and strategic direction reviews.",
    evidenceCriteria:
      "Management review minutes with inputs, outputs, decisions, and action items.",
  },
  {
    section: "common",
    sectionOrder: 1,
    docId: "QHSE-REC-10.2",
    standardReference: "ISO 9001/14001/45001 Cl. 10.2",
    title: "Nonconformities, Incidents & Corrective Action Records",
    docCategory: "Retained Record",
    domain: "Common Integrated",
    description:
      "Retained records detailing root cause analysis (e.g., 5-Whys), corrective measures, and post-implementation effectiveness reviews.",
    evidenceCriteria:
      "NCR/incident/CAR records with root cause, actions, and effectiveness verification.",
  },

  // ——— 2. ISO 9001:2026 Specific (Quality) ———
  {
    section: "iso9001",
    sectionOrder: 2,
    docId: "QHSE-9001-DOC-4.4",
    standardReference: "ISO 9001 Cl. 4.4.2 / Cl. 8.1",
    title: "Process Operation & Execution Information",
    docCategory: "Maintained Document",
    domain: "ISO 9001 Quality",
    description:
      "Maintained process maps, standard operating procedures (SOPs), work instructions, and acceptance criteria.",
    evidenceCriteria:
      "Process maps, SOPs, work instructions, and defined acceptance criteria.",
  },
  {
    section: "iso9001",
    sectionOrder: 2,
    docId: "QHSE-9001-REC-8.2.3",
    standardReference: "ISO 9001 Cl. 8.2.3.2",
    title: "Review of Product/Service Requirements",
    docCategory: "Retained Record",
    domain: "ISO 9001 Quality",
    description:
      "Retained contract review results, order confirmations, and customer requirement change logs.",
    evidenceCriteria:
      "Contract/order review records and requirement change logs.",
  },
  {
    section: "iso9001",
    sectionOrder: 2,
    docId: "QHSE-9001-REC-8.3",
    standardReference: "ISO 9001 Cl. 8.3",
    title: "Design & Development Inputs, Controls, Outputs & Changes",
    docCategory: "Retained Record",
    domain: "ISO 9001 Quality",
    description:
      "Retained design specifications, verification/validation reports, review sign-offs, and design change records.",
    evidenceCriteria:
      "Design inputs/outputs, reviews, V&V reports, and design change records.",
  },
  {
    section: "iso9001",
    sectionOrder: 2,
    docId: "QHSE-9001-REC-8.4.1",
    standardReference: "ISO 9001 Cl. 8.4.1",
    title: "External Provider Evaluation & Monitoring",
    docCategory: "Retained Record",
    domain: "ISO 9001 Quality",
    description:
      "Retained supplier approvals, performance rating records, and re-evaluation action logs.",
    evidenceCriteria:
      "Approved supplier list, performance ratings, and re-evaluation records.",
  },
  {
    section: "iso9001",
    sectionOrder: 2,
    docId: "QHSE-9001-REC-8.5.2",
    standardReference: "ISO 9001 Cl. 8.5.2",
    title: "Traceability Records",
    docCategory: "Retained Record",
    domain: "ISO 9001 Quality",
    description:
      "Retained unique identification tags, batch numbers, serial codes, and tracking logs when traceability is required.",
    evidenceCriteria:
      "Identification/traceability logs (batch, serial, or unique ID) where required.",
  },
  {
    section: "iso9001",
    sectionOrder: 2,
    docId: "QHSE-9001-REC-8.5.3",
    standardReference: "ISO 9001 Cl. 8.5.3",
    title: "Customer/External Provider Property Reports",
    docCategory: "Retained Record",
    domain: "ISO 9001 Quality",
    description:
      "Retained logs recording lost, damaged, or unsuitable customer/supplier property.",
    evidenceCriteria:
      "Property control logs for lost, damaged, or unsuitable customer/provider property.",
  },
  {
    section: "iso9001",
    sectionOrder: 2,
    docId: "QHSE-9001-REC-8.5.6",
    standardReference: "ISO 9001 Cl. 8.5.6",
    title: "Control of Production/Service Changes",
    docCategory: "Retained Record",
    domain: "ISO 9001 Quality",
    description:
      "Retained change review minutes, change authorization records, and risk mitigation actions.",
    evidenceCriteria:
      "Change review/authorization records and related risk mitigation evidence.",
  },
  {
    section: "iso9001",
    sectionOrder: 2,
    docId: "QHSE-9001-REC-8.6",
    standardReference: "ISO 9001 Cl. 8.6",
    title: "Release of Products & Services",
    docCategory: "Retained Record",
    domain: "ISO 9001 Quality",
    description:
      "Retained evidence of conformity against acceptance criteria and signatures of authorized release personnel.",
    evidenceCriteria:
      "Release records showing conformity evidence and authorized release signatures.",
  },
  {
    section: "iso9001",
    sectionOrder: 2,
    docId: "QHSE-9001-REC-8.7.2",
    standardReference: "ISO 9001 Cl. 8.7.2",
    title: "Control of Nonconforming Outputs",
    docCategory: "Retained Record",
    domain: "ISO 9001 Quality",
    description:
      "Retained descriptions of nonconformities, segregation actions, concessions granted, and re-verification logs.",
    evidenceCriteria:
      "Nonconforming output records with disposition, concessions, and re-verification.",
  },
  {
    section: "iso9001",
    sectionOrder: 2,
    docId: "QHSE-9001-REC-9.1.2",
    standardReference: "ISO 9001 Cl. 9.1.2",
    title: "Customer Satisfaction Data",
    docCategory: "Retained Record",
    domain: "ISO 9001 Quality",
    description:
      "Retained survey results, feedback analytics, customer complaints, and trend reports.",
    evidenceCriteria:
      "Customer satisfaction surveys, complaint logs, and trend analysis reports.",
  },

  // ——— 3. ISO 14001:2026 Specific (Environment) ———
  {
    section: "iso14001",
    sectionOrder: 3,
    docId: "QHSE-14001-DOC-6.1.2",
    standardReference: "ISO 14001 Cl. 6.1.2",
    title: "Environmental Aspects, Impacts & Evaluation Criteria",
    docCategory: "Maintained Document",
    domain: "ISO 14001 Environment",
    description:
      "Maintained environmental aspects register, methodology for determining significance, and the master list of Significant Environmental Aspects (SEAs).",
    evidenceCriteria:
      "Aspects/impacts register with significance criteria and SEA master list.",
  },
  {
    section: "iso14001",
    sectionOrder: 3,
    docId: "QHSE-14001-DOC-6.1.3",
    standardReference: "ISO 14001 Cl. 6.1.3",
    title: "Environmental Compliance Obligations",
    docCategory: "Maintained Document",
    domain: "ISO 14001 Environment",
    description:
      "Maintained documentation of legal mandates, environmental permits, emissions standards, and discharge consent conditions.",
    evidenceCriteria:
      "Environmental permits, emissions/discharge consents, and legal mandate register.",
  },
  {
    section: "iso14001",
    sectionOrder: 3,
    docId: "QHSE-14001-DOC-8.1",
    standardReference: "ISO 14001 Cl. 8.1",
    title: "Operational Control Procedures",
    docCategory: "Maintained Document",
    domain: "ISO 14001 Environment",
    description:
      "Maintained operating criteria for waste management, chemical storage, wastewater treatment, air emissions abatement, and energy/resource conservation.",
    evidenceCriteria:
      "Operational control procedures/criteria for significant environmental aspects.",
  },
  {
    section: "iso14001",
    sectionOrder: 3,
    docId: "QHSE-14001-DOC-8.2",
    standardReference: "ISO 14001 Cl. 8.2",
    title: "Emergency Preparedness & Response Processes",
    docCategory: "Maintained Document",
    domain: "ISO 14001 Environment",
    description:
      "Maintained emergency plans for potential chemical spills, gas leaks, fires, or environmental contamination.",
    evidenceCriteria:
      "Documented emergency preparedness and response plans for environmental incidents.",
  },
  {
    section: "iso14001",
    sectionOrder: 3,
    docId: "QHSE-14001-REC-8.2",
    standardReference: "ISO 14001 Cl. 8.2",
    title: "Emergency Drill & Test Evidence",
    docCategory: "Retained Record",
    domain: "ISO 14001 Environment",
    description:
      "Retained records of emergency response drills, spill response simulation reviews, and corrective actions taken.",
    evidenceCriteria:
      "Drill/test records, spill simulation reviews, and related corrective actions.",
  },

  // ——— 4. ISO 45001:2018 Specific (OH&S) ———
  {
    section: "iso45001",
    sectionOrder: 4,
    docId: "QHSE-45001-DOC-6.1.2.2",
    standardReference: "ISO 45001 Cl. 6.1.2.2",
    title: "Hazard Identification & Risk Assessment Methodology",
    docCategory: "Maintained Document",
    domain: "ISO 45001 OH&S",
    description:
      "Maintained methodologies, criteria, and processes for evaluating occupational hazards and health/safety risks.",
    evidenceCriteria:
      "Documented OH&S hazard identification and risk assessment methodology.",
  },
  {
    section: "iso45001",
    sectionOrder: 4,
    docId: "QHSE-45001-DOC-6.1.2",
    standardReference: "ISO 45001 Cl. 6.1.1 / Cl. 6.1.2",
    title: "OH&S Hazard & Risk Register",
    docCategory: "Maintained Document",
    domain: "ISO 45001 OH&S",
    description:
      "Maintained master list of identified hazards, risk ratings, and applied controls (Elimination, Substitution, Engineering, Administrative, PPE).",
    evidenceCriteria:
      "Current OH&S hazard and risk register with ratings and hierarchy-of-controls measures.",
  },
  {
    section: "iso45001",
    sectionOrder: 4,
    docId: "QHSE-45001-DOC-5.4",
    standardReference: "ISO 45001 Cl. 5.4",
    title: "Worker Consultation & Participation Protocols",
    docCategory: "Maintained Document",
    domain: "ISO 45001 OH&S",
    description:
      "Maintained procedures establishing health & safety committees, worker representative election methods, and feedback channels.",
    evidenceCriteria:
      "Documented worker consultation and participation procedures.",
  },
  {
    section: "iso45001",
    sectionOrder: 4,
    docId: "QHSE-45001-REC-5.4",
    standardReference: "ISO 45001 Cl. 5.4 / Cl. 7.4.1",
    title: "Worker Communication & Consultation Evidence",
    docCategory: "Retained Record",
    domain: "ISO 45001 OH&S",
    description:
      "Retained safety committee meeting minutes, toolbox talk records, worker hazard reports, and joint safety walkthrough notes.",
    evidenceCriteria:
      "Safety committee minutes, toolbox talks, hazard reports, and consultation records.",
  },
  {
    section: "iso45001",
    sectionOrder: 4,
    docId: "QHSE-45001-DOC-8.1.2",
    standardReference: "ISO 45001 Cl. 8.1.2",
    title: "Operational Safety Controls & Work Instructions",
    docCategory: "Maintained Document",
    domain: "ISO 45001 OH&S",
    description:
      "Maintained safe operating procedures, lock-out/tag-out (LOTO) protocols, machine guarding rules, ergonomic limits, and PPE requirements.",
    evidenceCriteria:
      "Safe work instructions, LOTO protocols, guarding rules, and PPE requirements.",
  },
  {
    section: "iso45001",
    sectionOrder: 4,
    docId: "QHSE-45001-REC-PTW",
    standardReference: "ISO 45001 Cl. 8.1.2",
    title: "Permit-to-Work (PTW) Records",
    docCategory: "Retained Record",
    domain: "ISO 45001 OH&S",
    description:
      "Retained formal authorization permits for high-risk operations (e.g., hot work, confined space entry, working at height, live electrical work).",
    evidenceCriteria:
      "Completed PTW authorizations for high-risk work activities.",
  },
  {
    section: "iso45001",
    sectionOrder: 4,
    docId: "QHSE-45001-REC-10.2",
    standardReference: "ISO 45001 Cl. 10.2",
    title: "Incident & Near-Miss Investigation Reports",
    docCategory: "Retained Record",
    domain: "ISO 45001 OH&S",
    description:
      "Retained workplace injury reports, incident investigation records, root-cause analyses, and regulatory accident reporting notifications.",
    evidenceCriteria:
      "Incident/near-miss investigation reports with root cause and regulatory notifications where required.",
  },
];
