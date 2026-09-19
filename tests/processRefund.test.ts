import type { Transaction } from "../src/types";

jest.mock("../src/deps", () => ({
  db: { getTransaction: jest.fn(), updateTransaction: jest.fn() },
  stripe: { refunds: { create: jest.fn() } },
}));

import { db, stripe } from "../src/deps";
// Swap this import to test the other implementation:
// import { processRefund } from "../src/processRefund.new";
import { processRefund } from "../src/processRefund.old";

const mockDb = db as unknown as { getTransaction: jest.Mock; updateTransaction: jest.Mock };
const mockStripe = stripe as unknown as { refunds: { create: jest.Mock } };

beforeEach(() => {
  jest.resetAllMocks();
});

describe("processRefund", () => {
  test("rejects refunding a transaction that isn't captured/partially_refunded", async () => {
    const tx: Transaction = { id: "tx_1", pi_id: "pi_1", status: "refunded", amount: 1000, refunded_amount: 1000 };
    mockDb.getTransaction.mockResolvedValue(tx);

    await expect(processRefund(tx.id, 1000)).rejects.toThrow('Cannot refund transaction with status "refunded"');
    expect(mockStripe.refunds.create).not.toHaveBeenCalled();
  });

  test("rejects a refund amount larger than what's left to refund", async () => {
    const tx: Transaction = { id: "tx_1", pi_id: "pi_1", status: "captured", amount: 1000, refunded_amount: 800 };
    mockDb.getTransaction.mockResolvedValue(tx);

    await expect(processRefund(tx.id, 500)).rejects.toThrow("Refund amount 500 exceeds refundable amount 200");
    expect(mockStripe.refunds.create).not.toHaveBeenCalled();
  });

  test("rejects a zero or negative refund amount", async () => {
    const tx: Transaction = { id: "tx_1", pi_id: "pi_1", status: "captured", amount: 1000, refunded_amount: 0 };
    mockDb.getTransaction.mockResolvedValue(tx);

    await expect(processRefund(tx.id, 0)).rejects.toThrow("Refund amount 0 exceeds refundable amount 1000");
    await expect(processRefund(tx.id, -50)).rejects.toThrow("Refund amount -50 exceeds refundable amount 1000");
    expect(mockStripe.refunds.create).not.toHaveBeenCalled();
  });

  test("doesn't double-refund via Stripe when two calls run concurrently", async () => {
    let stored: Transaction = { id: "tx_1", pi_id: "pi_1", status: "captured", amount: 1000, refunded_amount: 0 };
    mockDb.getTransaction.mockImplementation(async () => ({ ...stored }));
    mockDb.updateTransaction.mockImplementation(async (_id: string, data: Partial<Transaction>, options?: { where?: { status?: string } }) => {
      if (options?.where?.status !== undefined && options.where.status !== stored.status) {
        return false;
      }
      stored = { ...stored, ...data };
      return true;
    });
    mockStripe.refunds.create.mockResolvedValue({
      id: "re_1",
      object: "refund",
      status: "succeeded",
      amount: 500,
      currency: "usd",
      payment_intent: stored.pi_id,
    });

    await Promise.allSettled([processRefund(stored.id, 500), processRefund(stored.id, 500)]);

    expect(mockStripe.refunds.create).toHaveBeenCalledTimes(1);
  });

  test("doesn't re-refund via Stripe on retry after the DB write fails post-refund", async () => {
    let stored: Transaction = { id: "tx_1", pi_id: "pi_1", status: "captured", amount: 1000, refunded_amount: 0 };
    let finalWriteAttempts = 0;
    mockDb.getTransaction.mockImplementation(async () => ({ ...stored }));
    mockDb.updateTransaction.mockImplementation(async (_id: string, data: Partial<Transaction>, options?: { where?: { status?: string } }) => {
      if (options?.where?.status !== undefined && options.where.status !== stored.status) {
        return false;
      }
      const isFinalWrite = data.status === "refunded" || data.status === "partially_refunded";
      if (isFinalWrite) {
        finalWriteAttempts += 1;
        if (finalWriteAttempts === 1) {
          throw new Error("db_write_failed");
        }
      }
      stored = { ...stored, ...data };
      return true;
    });
    mockStripe.refunds.create.mockResolvedValue({
      id: "re_1",
      object: "refund",
      status: "succeeded",
      amount: 500,
      currency: "usd",
      payment_intent: stored.pi_id,
    });

    // First attempt: Stripe succeeds, but the final DB write fails.
    await expect(processRefund(stored.id, 500)).rejects.toThrow("db_write_failed");
    expect(mockStripe.refunds.create).toHaveBeenCalledTimes(1);

    // Retry: must not hit Stripe again (whether the retry itself resolves or rejects
    // is implementation-specific — what matters is no second real charge happens).
    await processRefund(stored.id, 500).catch(() => {});
    expect(mockStripe.refunds.create).toHaveBeenCalledTimes(1);
  });

  test("doesn't mark the transaction as refunded when Stripe declines the refund", async () => {
    const tx: Transaction = { id: "tx_1", pi_id: "pi_1", status: "captured", amount: 1000, refunded_amount: 0 };
    mockDb.getTransaction.mockResolvedValue(tx);
    mockDb.updateTransaction.mockResolvedValue(true);
    // Shape of a real Stripe error: has `type`/`code`, not just a message.
    mockStripe.refunds.create.mockRejectedValue(
      Object.assign(new Error("This payment intent could not be refunded."), {
        type: "StripeInvalidRequestError",
        code: "charge_already_refunded",
      })
    );

    await expect(processRefund(tx.id, 500)).rejects.toThrow("This payment intent could not be refunded.");
    expect(mockDb.updateTransaction).not.toHaveBeenCalledWith(
      tx.id,
      expect.objectContaining({ status: "refunded" }),
    );
  });
});