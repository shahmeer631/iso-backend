export interface CreateCouponDto {
  code: string;
  discountType: 'PERCENTAGE' | 'FIXED';
  discountValue: number;
  usageLimit?: number;
  expiryDate?: string;
  applyTo?: string; // planId বা null = all plans
  minimumAmount?: number;
  firstTimeOnly?: boolean;
  isActive?: boolean;
  affiliateId?: string;
}

export interface UpdateCouponDto {
  discountType?: 'PERCENTAGE' | 'FIXED';
  discountValue?: number;
  usageLimit?: number;
  expiryDate?: string;
  applyTo?: string;
  minimumAmount?: number;
  firstTimeOnly?: boolean;
  isActive?: boolean;
}

export interface ValidateCouponDto {
  code: string;
  planId: string;
  userId: string;
}

export interface ValidateCouponResponse {
  couponId: string;
  code: string;
  discountType: 'PERCENTAGE' | 'FIXED';
  discountValue: number;
  originalAmount: number;
  discountAmount: number;
  finalAmount: number;
}