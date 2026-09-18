import httpStatus from "http-status";
import catchAsync from "../../../shared/catchAsync";
import sendResponse from "../../../shared/sendResponse";
import { Request, Response } from "express";
import { UploadServices } from "./upload.service";


const uploadFile = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  const result = await UploadServices.uploadFile(req, userId);

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "File uploaded successfully!",
    data: result,
  });
});

const uploadFiles = catchAsync(async (req: Request, res: Response) => {
  const result = await UploadServices.uploadFiles(req);

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Files uploaded successfully!",
    data: result,
  });
});

export const UploadController = {
  uploadFile,
  uploadFiles,
};