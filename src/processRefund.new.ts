import { db, stripe } from "./deps";

// Fixed version
export async function processRefund(transactionId: string, refundAmount: number): Promise<void> {
  const tx = await db.getTransaction(transactionId);
  if (!tx) {
    throw new Error("Transaction not found");
  }

  // new: reject already-refunded/pending transactions
  if (tx.status !== "captured" && tx.status !== "partially_refunded") {
    throw new Error(`Cannot refund transaction with status "${tx.status}"`);
  }

  // new: reject amount over the remaining balance, or <= 0
  const refundable = tx.amount - tx.refunded_amount;
  if (refundAmount <= 0 || refundAmount > refundable) {
    throw new Error(`Refund amount ${refundAmount} exceeds refundable amount ${refundable}`);
  }

  // new: atomically claim the row so a concurrent call can't process it too
  const claimed = await db.updateTransaction(
    transactionId,
    { status: "refunding" },
    { where: { status: tx.status } }
  );
  if (!claimed) {
    throw new Error("Already processing or status changed concurrently");
  }

  try {
    await stripe.refunds.create({
      payment_intent: tx.pi_id,
      amount: refundAmount,
    });
  } catch (err) {
    // new: Stripe failed — release the claim so the transaction can be retried
    await db.updateTransaction(transactionId, { status: tx.status });
    throw err;
  }

  // new: if this write fails, transaction stays "refunding" (blocks re-refund,
  // needs manual reconciliation) instead of silently allowing a double refund
  const newRefundedAmount = tx.refunded_amount + refundAmount;
  const newStatus = newRefundedAmount >= tx.amount ? "refunded" : "partially_refunded";

  await db.updateTransaction(transactionId, {
    status: newStatus,
    refunded_amount: newRefundedAmount,
  });
}