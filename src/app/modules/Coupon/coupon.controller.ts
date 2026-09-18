import { Request, Response } from 'express';
import { CouponService } from './coupon.service';
import catchAsync from '../../../shared/catchAsync';
import sendResponse from '../../../shared/sendResponse';

const couponService = new CouponService();

export const createCoupon = catchAsync(async (req: Request, res: Response) => {
  const coupon = await couponService.createCoupon(req.body);
  sendResponse(res, {
    statusCode: 201,
    success: true,
    message: 'Coupon created successfully',
    data: coupon,
  });
});

export const getAllCoupons = catchAsync(async (req: Request, res: Response) => {
  const coupons = await couponService.getAllCoupons();
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Coupons fetched successfully',
    data: coupons,
  });
});

export const getCouponById = catchAsync(async (req: Request, res: Response) => {
  const coupon = await couponService.getCouponById(req.params.couponId);
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Coupon fetched successfully',
    data: coupon,
  });
});

export const updateCoupon = catchAsync(async (req: Request, res: Response) => {
  const coupon = await couponService.updateCoupon(req.params.couponId, req.body);
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Coupon updated successfully',
    data: coupon,
  });
});

export const deleteCoupon = catchAsync(async (req: Request, res: Response) => {
  await couponService.deleteCoupon(req.params.couponId);
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Coupon deleted successfully',
    data: null,
  });
});

export const validateCoupon = catchAsync(async (req: Request, res: Response) => {
  const result = await couponService.validateCoupon(req.body);
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Coupon is valid',
    data: result,
  });
});