import httpStatus from "http-status";
import catchAsync from "../../../shared/catchAsync";
import sendResponse from "../../../shared/sendResponse";
import { DocumentService } from "./document.service";
import prisma from "../../../shared/prisma";
import ApiError from "../../../errors/ApiErrors";

const createDocument = catchAsync(async (req, res) => {
  const result = await DocumentService.createDocument(req.body);

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Document created successfully",
    data: result,
  });
});

const createBulkDocument = catchAsync(async (req, res) => {
  const { urls, categoryId } = req.body;

  if (!urls || !Array.isArray(urls)) {
    throw new ApiError(httpStatus.BAD_REQUEST, "Invalid urls");
  }

  const getFileType = (url: string) => {
    const ext = url.split(".").pop()?.toLowerCase();

    if (ext === "pdf") return "PDF";
    if (ext === "doc" || ext === "docx") return "DOC";
    if (ext === "xls" || ext === "xlsx") return "XLS";
    if (ext === "ppt" || ext === "pptx") return "PPT";

    return "OTHER";
  };

  const payloads = urls.map((url: string) => ({
    title: url.split("/").pop(), // ✅ required field fill
    fileUrl: url,
    categoryId,
    status: "DRAFT", // ✅ default
    type: getFileType(url), // ✅ FIX
  }));

  const result = await DocumentService.createDocuments(payloads);

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Bulk documents created successfully",
    data: result,
  });
});

const getDocuments = catchAsync(async (req, res) => {
  const result = await DocumentService.getDocuments(req.query);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Documents retrieved successfully",
    meta: result.meta,
    data: result.data,
  });
});

const getSingleDocument = catchAsync(async (req, res) => {
  const result = await DocumentService.getSingleDocument(req.params.id);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Document retrieved successfully",
    data: result,
  });
});

const updateDocument = catchAsync(async (req, res) => {
  const result = await DocumentService.updateDocument(req.params.id, req.body);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Document updated successfully",
    data: result,
  });
});

const deleteDocument = catchAsync(async (req, res) => {
  const result = await DocumentService.deleteDocument(req.params.id);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Document deleted successfully",
    data: result,
  });
});

export const DocumentController = {
  createDocument,
  createBulkDocument,
  getDocuments,
  getSingleDocument,
  updateDocument,
  deleteDocument,
};
