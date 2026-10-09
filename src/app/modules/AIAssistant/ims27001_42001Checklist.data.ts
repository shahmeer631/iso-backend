/**
 * Client-provided IMS documented-information checklist for ISO/IEC 27001 + ISO/IEC 42001.
 * Source: ISO_27001_ISO_42001_IMS_Documented_Information_Checklist-1.xlsx
 * Used only when Navigator IMS selection includes both 27001 and 42001.
 */
export type Ims27001_42001ChecklistRow = {
  sheet: string;
  docId: string;
  standardReference: string;
  title: string;
  docCategory: string;
  domain: string;
  description: string;
  responsibleRole: string;
  evidenceCriteria: string;
};

export const IMS_27001_42001_CHECKLIST: Ims27001_42001ChecklistRow[] = [
  {
    "sheet": "Clauses 4-10 Documentation",
    "docId": "IMS-DOC-4.1",
    "standardReference": "ISO 27001/42001 Cl. 4.1",
    "title": "Context of Organization & Climate Assessment",
    "docCategory": "Maintained Document",
    "domain": "Common Governance",
    "description": "Evaluates internal/external issues, cyber threats, AI regulations, and climate change impacts per 2024 Amd 1.",
    "responsibleRole": "CISO / Strategic Lead",
    "evidenceCriteria": "Signed context register detailing climate risks, threat landscape, and AI operational constraints."
  },
  {
    "sheet": "Clauses 4-10 Documentation",
    "docId": "IMS-DOC-4.2",
    "standardReference": "ISO 27001/42001 Cl. 4.2",
    "title": "Stakeholder Obligations & Interested Parties Register",
    "docCategory": "Maintained Document",
    "domain": "Common Governance",
    "description": "Maps legal, contractual, statutory, and ethical requirements across data privacy, cybersecurity, and AI ethics.",
    "responsibleRole": "Legal & Compliance Lead",
    "evidenceCriteria": "Comprehensive matrix connecting regulators, customers, and data subjects to specific compliance obligations."
  },
  {
    "sheet": "Clauses 4-10 Documentation",
    "docId": "IMS-DOC-4.3",
    "standardReference": "ISO 27001/42001 Cl. 4.3",
    "title": "Integrated Management System Scope Statement",
    "docCategory": "Maintained Document",
    "domain": "Common Governance",
    "description": "Defines physical, technological, data processing, and AI model lifecycle boundaries and organizational AI roles.",
    "responsibleRole": "CISO / AI Lead",
    "evidenceCriteria": "Version-controlled scope document approved by top management detailing technical and physical perimeters."
  },
  {
    "sheet": "Clauses 4-10 Documentation",
    "docId": "IMS-DOC-4.4",
    "standardReference": "ISO 27001/42001 Cl. 4.4",
    "title": "Process Architecture & Interaction Model",
    "docCategory": "Maintained Document",
    "domain": "Common Governance",
    "description": "Describes core operational, management, and support workflows and their interactions.",
    "responsibleRole": "Operations Lead",
    "evidenceCriteria": "Process flowcharts illustrating control gates where security and AI checkpoints plug into SDLC/MLOps."
  },
  {
    "sheet": "Clauses 4-10 Documentation",
    "docId": "IMS-DOC-5.1",
    "standardReference": "ISO 27001/42001 Cl. 5.1",
    "title": "Executive Board Charter & Integration Mandate",
    "docCategory": "Maintained Document",
    "domain": "Common Governance",
    "description": "Top management endorsement, resource commitment, and joint steering committee terms of reference.",
    "responsibleRole": "Executive Steering Committee",
    "evidenceCriteria": "Signed executive charter and board resolution authorizing joint ISMS/AIMS integration."
  },
  {
    "sheet": "Clauses 4-10 Documentation",
    "docId": "IMS-DOC-5.2",
    "standardReference": "ISO 27001/42001 Cl. 5.2",
    "title": "Consolidated InfoSec & Responsible AI Policy",
    "docCategory": "Maintained Document",
    "domain": "Common Governance",
    "description": "High-level policy setting commitments to the CIA triad and principles of Trustworthy AI.",
    "responsibleRole": "CISO & AI Ethics Lead",
    "evidenceCriteria": "Published policy approved by top management and distributed to all employees and contractors."
  },
  {
    "sheet": "Clauses 4-10 Documentation",
    "docId": "IMS-DOC-5.3",
    "standardReference": "ISO 27001/42001 Cl. 5.3",
    "title": "Organizational Roles & RACI Matrix",
    "docCategory": "Maintained Document",
    "domain": "Common Governance",
    "description": "Defines oversight, risk ownership, and operational execution roles across security and AI functions.",
    "responsibleRole": "HR & Compliance Lead",
    "evidenceCriteria": "Approved RACI matrix mapping specific tasks to CISO, AI Ethics Officer, MLOps, and DPO."
  },
  {
    "sheet": "Clauses 4-10 Documentation",
    "docId": "IMS-DOC-6.1",
    "standardReference": "ISO 27001/42001 Cl. 6.1.2",
    "title": "Integrated Risk & Impact Assessment Methodology",
    "docCategory": "Maintained Document",
    "domain": "Common Governance",
    "description": "Combines ISO 27005 CIA risk criteria with ISO 42005 AIIA impact assessment thresholds.",
    "responsibleRole": "Risk Manager",
    "evidenceCriteria": "Methodology document specifying risk scales, likelihood/consequence criteria, and impact triggers."
  },
  {
    "sheet": "Clauses 4-10 Documentation",
    "docId": "IMS-DOC-6.2",
    "standardReference": "ISO 27001/42001 Cl. 6.1/8.2",
    "title": "Consolidated Risk Register & AIIA Reports",
    "docCategory": "Retained Record",
    "domain": "Common Governance",
    "description": "Evaluates cyber threats, data quality, bias, safety, and societal harms across all operational AI models.",
    "responsibleRole": "Risk Manager / MLOps Lead",
    "evidenceCriteria": "Signed risk assessment registers and completed AIIA reports per ISO 42005 for all deployed systems."
  },
  {
    "sheet": "Clauses 4-10 Documentation",
    "docId": "IMS-DOC-6.3",
    "standardReference": "ISO 27001 Cl. 6.1.3",
    "title": "ISO/IEC 27001 Statement of Applicability (SoA)",
    "docCategory": "Maintained Document",
    "domain": "Information Security",
    "description": "Justifies inclusion/exclusion of all 93 Annex A controls with current implementation status.",
    "responsibleRole": "CISO",
    "evidenceCriteria": "Signed SoA document detailing justifications and implementation status for all 93 security controls."
  },
  {
    "sheet": "Clauses 4-10 Documentation",
    "docId": "IMS-DOC-6.4",
    "standardReference": "ISO 42001 Cl. 6.1.3",
    "title": "ISO/IEC 42001 Statement of Applicability (SoA)",
    "docCategory": "Maintained Document",
    "domain": "Trustworthy AI",
    "description": "Justifies inclusion/exclusion of all 38 Annex A AI reference controls mapped to risk treatments.",
    "responsibleRole": "AI Risk Lead",
    "evidenceCriteria": "Signed SoA document detailing justifications for inclusion/exclusion of all 38 AI reference controls."
  },
  {
    "sheet": "Clauses 4-10 Documentation",
    "docId": "IMS-DOC-6.5",
    "standardReference": "ISO 27001/42001 Cl. 6.1.3",
    "title": "Integrated Risk Treatment Plan (RTP)",
    "docCategory": "Maintained Document",
    "domain": "Common Governance",
    "description": "Details control selection, budgets, owners, and execution schedules for risk mitigations.",
    "responsibleRole": "CISO / AI Lead",
    "evidenceCriteria": "Approved RTP tracker showing assigned control owners, target completion dates, and budget allocations."
  },
  {
    "sheet": "Clauses 4-10 Documentation",
    "docId": "IMS-DOC-6.6",
    "standardReference": "ISO 27001/42001 Cl. 6.1.3",
    "title": "Acceptance of Residual Risks & Approvals",
    "docCategory": "Retained Record",
    "domain": "Common Governance",
    "description": "Executive sign-off accepting post-treatment residual security and AI risks.",
    "responsibleRole": "Executive Steering Committee",
    "evidenceCriteria": "Signed residual risk acceptance statement from top management and designated risk owners."
  },
  {
    "sheet": "Clauses 4-10 Documentation",
    "docId": "IMS-DOC-6.7",
    "standardReference": "ISO 27001/42001 Cl. 6.2",
    "title": "InfoSec & Trustworthy AI Objectives Plan",
    "docCategory": "Maintained Document",
    "domain": "Common Governance",
    "description": "Measurable annual KPIs, timelines, and monitoring mechanisms for security and AI goals.",
    "responsibleRole": "CISO / AI Ethics Lead",
    "evidenceCriteria": "Documented objectives plan displaying measurable targets, responsible owners, and review cadences."
  },
  {
    "sheet": "Clauses 4-10 Documentation",
    "docId": "IMS-DOC-7.1",
    "standardReference": "ISO 27001/42001 Cl. 7.2",
    "title": "Competency Matrix & Training Records",
    "docCategory": "Retained Record",
    "domain": "Common Governance",
    "description": "Skills mapping, training completion logs, and certifications for cyber hygiene and AI ethics.",
    "responsibleRole": "HR & Training Lead",
    "evidenceCriteria": "Verified employee training logs and certificates confirming completion of mandatory training."
  },
  {
    "sheet": "Clauses 4-10 Documentation",
    "docId": "IMS-DOC-7.2",
    "standardReference": "ISO 27001/42001 Cl. 7.3/7.4",
    "title": "Awareness & Communication Strategy Plan",
    "docCategory": "Maintained Document",
    "domain": "Common Governance",
    "description": "Strategy for enterprise-wide awareness on cyber security, data privacy, and responsible AI.",
    "responsibleRole": "Communications Lead",
    "evidenceCriteria": "Published communication plan and records of internal awareness campaigns and newsletters."
  },
  {
    "sheet": "Clauses 4-10 Documentation",
    "docId": "IMS-DOC-7.3",
    "standardReference": "ISO 27001/42001 Cl. 7.5",
    "title": "Documented Information Control Procedure",
    "docCategory": "Maintained Document",
    "domain": "Common Governance",
    "description": "Rules for creation, approval, versioning, distribution, and retention of IMS documentation.",
    "responsibleRole": "Document Control Lead",
    "evidenceCriteria": "Approved document control procedure and version-controlled master document register."
  },
  {
    "sheet": "Clauses 4-10 Documentation",
    "docId": "IMS-DOC-8.1",
    "standardReference": "ISO 27001/42001 Cl. 8.1",
    "title": "Operational Planning & Change Control Procedure",
    "docCategory": "Maintained Document",
    "domain": "Common Governance",
    "description": "Controls for system changes, MLOps releases, and operational criteria execution.",
    "responsibleRole": "DevOps / MLOps Lead",
    "evidenceCriteria": "Documented change management logs evaluating security and AI impacts prior to production releases."
  },
  {
    "sheet": "Clauses 4-10 Documentation",
    "docId": "IMS-DOC-9.1",
    "standardReference": "ISO 27001/42001 Cl. 9.1",
    "title": "Performance Monitoring & Metrics Reports",
    "docCategory": "Retained Record",
    "domain": "Common Governance",
    "description": "Dashboard logs tracking SIEM alerts, vulnerability status, and AI model drift/accuracy metrics.",
    "responsibleRole": "SOC & Data Science Lead",
    "evidenceCriteria": "Monthly performance reports containing SIEM telemetry, patch metrics, and model drift validation logs."
  },
  {
    "sheet": "Clauses 4-10 Documentation",
    "docId": "IMS-DOC-9.2",
    "standardReference": "ISO 27001/42001 Cl. 9.2",
    "title": "Integrated Internal Audit Program & Reports",
    "docCategory": "Retained Record",
    "domain": "Common Governance",
    "description": "Joint audit scope, plans, schedules, and multidisciplinary auditor findings for ISMS/AIMS.",
    "responsibleRole": "Lead Internal Auditor",
    "evidenceCriteria": "Approved internal audit charter, combined audit schedule, and final audit report covering both standards."
  },
  {
    "sheet": "Clauses 4-10 Documentation",
    "docId": "IMS-DOC-9.3",
    "standardReference": "ISO 27001/42001 Cl. 9.3",
    "title": "Management Review Minutes & Action Plan",
    "docCategory": "Retained Record",
    "domain": "Common Governance",
    "description": "Executive review of joint KPIs, incidents, resource needs, and strategic decisions.",
    "responsibleRole": "Executive Steering Committee",
    "evidenceCriteria": "Signed management review minutes and unified master action plan assigning improvement owners."
  },
  {
    "sheet": "Clauses 4-10 Documentation",
    "docId": "IMS-DOC-10.1",
    "standardReference": "ISO 27001/42001 Cl. 10.1/10.2",
    "title": "Nonconformity, Incident & CAR Register",
    "docCategory": "Retained Record",
    "domain": "Common Governance",
    "description": "Root cause analysis, immediate containment, and verified corrective actions for incidents.",
    "responsibleRole": "Quality / Compliance Lead",
    "evidenceCriteria": "Active CAR log documenting root-cause investigations, corrective steps, and effectiveness reviews."
  },
  {
    "sheet": "ISO 27001 Security Controls",
    "docId": "ISMS-DOC-A.5.1",
    "standardReference": "ISO 27001 Annex A.5.1",
    "title": "Topic-Specific Information Security Policies",
    "docCategory": "Maintained Document",
    "domain": "Information Security",
    "description": "Policies for access control, cryptography, remote work, clean desk/screen, and asset handling.",
    "responsibleRole": "CISO",
    "evidenceCriteria": "Published topic-specific policies approved by management and reviewed annually."
  },
  {
    "sheet": "ISO 27001 Security Controls",
    "docId": "ISMS-DOC-A.5.9",
    "standardReference": "ISO 27001 Annex A.5.9",
    "title": "Inventory of Information & Associated Assets",
    "docCategory": "Maintained Document",
    "domain": "Information Security",
    "description": "Register listing data repositories, hardware, software, cloud services, and assigned owners.",
    "responsibleRole": "Asset Manager",
    "evidenceCriteria": "Active asset register identifying asset classification, location, and designated business owner."
  },
  {
    "sheet": "ISO 27001 Security Controls",
    "docId": "ISMS-DOC-A.5.10",
    "standardReference": "ISO 27001 Annex A.5.10",
    "title": "Acceptable Use Rules for Information Assets",
    "docCategory": "Maintained Document",
    "domain": "Information Security",
    "description": "Rules for data handling, mobile devices, acceptable system usage, and password hygiene.",
    "responsibleRole": "HR / IT Lead",
    "evidenceCriteria": "Signed employee acknowledgment records of acceptable use policy upon onboarding."
  },
  {
    "sheet": "ISO 27001 Security Controls",
    "docId": "ISMS-DOC-A.5.12",
    "standardReference": "ISO 27001 Annex A.5.12",
    "title": "Information Classification & Labelling Scheme",
    "docCategory": "Maintained Document",
    "domain": "Information Security",
    "description": "Scheme defining Confidential, Restricted, Internal, and Public levels with handling rules.",
    "responsibleRole": "CISO",
    "evidenceCriteria": "Classification guidelines and visual labeling standards applied across documents and repositories."
  },
  {
    "sheet": "ISO 27001 Security Controls",
    "docId": "ISMS-DOC-A.5.14",
    "standardReference": "ISO 27001 Annex A.5.14",
    "title": "Information Transfer Rules & Agreements",
    "docCategory": "Maintained Document",
    "domain": "Information Security",
    "description": "Secure transfer protocols and legal agreements protecting data in transit with external parties.",
    "responsibleRole": "Legal & Compliance Lead",
    "evidenceCriteria": "Signed data transfer agreements and technical configurations for encrypted transfer channels."
  },
  {
    "sheet": "ISO 27001 Security Controls",
    "docId": "ISMS-DOC-A.5.19",
    "standardReference": "ISO 27001 Annex A.5.19",
    "title": "Supplier Security Policy & Supply Chain Rules",
    "docCategory": "Maintained Document",
    "domain": "Information Security",
    "description": "Security requirements, cloud SLAs, and third-party risk management procedures.",
    "responsibleRole": "Procurement / CISO",
    "evidenceCriteria": "Supplier risk assessment records and security clauses embedded in vendor contracts."
  },
  {
    "sheet": "ISO 27001 Security Controls",
    "docId": "ISMS-DOC-A.5.24",
    "standardReference": "ISO 27001 Annex A.5.24",
    "title": "InfoSec Incident Management Procedure",
    "docCategory": "Maintained Document",
    "domain": "Information Security",
    "description": "Incident classification, reporting pathways, triage, escalation, and breach notification rules.",
    "responsibleRole": "Incident Response Lead",
    "evidenceCriteria": "Tested incident response plan and incident triage logs recording security events."
  },
  {
    "sheet": "ISO 27001 Security Controls",
    "docId": "ISMS-DOC-A.5.31",
    "standardReference": "ISO 27001 Annex A.5.31",
    "title": "Legal, Statutory & Contractual Obligations Matrix",
    "docCategory": "Maintained Document",
    "domain": "Information Security",
    "description": "Identification of IP, PII, statutory compliance, and maritime/industry legal obligations.",
    "responsibleRole": "Legal Lead",
    "evidenceCriteria": "Updated legal compliance register reviewed by legal counsel detailing applicable regulations."
  },
  {
    "sheet": "ISO 27001 Security Controls",
    "docId": "ISMS-DOC-A.6.1",
    "standardReference": "ISO 27001 Annex A.6.1",
    "title": "Screening Procedures & Employment NDAs",
    "docCategory": "Maintained Document",
    "domain": "Information Security",
    "description": "Background checks, signed NDAs, and security obligations in employment contracts.",
    "responsibleRole": "HR Lead",
    "evidenceCriteria": "Personnel files containing background check verifications and executed confidentiality agreements."
  },
  {
    "sheet": "ISO 27001 Security Controls",
    "docId": "ISMS-DOC-A.7.2",
    "standardReference": "ISO 27001 Annex A.7.2",
    "title": "Physical Security Perimeter & Entry Controls",
    "docCategory": "Maintained Document",
    "domain": "Information Security",
    "description": "Physical access rules, badge logs, visitor controls, and server room access procedures.",
    "responsibleRole": "Physical Security Lead",
    "evidenceCriteria": "Physical visitor logs, access control badge reports, and CCTV retention records."
  },
  {
    "sheet": "ISO 27001 Security Controls",
    "docId": "ISMS-DOC-A.8.2",
    "standardReference": "ISO 27001 Annex A.8.2",
    "title": "Privileged Access Management Rules & Audit Logs",
    "docCategory": "Retained Record",
    "domain": "Information Security",
    "description": "MFA enforcement, administrative access allocation logs, and quarterly access reviews.",
    "responsibleRole": "IAM Lead",
    "evidenceCriteria": "Quarterly user access review sign-off sheets and MFA enforcement configuration logs."
  },
  {
    "sheet": "ISO 27001 Security Controls",
    "docId": "ISMS-DOC-A.8.7",
    "standardReference": "ISO 27001 Annex A.8.7",
    "title": "Protection Against Malware & Endpoint SOPs",
    "docCategory": "Maintained Document",
    "domain": "Information Security",
    "description": "Antivirus/EDR deployment, patching cycles, and endpoint protection rules.",
    "responsibleRole": "IT Ops Lead",
    "evidenceCriteria": "Centralized EDR console status reports and monthly patch compliance verification logs."
  },
  {
    "sheet": "ISO 27001 Security Controls",
    "docId": "ISMS-DOC-A.8.11",
    "standardReference": "ISO 27001 Annex A.8.11",
    "title": "Data Masking & Anonymization Guidelines",
    "docCategory": "Maintained Document",
    "domain": "Information Security",
    "description": "Rules for protecting PII, healthcare, and financial data in non-production environments.",
    "responsibleRole": "Data Governance Lead",
    "evidenceCriteria": "Technical configuration logs showing masked/anonymized datasets used in test environments."
  },
  {
    "sheet": "ISO 27001 Security Controls",
    "docId": "ISMS-DOC-A.8.12",
    "standardReference": "ISO 27001 Annex A.8.12",
    "title": "Data Leakage Prevention (DLP) Standard",
    "docCategory": "Maintained Document",
    "domain": "Information Security",
    "description": "Technical controls preventing unauthorized data exfiltration across web, email, and USB.",
    "responsibleRole": "CISO",
    "evidenceCriteria": "DLP rule configuration policy and incident logs tracking blocked exfiltration attempts."
  },
  {
    "sheet": "ISO 27001 Security Controls",
    "docId": "ISMS-DOC-A.8.15",
    "standardReference": "ISO 27001 Annex A.8.15",
    "title": "Logging & Centralized SIEM Monitoring Policy",
    "docCategory": "Retained Record",
    "domain": "Information Security",
    "description": "Log retention rules, audit log protection, and centralized SIEM alert logs.",
    "responsibleRole": "SOC Lead",
    "evidenceCriteria": "SIEM configuration records, daily alert review logs, and log backup integrity checks."
  },
  {
    "sheet": "ISO 27001 Security Controls",
    "docId": "ISMS-DOC-A.8.24",
    "standardReference": "ISO 27001 Annex A.8.24",
    "title": "Cryptographic Policy & Key Management Standard",
    "docCategory": "Maintained Document",
    "domain": "Information Security",
    "description": "Encryption algorithms, key generation, storage, rotation, and retirement procedures.",
    "responsibleRole": "Security Architect",
    "evidenceCriteria": "Key management SOP and HSM/KMS configuration logs demonstrating encryption at rest/transit."
  },
  {
    "sheet": "ISO 27001 Security Controls",
    "docId": "ISMS-DOC-A.8.28",
    "standardReference": "ISO 27001 Annex A.8.28",
    "title": "Secure Coding Policy & SDLC Standards",
    "docCategory": "Maintained Document",
    "domain": "Information Security",
    "description": "Secure development guidelines, static/dynamic code analysis, and vulnerability reviews.",
    "responsibleRole": "DevSecOps Lead",
    "evidenceCriteria": "SAST/DAST vulnerability scan reports and peer code review records prior to release."
  },
  {
    "sheet": "ISO 27001 Security Controls",
    "docId": "ISMS-DOC-A.8.31",
    "standardReference": "ISO 27001 Annex A.8.31",
    "title": "Separation of Dev, Test & Production SOP",
    "docCategory": "Maintained Document",
    "domain": "Information Security",
    "description": "Isolation rules preventing production sensitive data usage in dev/test environments.",
    "responsibleRole": "Infrastructure Lead",
    "evidenceCriteria": "Environment segmentation network rule diagrams and access control lists (ACLs)."
  },
  {
    "sheet": "ISO 42001 AI Controls",
    "docId": "AIMS-DOC-A.2.1",
    "standardReference": "ISO 42001 Annex A.2.1",
    "title": "AI Policy & Organizational Alignment",
    "docCategory": "Maintained Document",
    "domain": "Trustworthy AI",
    "description": "Specific AI governance policy detailing ethical guidelines and trustworthy AI commitments.",
    "responsibleRole": "AI Ethics Officer",
    "evidenceCriteria": "Published AI governance policy approved by executive board and communicated to teams."
  },
  {
    "sheet": "ISO 42001 AI Controls",
    "docId": "AIMS-DOC-A.3.1",
    "standardReference": "ISO 42001 Annex A.3.1",
    "title": "AI System Classification & Risk Scheme",
    "docCategory": "Maintained Document",
    "domain": "Trustworthy AI",
    "description": "Framework for rating AI system risk levels (High, Medium, Low/Prohibited).",
    "responsibleRole": "AI Risk Lead",
    "evidenceCriteria": "Documented classification taxonomy and risk categorization register for all company AI systems."
  },
  {
    "sheet": "ISO 42001 AI Controls",
    "docId": "AIMS-DOC-A.3.2",
    "standardReference": "ISO 42001 Annex A.3.2",
    "title": "Process for Reporting AI Ethical Concerns",
    "docCategory": "Maintained Document",
    "domain": "Trustworthy AI",
    "description": "Channel for employees and users to submit safety, bias, or performance concerns regarding AI.",
    "responsibleRole": "Compliance / Ethics Lead",
    "evidenceCriteria": "Operational whistleblower/reporting channel logs tracking received AI concerns and resolutions."
  },
  {
    "sheet": "ISO 42001 AI Controls",
    "docId": "AIMS-DOC-A.4.1",
    "standardReference": "ISO 42001 Annex A.4.1",
    "title": "AI Resource Inventory (Data, Compute, Human)",
    "docCategory": "Maintained Document",
    "domain": "Trustworthy AI",
    "description": "Register listing compute infrastructure, datasets, pre-trained models, and ML tooling.",
    "responsibleRole": "MLOps Lead",
    "evidenceCriteria": "Active AI asset inventory tracking data sources, GPU compute clusters, and framework licenses."
  },
  {
    "sheet": "ISO 42001 AI Controls",
    "docId": "AIMS-DOC-A.5.1",
    "standardReference": "ISO 42001 Annex A.5.1",
    "title": "AI System Impact Assessment (AIIA) Procedure",
    "docCategory": "Maintained Document",
    "domain": "Trustworthy AI",
    "description": "Guided procedure following ISO/IEC 42005 for evaluating societal, fairness, and safety harms.",
    "responsibleRole": "AI Risk Lead",
    "evidenceCriteria": "Standardized AIIA template and completed assessment reports covering operational AI systems."
  },
  {
    "sheet": "ISO 42001 AI Controls",
    "docId": "AIMS-DOC-A.6.1",
    "standardReference": "ISO 42001 Annex A.6.1",
    "title": "AI Life Cycle Governance Policy (MLOps)",
    "docCategory": "Maintained Document",
    "domain": "Trustworthy AI",
    "description": "Stage-gate requirements across Initiation, Data Prep, Design, Test, Deploy, Monitor, Retrain.",
    "responsibleRole": "Lead AI Engineer",
    "evidenceCriteria": "MLOps pipeline documentation displaying automated quality and security stage-gates."
  },
  {
    "sheet": "ISO 42001 AI Controls",
    "docId": "AIMS-DOC-A.6.2",
    "standardReference": "ISO 42001 Annex A.6.2",
    "title": "AI System Architecture & Rationale Specs",
    "docCategory": "Maintained Document",
    "domain": "Trustworthy AI",
    "description": "Technical specifications, model architecture, loss functions, and design assumptions.",
    "responsibleRole": "Data Science Lead",
    "evidenceCriteria": "Model card documentation detailing model type, hyper-parameters, and design tradeoffs."
  },
  {
    "sheet": "ISO 42001 AI Controls",
    "docId": "AIMS-DOC-A.6.4",
    "standardReference": "ISO 42001 Annex A.6.4",
    "title": "AI Verification & Validation Test Reports",
    "docCategory": "Retained Record",
    "domain": "Trustworthy AI",
    "description": "Test results for accuracy, robustness, fairness, and edge case performance.",
    "responsibleRole": "Lead QA / AI Tester",
    "evidenceCriteria": "Automated validation report suite showing test accuracy scores, confusion matrices, and bias checks."
  },
  {
    "sheet": "ISO 42001 AI Controls",
    "docId": "AIMS-DOC-A.6.6",
    "standardReference": "ISO 42001 Annex A.6.6",
    "title": "AI Model Drift Monitoring & Retrain Protocol",
    "docCategory": "Maintained Document",
    "domain": "Trustworthy AI",
    "description": "Criteria for detecting data drift, performance decay, and triggering automated/manual retrains.",
    "responsibleRole": "MLOps Lead",
    "evidenceCriteria": "Model drift tracking dashboards and automated trigger logs for model retraining."
  },
  {
    "sheet": "ISO 42001 AI Controls",
    "docId": "AIMS-DOC-A.7.1",
    "standardReference": "ISO 42001 Annex A.7.1",
    "title": "Data Sourcing, Acquisition & Selection Rules",
    "docCategory": "Maintained Document",
    "domain": "Trustworthy AI",
    "description": "Rules for lawful data collection, licensing, consent tracking, and demographic representativeness.",
    "responsibleRole": "Data Governance Lead",
    "evidenceCriteria": "Data licensing documentation, user consent logs, and data selection justification reports."
  },
  {
    "sheet": "ISO 42001 AI Controls",
    "docId": "AIMS-DOC-A.7.4",
    "standardReference": "ISO 42001 Annex A.7.4",
    "title": "Data Quality Assessment & Preprocessing Logs",
    "docCategory": "Retained Record",
    "domain": "Trustworthy AI",
    "description": "Evaluations of data completeness, accuracy, noise reduction, and demographic balance.",
    "responsibleRole": "Data Engineer",
    "evidenceCriteria": "Data profiling reports and exploratory data analysis (EDA) logs for training datasets."
  },
  {
    "sheet": "ISO 42001 AI Controls",
    "docId": "AIMS-DOC-A.7.5",
    "standardReference": "ISO 42001 Annex A.7.5",
    "title": "Data Provenance & Lineage System Documentation",
    "docCategory": "Maintained Document",
    "domain": "Trustworthy AI",
    "description": "Immutable tracking of dataset transformations, pipeline stages, and original sources.",
    "responsibleRole": "Data Architect",
    "evidenceCriteria": "Data lineage graph records generated by automated pipeline tools (e.g., DVC, MLflow)."
  },
  {
    "sheet": "ISO 42001 AI Controls",
    "docId": "AIMS-DOC-A.8.1",
    "standardReference": "ISO 42001 Annex A.8.1",
    "title": "User Disclosure & AI Transparency Instructions",
    "docCategory": "Maintained Document",
    "domain": "Trustworthy AI",
    "description": "Explanations provided to users interacting with AI agents or automated decision systems.",
    "responsibleRole": "UX / Product Lead",
    "evidenceCriteria": "Product UI screenshots displaying mandatory AI interaction notifications and system disclaimers."
  },
  {
    "sheet": "ISO 42001 AI Controls",
    "docId": "AIMS-DOC-A.8.3",
    "standardReference": "ISO 42001 Annex A.8.3",
    "title": "Human Oversight & Fallback SOPs",
    "docCategory": "Maintained Document",
    "domain": "Trustworthy AI",
    "description": "Human-in-the-loop (HITL) overrides, emergency stop procedures, and fallback operational modes.",
    "responsibleRole": "Operations Lead",
    "evidenceCriteria": "Operational manual detailing override procedures and test logs of emergency stop controls."
  },
  {
    "sheet": "ISO 42001 AI Controls",
    "docId": "AIMS-DOC-A.9.1",
    "standardReference": "ISO 42001 Annex A.9.1",
    "title": "System Usage Criteria & Approved Use Register",
    "docCategory": "Maintained Document",
    "domain": "Trustworthy AI",
    "description": "Permitted vs. restricted operational use cases for enterprise AI deployments.",
    "responsibleRole": "AI Governance Board",
    "evidenceCriteria": "Approved AI use case register detailing permitted operational boundaries for deployed models."
  },
  {
    "sheet": "ISO 42001 AI Controls",
    "docId": "AIMS-DOC-A.10.1",
    "standardReference": "ISO 42001 Annex A.10.1",
    "title": "Third-Party AI Supplier Assessment Protocol",
    "docCategory": "Maintained Document",
    "domain": "Trustworthy AI",
    "description": "Due diligence criteria for foundation models, APIs, and vendor AI tools.",
    "responsibleRole": "Procurement / AI Lead",
    "evidenceCriteria": "Completed vendor AI risk assessment forms and third-party model audit certifications."
  }
];
