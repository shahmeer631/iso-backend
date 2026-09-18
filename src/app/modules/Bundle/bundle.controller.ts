import catchAsync from "../../../shared/catchAsync";
import sendResponse from "../../../shared/sendResponse";
import httpStatus from "http-status";
import { BundleServices } from "./bundle.service";

const createBundle = catchAsync(async (req, res) => {
  const result = await BundleServices.createBundle(req.body);

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Bundle created successfully",
    data: result,
  });
});

const getBundles = catchAsync(async (req, res) => {
  const result = await BundleServices.getBundles(req.query);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Bundles retrieved successfully",
    meta: result.meta,
    data: result.data,
  });
});

const getSingleBundle = catchAsync(async (req, res) => {
  const { id } = req.params;
  const result = await BundleServices.getSingleBundle(id);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Bundle retrieved successfully",
    data: result,
  });
});

const updateBundle = catchAsync(async (req, res) => {
  const { id } = req.params;
  const result = await BundleServices.updateBundle(id, req.body);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Bundle updated successfully",
    data: result,
  });
});

const deleteBundle = catchAsync(async (req, res) => {
  const { id } = req.params;
  const result = await BundleServices.deleteBundle(id);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Bundle deleted successfully",
    data: result,
  });
});

export const BundleController = Object.freeze({
  createBundle,
  getBundles,
  getSingleBundle,
  updateBundle,
  deleteBundle,
});
