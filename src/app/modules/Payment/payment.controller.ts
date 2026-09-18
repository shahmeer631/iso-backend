import { Request, Response } from "express";
import { PaymentService } from "./payment.service";
import catchAsync from "../../../shared/catchAsync";
import sendResponse from "../../../shared/sendResponse";

const stripeWebhook = async (req: Request, res: Response) => {
  try {
    const sig = req.headers["stripe-signature"] as string;

    await PaymentService.handleStripeWebhook(req.body, sig);

    res.status(200).json({ received: true });
  } catch (err) {
    console.error("Webhook error:", err);
    res.status(400).send(`Webhook Error`);
  }
};

const createPaymentIntent = catchAsync(async (req, res: Response) => {
  const result = await PaymentService.createPaymentIntent({
    ...req.body,
    userId: req.user.id,
  });
  sendResponse(res, {
    statusCode: 201,
    success: true,
    message: "Payment intent created successfully",
    data: result,
  });
});

const createSubscription = catchAsync(async (req, res: Response) => {
  const result = await PaymentService.createSubscription({
    ...req.body,
    userId: req.user.id,
  });
  sendResponse(res, {
    statusCode: 201,
    success: true,
    message: "Subscription intent created successfully",
    data: result,
  });
});

const createCustomerPortal = catchAsync(async (req, res: Response) => {
  const result = await PaymentService.createCustomerPortal(req.user.id);
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Customer portal created successfully",
    data: result,
  });
});

const upgradeSubscription = catchAsync(async (req, res: Response) => {
  const result = await PaymentService.upgradeSubscription(req.user.id, req.body.newPlanId);
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Subscription upgraded successfully",
    data: result,
  });
});

const getUserPayments = catchAsync(async (req, res: Response) => {
  const payments = await PaymentService.getUserPayments(req.user.id);
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Payments fetched successfully",
    data: payments,
  });
});

const getAllPayments = catchAsync(async (req, res: Response) => {
  const payments = await PaymentService.getAllPayments();
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "All payments fetched successfully",
    data: payments,
  });
});

const getUserAccess = catchAsync(async (req, res) => {
  const access = await PaymentService.getUserAccess(req.user?.id);
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "User access fetched successfully",
    data: access,
  });
});

const getUserAccessByAdmin = catchAsync(async (req, res: Response) => {
  const { userId } = req.params;
  const access = await PaymentService.getUserAccess(userId);

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "User access fetched successfully",
    data: access,
  });
});

const createSetupIntent = catchAsync(async (req, res: Response) => {
  const result = await PaymentService.createSetupIntent(req.user.id);
  sendResponse(res, {
    statusCode: 201,
    success: true,
    message: "Setup intent created successfully",
    data: result,
  });
});

export const PaymentController = {
  createPaymentIntent,
  createSetupIntent,
  createSubscription,
  getUserPayments,
  getAllPayments,
  getUserAccess,
  stripeWebhook,
  getUserAccessByAdmin,
  upgradeSubscription,
  createCustomerPortal,
};
