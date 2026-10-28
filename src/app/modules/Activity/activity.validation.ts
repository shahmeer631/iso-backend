import { z } from "zod";
import { ACTIVITY_SOURCES, AI_TOOL_IDS } from "./activity.constants";

const objectIdRegex = /^[a-f\d]{24}$/i;
const uuidRegex =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const optionalObjectId = z
  .string()
  .regex(objectIdRegex, "Invalid id")
  .optional()
  .nullable();

export const heartbeatSchema = z
  .object({
    clientSessionId: z
      .string()
      .trim()
      .regex(uuidRegex, "clientSessionId must be a UUID"),
    source: z.enum(ACTIVITY_SOURCES as unknown as [string, ...string[]]),
    courseId: optionalObjectId,
    lessonId: optionalObjectId,
    isoStandardId: optionalObjectId,
    documentId: optionalObjectId,
    aiToolId: z
      .enum(AI_TOOL_IDS as unknown as [string, ...string[]])
      .optional()
      .nullable(),
    resourceLabel: z.string().trim().max(200).optional().nullable(),
    path: z.string().trim().max(500).optional().nullable(),
    /** When false, interval is not credited (hidden / background tab). */
    isVisible: z.boolean().optional().default(true),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.source === "ACADEMY" && !data.courseId && !data.lessonId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Academy heartbeats require courseId or lessonId",
        path: ["courseId"],
      });
    }
    if (data.source === "LIBRARY" && !data.isoStandardId && !data.documentId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Library heartbeats require isoStandardId or documentId",
        path: ["isoStandardId"],
      });
    }
    if (data.source === "AI_TOOL" && !data.aiToolId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "AI tool heartbeats require aiToolId",
        path: ["aiToolId"],
      });
    }
  });

export const activityHistoryQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  source: z
    .enum(ACTIVITY_SOURCES as unknown as [string, ...string[]])
    .optional(),
});

export const ActivityValidation = {
  heartbeatSchema,
  activityHistoryQuerySchema,
};
