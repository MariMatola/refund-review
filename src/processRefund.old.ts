import { db, stripe } from "./deps";

// Old version
export async function processRefund(transactionId: string, refundAmount: number): Promise<void> {
  // 1. Get the transaction from the DB
  const tx = await db.getTransaction(transactionId);
  if (!tx) {
    throw new Error("Transaction not found");
  }

  // 2. Refund via Stripe
  await stripe.refunds.create({
    payment_intent: tx.pi_id,
    amount: refundAmount,
  });

  // 3. Update the status in the DB
  await db.updateTransaction(transactionId, {
    status: "refunded",
    refunded_amount: tx.refunded_amount + refundAmount,
  });
}
