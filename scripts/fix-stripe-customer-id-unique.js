/**
 * MongoDB unique indexes treat `null` as a real value, so many users with
 * stripeCustomerId: null block `Users_stripeCustomerId_key`.
 *
 * Payment code only treats values starting with "cus_" as real Stripe IDs,
 * so placeholders are safe for users who have never checked out.
 */
const { MongoClient, ObjectId } = require("mongodb");

async function main() {
  const uri = process.env.DATABASE_URL || "mongodb://127.0.0.1:27017/scala";
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db();
  const users = db.collection("Users");

  const filter = {
    $or: [{ stripeCustomerId: null }, { stripeCustomerId: { $exists: false } }],
  };

  const total = await users.countDocuments({});
  const nullish = await users.countDocuments(filter);
  const real = await users.countDocuments({
    stripeCustomerId: { $regex: /^cus_/ },
  });

  console.log(JSON.stringify({ total, nullish, realStripeIds: real }, null, 2));

  const cursor = users.find(filter, { projection: { _id: 1 } });
  let updated = 0;
  while (await cursor.hasNext()) {
    const doc = await cursor.next();
    const placeholder = `pending_${doc._id.toString()}`;
    const result = await users.updateOne(
      { _id: doc._id },
      { $set: { stripeCustomerId: placeholder } }
    );
    if (result.modifiedCount) updated += 1;
  }

  console.log(`Updated ${updated} users with unique placeholder stripeCustomerId values.`);
  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
