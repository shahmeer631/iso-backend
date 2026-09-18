import Stripe from 'stripe';
import dotenv from 'dotenv';
dotenv.config();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
  apiVersion: '2023-10-16' as any,
});

async function main() {
  const events = await stripe.events.list({ limit: 10 });
  events.data.forEach(e => {
    console.log(`Event ID: ${e.id} | Type: ${e.type}`);
  });
}

main().catch(console.error);
