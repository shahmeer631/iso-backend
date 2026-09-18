import { Request, Response } from "express";
import catchAsync from "../../../shared/catchAsync";
import sendResponse from "../../../shared/sendResponse";
import { PlanService } from "./plan.service";

const createPlan = catchAsync(async (req: Request, res: Response) => {
  const plan = await PlanService.createPlan(req.body);
  sendResponse(res, {
    statusCode: 201,
    success: true,
    message: "Plan created successfully",
    data: plan,
  });
});

const getAllPlans = catchAsync(async (req: Request, res: Response) => {
  const isAdmin = (req as any).user?.role === "ADMIN";
  const plans = await PlanService.getAllPlans(isAdmin);
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Plans fetched successfully",
    data: plans,
  });
});

const getPlanById = catchAsync(async (req: Request, res: Response) => {
  const plan = await PlanService.getPlanById(req.params.planId);
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Plan fetched successfully",
    data: plan,
  });
});
const updatePlan = catchAsync(async (req: Request, res: Response) => {
  const plan = await PlanService.updatePlan(req.params.planId, req.body);
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Plan updated successfully",
    data: plan,
  });
});

const deletePlan = catchAsync(async (req: Request, res: Response) => {
  await PlanService.deletePlan(req.params.planId);
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Plan deleted successfully",
    data: null,
  });
});

const getDiscountedPlans = catchAsync(async (req: Request, res: Response) => {
  const plans = await PlanService.getDiscountedPlans();
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Discounted plans fetched successfully",
    data: plans,
  });
});

export const PlanController = {
  createPlan,
  getAllPlans,
  getPlanById,
  updatePlan,
  deletePlan,
  getDiscountedPlans,
};
