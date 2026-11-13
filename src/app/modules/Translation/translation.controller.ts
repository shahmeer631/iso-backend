import { Request, Response } from "express";
import httpStatus from "http-status";
import catchAsync from "../../../shared/catchAsync";
import sendResponse from "../../../shared/sendResponse";
import ApiError from "../../../errors/ApiErrors";
import {
  assertSupportedLocale,
  getTranslationStatus,
  isTranslationLiveConfigured,
  translateBatch,
  translateText,
} from "../../../helpars/translationService";
import { SUPPORTED_LOCALES } from "../../../helpars/locales";

const MAX_TEXT_CHARS = 5000;
const MAX_BATCH = Number(process.env.TRANSLATION_MAX_BATCH_SIZE || 50);

const translateOne = catchAsync(async (req: Request, res: Response) => {
  const { text, targetLocale, sourceLocale, contentType, contentId, field, reviewRequired } =
    req.body || {};

  if (typeof text !== "string" || !text.trim()) {
    throw new ApiError(httpStatus.BAD_REQUEST, "text is required");
  }
  if (text.length > MAX_TEXT_CHARS) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `text exceeds ${MAX_TEXT_CHARS} characters`,
    );
  }

  let locale;
  try {
    locale = assertSupportedLocale(targetLocale);
  } catch {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `targetLocale must be one of: ${SUPPORTED_LOCALES.join(", ")}`,
    );
  }

  const result = await translateText({
    text,
    targetLocale: locale,
    sourceLocale,
    contentType,
    contentId,
    field,
    reviewRequired: Boolean(reviewRequired),
  });

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: result.translated
      ? "Translated"
      : result.cached
        ? "Cache hit"
        : "Translation unavailable; source returned",
    data: result,
  });
});

const translateMany = catchAsync(async (req: Request, res: Response) => {
  const { items } = req.body || {};
  if (!Array.isArray(items) || !items.length) {
    throw new ApiError(httpStatus.BAD_REQUEST, "items[] is required");
  }
  if (items.length > MAX_BATCH) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Batch size exceeds ${MAX_BATCH}`,
    );
  }

  const normalized = items.map((item: any, idx: number) => {
    if (typeof item?.text !== "string" || !item.text.trim()) {
      throw new ApiError(httpStatus.BAD_REQUEST, `items[${idx}].text is required`);
    }
    if (item.text.length > MAX_TEXT_CHARS) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `items[${idx}].text exceeds ${MAX_TEXT_CHARS} characters`,
      );
    }
    try {
      assertSupportedLocale(item.targetLocale);
    } catch {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `items[${idx}].targetLocale must be one of: ${SUPPORTED_LOCALES.join(", ")}`,
      );
    }
    return {
      text: item.text,
      targetLocale: item.targetLocale,
      sourceLocale: item.sourceLocale,
      contentType: item.contentType,
      contentId: item.contentId,
      field: item.field,
      reviewRequired: Boolean(item.reviewRequired),
    };
  });

  const results = await translateBatch(normalized);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Batch translation complete",
    data: {
      results,
      liveEnabled: isTranslationLiveConfigured(),
    },
  });
});

const status = catchAsync(async (_req: Request, res: Response) => {
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Translation provider status",
    data: {
      ...getTranslationStatus(),
      supportedLocales: SUPPORTED_LOCALES,
    },
  });
});

export const translationController = {
  translateOne,
  translateMany,
  status,
};
