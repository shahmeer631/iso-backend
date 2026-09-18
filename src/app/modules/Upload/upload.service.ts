import ApiError from "../../../errors/ApiErrors";
import httpStatus from "http-status";
import { Request } from "express";
import { uploadItems } from "../../../helpars/uploadItems";

const uploadFile = async (req: Request, userId: string) => {
  if (!userId) {
    throw new ApiError(httpStatus.UNAUTHORIZED, "Unauthorized access");
  }

  if (!req.file) {
    throw new ApiError(httpStatus.BAD_REQUEST, "No file provided");
  }

  const uploaded = await uploadItems(req.file);

  return {
    url: uploaded.Location,
  };
};

const uploadFiles = async (req: Request) => {
  const files = req.files as Express.Multer.File[];

  if (!files || files.length === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, "No files provided");
  }

  const uploadedFiles = await Promise.all(
    files.map((file) => uploadItems(file)),
  );

  const urls = uploadedFiles.map((file) => file.Location);

  return {
    urls,
  };
};

export const UploadServices = {
  uploadFile,
  uploadFiles,
};
