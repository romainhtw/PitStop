import Stripe from "stripe";
import { adminDb } from "@/lib/firebaseAdmin";
import { requireEnv } from "@/lib/requireEnv";

export const PLAN_QUOTAS: Record<string, number> = {
  starter: 25,
  growth: 100,
  pro: 250,
  founder: 100,
};

export const PLAN_PRICES: Record<string, number> = {
  starter: 3900,
  growth: 8900,
  pro: 17900,
};

export const PLAN_NAMES: Record<string, string> = {
  starter: "Starter",
  growth: "Growth",
  pro: "Pro",
  founder: "Growth (Founder)",
};

export interface UsageResult {
  invoicesUsed: number;
  quota: number;
  remaining: number;
  isOverage: boolean;
  overageCount: number;
}

/**
 * Called after every successful invoice parse.
 * Increments the Firestore counter and — if over quota —
 * reports a usage record to the Stripe metered overage price.
 */
export async function recordInvoiceUsage(): Promise<UsageResult> {
  const billingSnap = await adminDb.collection("settings").doc("billing").get();

  if (!billingSnap.exists) {
    return { invoicesUsed: 0, quota: 0, remaining: 0, isOverage: false, overageCount: 0 };
  }

  const billing = billingSnap.data() as {
    subscriptionId?: string;
    plan?: string;
    invoicesUsedThisPeriod?: number;
    freeInvoiceCredits?: number;
    freeInvoicesUsed?: number;
    overageSubscriptionItemId?: string;
  };

  if (!billing.subscriptionId) {
    return { invoicesUsed: 0, quota: 0, remaining: 0, isOverage: false, overageCount: 0 };
  }

  const plan = billing.plan ?? "growth";
  const quota = PLAN_QUOTAS[plan] ?? 100;

  // Free credits come out first (referee bonus from referral)
  const freeCredits = billing.freeInvoiceCredits ?? 0;
  const freeUsed = billing.freeInvoicesUsed ?? 0;
  const freeRemaining = Math.max(0, freeCredits - freeUsed);

  const updates: Record<string, unknown> = {
    lastInvoiceParsedAt: new Date().toISOString(),
  };

  if (freeRemaining > 0) {
    // Consume a free credit first
    updates.freeInvoicesUsed = freeUsed + 1;
  } else {
    // Consume from paid quota
    updates.invoicesUsedThisPeriod = (billing.invoicesUsedThisPeriod ?? 0) + 1;
  }

  await adminDb.collection("settings").doc("billing").update(updates);

  const newCount = freeRemaining > 0
    ? (billing.invoicesUsedThisPeriod ?? 0)
    : (billing.invoicesUsedThisPeriod ?? 0) + 1;

  const isOverage = newCount > quota;
  const overageCount = Math.max(0, newCount - quota);

  // Report to Stripe metered billing when over quota
  if (isOverage && billing.overageSubscriptionItemId) {
    try {
      const stripe = new Stripe(requireEnv("STRIPE_SECRET_KEY"), { apiVersion: "2026-04-22.dahlia" });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (stripe.subscriptionItems as any).createUsageRecord(
        billing.overageSubscriptionItemId,
        { quantity: 1, timestamp: Math.floor(Date.now() / 1000), action: "increment" }
      );
    } catch (err) {
      console.error("[usageTracking] Stripe usage record failed:", err);
      // Non-fatal — don't break the parse
    }
  }

  return {
    invoicesUsed: newCount,
    quota,
    remaining: Math.max(0, quota - newCount),
    isOverage,
    overageCount,
  };
}

/**
 * Reset the invoice counter at the start of a new billing period.
 * Called from the billing webhook on invoice.payment_succeeded.
 */
export async function resetPeriodUsage(): Promise<void> {
  await adminDb.collection("settings").doc("billing").update({
    invoicesUsedThisPeriod: 0,
    periodResetAt: new Date().toISOString(),
  });
}
