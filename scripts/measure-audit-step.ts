import dotenv from "dotenv";
dotenv.config();

async function main() {
  const { AIAssistantService } = await import(
    "../src/app/modules/AIAssistant/aiassistant.service"
  );

  const payload = {
    step_number: 1,
    step_title: "Understand the Organization and Its Context",
    stage: "Plan",
    locked_context: {
      organization: "Acme Manufacturing Ltd",
      criteria: "ISO 9001:2026",
      scope: "Design and manufacture of industrial components",
      objective: "Assess conformity of the QMS to ISO 9001:2026",
      clause: "4.1",
      industry: "Manufacturing",
    },
  };

  console.log("[measure] starting getAuditStep…");
  const t0 = Date.now();
  try {
    const result = await AIAssistantService.getAuditStep(payload);
    const ms = Date.now() - t0;
    console.log(
      JSON.stringify(
        {
          elapsed_ms: ms,
          elapsed_s: +(ms / 1000).toFixed(1),
          guidance_len: (result?.guidance || "").length,
          has_case: Boolean(
            result?.case_study && String(result.case_study).length > 40,
          ),
          case_len: (result?.case_study || "").length,
          has_paper: Boolean(result?.audit_paper),
          has_template: Boolean(
            result?.documented_information_template || result?.template_preview,
          ),
        },
        null,
        2,
      ),
    );
  } catch (e: any) {
    console.error(
      JSON.stringify({
        error: e?.message || String(e),
        elapsed_ms: Date.now() - t0,
      }),
    );
    process.exitCode = 1;
  }
}

main().finally(() => {
  // allow prisma logs to flush
  setTimeout(() => process.exit(process.exitCode || 0), 500);
});
