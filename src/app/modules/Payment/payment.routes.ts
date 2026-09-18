import { Router } from "express";
import auth from "../../../middlewares/auth";
import { PaymentController } from "./payment.controller";
import { handlePaymentSuccess } from "./payment.service";
import { UserRole } from "@prisma/client";

const router = Router();

router.post("/webhook", PaymentController.stripeWebhook);

router.post("/confirm", auth(UserRole.USER), async (req, res, next) => {
  try {
    const { paymentIntentId } = req.body;
    const result = await handlePaymentSuccess(paymentIntentId, req.user.id);

    res.json({
      success: true,
      data: result,
    });
  } catch (err) {
    next(err);
  }
});

// ── USER ───────────────────────────────────────
router.post(
  "/create-intent",
  auth(UserRole.USER),
  PaymentController.createPaymentIntent,
);

router.post(
  "/create-setup-intent",
  auth(UserRole.USER),
  PaymentController.createSetupIntent,
);

router.post(
  "/create-subscription",
  auth(UserRole.USER),
  PaymentController.createSubscription,
);
router.post(
  "/customer-portal",
  auth(UserRole.USER),
  PaymentController.createCustomerPortal,
);
router.post(
  "/upgrade-subscription",
  auth(UserRole.USER),
  PaymentController.upgradeSubscription,
);
router.get(
  "/user/:userId",
  auth(UserRole.USER),
  PaymentController.getUserPayments,
);
router.get("/access", auth(UserRole.USER), PaymentController.getUserAccess);

router.get(
  "/access/:userId",
  auth(UserRole.SUPER_ADMIN),
  PaymentController.getUserAccessByAdmin,
);

// ── ADMIN ──────────────────────────────────────
router.get("/", auth(UserRole.SUPER_ADMIN), PaymentController.getAllPayments);

export const PaymentRoutes = router;
