export interface CreatePlanDto {
  name: string;
  description?: string;
  badge?: string;
  buttonText?: string;
  originalPrice: number;
  discountedPrice: number;
  validFrom?: string;
  validUntil?: string;
  validityDays: number;
  interval?: "day" | "week" | "month" | "year"; // <-- Added for subscriptions
  features: string[];
  featuresDescription: string[]; // New field for feature descriptions
}

export interface UpdatePlanDto {
  name?: string;
  description?: string;
  badge?: string;
  buttonText?: string;
  originalPrice?: number;
  discountedPrice?: number;
  validFrom?: string;
  validUntil?: string;
  validityDays?: number;
  interval?: "day" | "week" | "month" | "year"; // <-- Added for subscriptions
  features?: string[];
  featuresDescription?: string[]; // New field for feature descriptions
  isActive?: boolean;
}
