/**
 * Curated option lists for Phase 1 onboarding.
 * Industry list aligns with Mastery Lab industry choices.
 * professionalRole is the personalization "role" (auth User.role remains USER | SUPER_ADMIN).
 */

export const ONBOARDING_INDUSTRIES = [
  "Aerospace",
  "Agriculture",
  "Amusement Parks",
  "Artificial Intelligence",
  "Asset Management",
  "Automotive",
  "Biotechnology & Life Sciences",
  "Chemical & Allied Products",
  "Construction & Engineering",
  "Corporate Compliance",
  "Customer Service",
  "Cybersecurity & Data Privacy",
  "Education",
  "Energy & Utilities",
  "Environmental Management",
  "Event Management",
  "Facility Management",
  "Financial Services",
  "Food & Beverage",
  "Government & Public Sector",
  "Healthcare & Medical Services",
  "Human Resources",
  "Information Technology (IT)",
  "Laboratories & Testing",
  "Legal & Compliance",
  "Logistics & Supply Chain",
  "Manufacturing",
  "Maritime & Shipping",
  "Medical Devices",
  "Mining & Heavy Industry",
  "Non-Profit & NGOs",
  "Oil & Gas",
  "Packaging",
  "Pharmaceuticals",
  "Renewable Energy",
  "Road Traffic Safety",
  "Telecommunications",
  "Tourism & Hospitality",
  "Waste Management & Circular Economy",
] as const;

export const ONBOARDING_PROFESSIONAL_ROLES = [
  "Internal Auditor",
  "Lead Auditor",
  "Implementer / Consultant",
  "Quality Manager",
  "Compliance Officer",
  "Risk Manager",
  "Information Security Officer",
  "Operations Manager",
  "Executive / Director",
  "Engineer / Specialist",
  "Student / Trainee",
  "Other",
] as const;

export const ONBOARDING_TOTAL_STEPS = 4;

export type OnboardingIndustry = (typeof ONBOARDING_INDUSTRIES)[number];
export type OnboardingProfessionalRole =
  (typeof ONBOARDING_PROFESSIONAL_ROLES)[number];
