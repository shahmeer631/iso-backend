export interface CreatePaymentIntentDto {
  planId: string;
  userId: string;
  couponCode?: string;
  paymentMethodId?: string;
}

export interface ConfirmPaymentDto {
  stripePaymentIntentId: string;
}