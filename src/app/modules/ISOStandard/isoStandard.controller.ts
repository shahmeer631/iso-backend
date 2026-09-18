import httpStatus from "http-status";
import catchAsync from "../../../shared/catchAsync";
import sendResponse from "../../../shared/sendResponse";
import { ISOStandardService } from "./isoStandard.service";
import ApiError from "../../../errors/ApiErrors";

const createISOStandard = catchAsync(async (req, res) => {
  const result = await ISOStandardService.createISOStandard(req.body);

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "ISO Standard created successfully",
    data: result,
  });
});

const getISOStandards = catchAsync(async (req, res) => {
  const result = await ISOStandardService.getISOStandards(req.query);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "ISO Standards retrieved successfully",
    meta: result.meta,
    data: result.data,
  });
});

const getSingleISOStandard = catchAsync(async (req, res) => {
  const result = await ISOStandardService.getSingleISOStandard(req.params.id);

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "ISO fetched",
    data: result,
  });
});

const updateISOStandard = catchAsync(async (req, res) => {
  const result = await ISOStandardService.updateISOStandard(
    req.params.id,
    req.body,
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "ISO Standard updated successfully",
    data: result,
  });
});

const deleteISOStandard = catchAsync(async (req, res) => {
  const result = await ISOStandardService.deleteISOStandard(req.params.id);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "ISO Standard deleted successfully",
    data: result,
  });
});

const downloadISO = catchAsync(async (req, res) => {
  const userId = req.user.id;

  // 🔥 FEATURE CHECK moved to middleware

  const result = await ISOStandardService.getSingleISOStandard(req.params.id);

  // 🔥 increase download count
  await ISOStandardService.increaseDownload(req.params.id);

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "ISO file fetched",
    data: result,
  });
});

export const ISOStandardController = {
  createISOStandard,
  getISOStandards,
  getSingleISOStandard,
  updateISOStandard,
  deleteISOStandard,
  downloadISO,
};
