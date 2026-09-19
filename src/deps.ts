import type { Transaction } from "./types";

// db/stripe live here so both processRefund versions and the tests share one mock point.
export interface Db {
  getTransaction(id: string): Promise<Transaction | null>;
  updateTransaction(
    id: string,
    data: Partial<Pick<Transaction, "status" | "refunded_amount">>,
    options?: { where?: Partial<Pick<Transaction, "status">> }
  ): Promise<boolean>; // false if the `where` condition didn't match
}

export interface StripeClient {
  refunds: {
    create(params: { payment_intent: string; amount: number }): Promise<unknown>;
  };
}

// Placeholders — tests always mock this module, so these are never called.
export const db: Db = {
  getTransaction() {
    throw new Error("db.getTransaction: not implemented, mock in tests");
  },
  updateTransaction() {
    throw new Error("db.updateTransaction: not implemented, mock in tests");
  },
};

export const stripe: StripeClient = {
  refunds: {
    create() {
      throw new Error("stripe.refunds.create: not implemented, mock in tests");
    },
  },
};