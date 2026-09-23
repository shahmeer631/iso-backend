import { userHasFeatureAccess } from "./effectiveAccess";

/**
 * Feature gate used by route middlewares.
 * Considers paid UserAccess ∪ User Group plan access (additive).
 */
const hasAccess = async (userId: string, features: string | string[]) => {
  return userHasFeatureAccess(userId, features);
};

export default hasAccess;
