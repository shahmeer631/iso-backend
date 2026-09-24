/**
 * One-shot repair for legacy Group / GroupUser docs with missing or string dates.
 * Run against the target Mongo (e.g. production):
 *   npx tsx src/scripts/repair-group-timestamps.ts
 */
import prisma from "../shared/prisma";

async function normalizeCollection(
  collection: string,
  fields: string[],
  match: Record<string, unknown> = {},
) {
  const setExpr: Record<string, unknown> = {};
  for (const field of fields) {
    setExpr[field] = {
      $switch: {
        branches: [
          {
            case: { $eq: [{ $type: `$${field}` }, "date"] },
            then: `$${field}`,
          },
          {
            case: { $eq: [{ $type: `$${field}` }, "string"] },
            then: { $toDate: `$${field}` },
          },
        ],
        default: "$$NOW",
      },
    };
  }

  return prisma.$runCommandRaw({
    update: collection,
    updates: [
      {
        q: match,
        u: [{ $set: setExpr }],
        multi: true,
      },
    ],
  });
}

async function main() {
  const groupResult = await normalizeCollection("Group", [
    "createdAt",
    "updatedAt",
  ]);
  const memberResult = await normalizeCollection("GroupUser", ["createdAt"]);

  console.log("Group repair:", JSON.stringify(groupResult));
  console.log("GroupUser repair:", JSON.stringify(memberResult));

  const groups = await prisma.group.findMany({
    select: {
      id: true,
      name: true,
      createdAt: true,
      groupUsers: { select: { id: true, createdAt: true }, take: 3 },
    },
  });
  console.log(
    `OK — loaded ${groups.length} groups via Prisma (with members)`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
