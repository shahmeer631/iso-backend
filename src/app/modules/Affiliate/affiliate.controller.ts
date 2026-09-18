import httpStatus from "http-status";
import catchAsync from "../../../shared/catchAsync";
import sendResponse from "../../../shared/sendResponse";
import { AffiliateService } from "./affiliate.service";

// CREATE
const createAffiliate = catchAsync(async (req, res) => {
  const result = await AffiliateService.createAffiliate(req.body);

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Affiliate created successfully",
    data: result,
  });
});

// GET ALL
const getAffiliates = catchAsync(async (req, res) => {
  const result = await AffiliateService.getAffiliates(req.query);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Affiliates fetched successfully",
    meta: result.meta,
    data: result.data,
  });
});

// UPDATE
const updateAffiliate = catchAsync(async (req, res) => {
  const { id } = req.params;

  const result = await AffiliateService.updateAffiliate(id, req.body);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Affiliate updated successfully",
    data: result,
  });
});

// DELETE
const deleteAffiliate = catchAsync(async (req, res) => {
  const { id } = req.params;

  const result = await AffiliateService.deleteAffiliate(id);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Affiliate deleted successfully",
    data: result,
  });
});

const getAffiliateStats = catchAsync(async (req, res) => {
  const result = await AffiliateService.getAffiliateStats();

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Affiliate stats fetched successfully",
    data: result,
  });
});

export const AffiliateController = {
  createAffiliate,
  getAffiliates,
  updateAffiliate,
  deleteAffiliate,
  getAffiliateStats
};