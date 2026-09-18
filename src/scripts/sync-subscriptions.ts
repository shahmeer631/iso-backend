import { PrismaClient } from "@prisma/client";
import Stripe from "stripe";
import * as dotenv from "dotenv";
import path from "path";

// Load environment variables
dotenv.config({ path: path.join(__dirname, "../../../.env") });

const prisma = new PrismaClient();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
  apiVersion: "2023-10-16" as any,
});

async function main() {
  console.log("🔄 Starting to sync existing subscriptions to payments for the dashboard...");

  // Fetch all subscriptions
  const subscriptions = await prisma.subscription.findMany({
    include: { plan: true },
  });

  console.log(`📊 Found ${subscriptions.length} total subscriptions in the database.`);

  let syncedCount = 0;

  for (const sub of subscriptions) {
    try {
      // Retrieve the Stripe subscription to get the latest invoice
      const stripeSub = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId);
      const invoiceId = typeof stripeSub.latest_invoice === "string" 
        ? stripeSub.latest_invoice 
        : stripeSub.latest_invoice?.id;

      if (!invoiceId) {
        console.log(`⚠️ No invoice found for subscription ${sub.stripeSubscriptionId}. Skipping.`);
        continue;
      }

      // Retrieve the invoice from Stripe
      const invoice = await stripe.invoices.retrieve(invoiceId, { expand: ["payment_intent"] });
      
      const rawPaymentIntent = (invoice as any).payment_intent;
      const paymentIntentId = typeof rawPaymentIntent === 'string' 
        ? rawPaymentIntent 
        : (rawPaymentIntent?.id || invoice.id);

      // Check if a payment record already exists for this invoice/payment intent
      const existingPayment = await prisma.payment.findUnique({
        where: { stripePaymentIntentId: paymentIntentId }
      });

      if (!existingPayment) {
         // Create the payment record so it shows up in the dashboard
         await prisma.payment.create({
            data: {
                userId: sub.userId,
                planId: sub.planId,
                originalAmount: sub.plan.discountedPrice,
                finalAmount: invoice.amount_paid / 100,
                discountAmount: sub.plan.discountedPrice - (invoice.amount_paid / 100),
                currency: invoice.currency || "usd",
                stripePaymentIntentId: paymentIntentId,
                status: "SUCCEEDED",
                createdAt: sub.createdAt, // keep original date
                updatedAt: sub.updatedAt
            }
         });
         console.log(`✅ Synced payment for user ${sub.userId} (Plan: ${sub.plan.name})`);
         syncedCount++;
      } else {
         console.log(`ℹ️ Payment already exists for subscription ${sub.stripeSubscriptionId}. Skipping.`);
      }
    } catch (err) {
      console.error(`❌ Error syncing subscription ${sub.stripeSubscriptionId}:`, err);
    }
  }

  console.log(`🎉 Done! Successfully synced ${syncedCount} missing payments to the dashboard.`);
}

main()
  .catch((e) => {
    console.error("Critical Error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
