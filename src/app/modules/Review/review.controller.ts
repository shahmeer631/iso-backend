import catchAsync from "../../../shared/catchAsync";
import sendResponse from "../../../shared/sendResponse";
import { ReviewServices } from "./review.service";

const createReview = catchAsync(async (req, res) => {
  const result = await ReviewServices.createReview(req.body);

  sendResponse(res, {
    statusCode: 201,
    success: true,
    message: "Review submitted",
    data: result,
  });
});

const getReviews = catchAsync(async (req, res) => {
  const result = await ReviewServices.getReviews(req.query);

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Reviews retrieved",
    data: result,
  });
});

export const ReviewController = {
  createReview,
  getReviews,
};
