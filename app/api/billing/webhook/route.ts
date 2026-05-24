import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebaseAdmin";
import { requireEnv } from "@/lib/requireEnv";
import { resetPeriodUsage } from "@/lib/stripe/usageTracking";
import { planToTier } from "@/lib/billing/tiers";
import { invalidateSubscriptionCache } from "@/lib/billing/enforce-subscription";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const stripe = new Stripe(requireEnv("STRIPE_SECRET_KEY"), { apiVersion: "2026-04-22.dahlia" });

  const body = await req.text();
  const sig = req.headers.get("stripe-signature") ?? "";

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, requireEnv("STRIPE_WEBHOOK_SECRET"));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Webhook verification failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  // ── Idempotency guard ─────────────────────────────────────────────────────
  const eventRef = adminDb.collection("stripeEvents").doc(event.id);
  const seen = await eventRef.get();
  if (seen.exists) {
    return NextResponse.json({ received: true, duplicate: true });
  }
  await eventRef.set({ type: event.type, processedAt: FieldValue.serverTimestamp() });

  // ── Helper: sync tier to merchant doc (multi-tenant) ─────────────────────
  async function syncMerchantTier(
    customerId: string,
    subscriptionId: string,
    plan: string,
    status: string,
    periodEnd: number | undefined,
  ) {
    const tier = planToTier(plan);
    const snap = await adminDb
      .collection("merchants")
      .where("stripeCustomerId", "==", customerId)
      .limit(1)
      .get();
    if (snap.empty) return;
    const merchantId = snap.docs[0].id;
    await snap.docs[0].ref.update({
      subscriptionTier:            tier,
      subscriptionStatus:          status,
      stripeSubscriptionId:        subscriptionId,
      subscriptionCurrentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
      updatedAt:                   FieldValue.serverTimestamp(),
    });
    invalidateSubscriptionCache(merchantId);
  }

  try {
    const billingRef = adminDb.collection("settings").doc("billing");

    switch (event.type) {

      // ── NEW SUBSCRIPTION CREATED ────────────────────────────────────────
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode !== "subscription" || !session.subscription || !session.customer) break;

        const sub = await stripe.subscriptions.retrieve(session.subscription as string);

        // Find the flat price item and the metered overage item
        const flatItem = sub.items.data.find(
          (item) => item.price.metadata?.type === "flat" || item.price.recurring?.usage_type === "licensed"
        );
        const overageItem = sub.items.data.find(
          (item) => item.price.recurring?.usage_type === "metered"
        );

        const rawEnd = (sub as unknown as Record<string, unknown>).current_period_end as number | undefined
          ?? ((sub.items?.data?.[0] as unknown as Record<string, unknown>)?.current_period_end as number | undefined);

        const plan = (sub.metadata?.plan ?? flatItem?.price?.metadata?.tier ?? "growth") as string;

        await billingRef.set({
          customerId: session.customer as string,
          subscriptionId: session.subscription as string,
          status: sub.status,
          plan,
          planName: flatItem?.price?.nickname ?? "Growth",
          currentPeriodEnd:   rawEnd ? new Date(rawEnd * 1000).toISOString() : "",
          currentPeriodStart: rawEnd ? new Date(((sub as unknown as Record<string, unknown>).current_period_start as number) * 1000).toISOString() : "",
          flatSubscriptionItemId:    flatItem?.id ?? null,
          overageSubscriptionItemId: overageItem?.id ?? null,
          invoicesUsedThisPeriod: 0,
          updatedAt: new Date().toISOString(),
        }, { merge: true });

        // Sync tier to merchant doc (multi-tenant)
        await syncMerchantTier(
          session.customer as string,
          session.subscription as string,
          plan,
          sub.status,
          rawEnd,
        );

        // ── REFERRAL DETECTION ──────────────────────────────────────────
        const discountEntry = session.total_details?.breakdown?.discounts?.[0];
        const promoCodeRef = (discountEntry?.discount as unknown as Record<string, unknown>)?.promotion_code;
        if (promoCodeRef) {
          const promoId = typeof promoCodeRef === "string" ? promoCodeRef : (promoCodeRef as { id: string }).id;
          await handleReferral(stripe, promoId, session.customer as string, session.customer_details?.email ?? "");
        }
        break;
      }

      // ── PLAN CHANGED OR CANCELLED ───────────────────────────────────────
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const rawEnd = (sub as unknown as Record<string, unknown>).current_period_end as number | undefined
          ?? ((sub.items?.data?.[0] as unknown as Record<string, unknown>)?.current_period_end as number | undefined);

        const flatItem = sub.items.data.find(
          (item) => item.price.recurring?.usage_type === "licensed"
        );
        const plan = (sub.metadata?.plan ?? flatItem?.price?.metadata?.tier ?? "growth") as string;

        await billingRef.set({
          subscriptionId: sub.id,
          status: sub.status,
          plan,
          planName: flatItem?.price?.nickname ?? "Growth",
          currentPeriodEnd: rawEnd ? new Date(rawEnd * 1000).toISOString() : "",
          updatedAt: new Date().toISOString(),
        }, { merge: true });

        // Sync tier to merchant doc (multi-tenant)
        await syncMerchantTier(
          sub.customer as string,
          sub.id,
          plan,
          sub.status,
          rawEnd,
        );
        break;
      }

      // ── PAYMENT FAILED ──────────────────────────────────────────────────
      case "invoice.payment_failed": {
        const inv = event.data.object as Stripe.Invoice;
        const failSnap = await adminDb
          .collection("merchants")
          .where("stripeCustomerId", "==", inv.customer as string)
          .limit(1)
          .get();
        if (!failSnap.empty) {
          const merchantId = failSnap.docs[0].id;
          await failSnap.docs[0].ref.update({
            subscriptionStatus: "past_due",
            updatedAt: FieldValue.serverTimestamp(),
          });
          invalidateSubscriptionCache(merchantId);
        }
        break;
      }

      // ── PERIOD RENEWAL — reset invoice counter ──────────────────────────
      case "invoice.payment_succeeded": {
        const invoice = event.data.object as Stripe.Invoice;
        if (invoice.billing_reason === "subscription_cycle") {
          await resetPeriodUsage();
        }
        break;
      }
    }

  } catch (err) {
    console.error("[stripe-webhook] Handler error:", err);
    return NextResponse.json({ error: "Handler failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

// ── REFERRAL PROCESSING ─────────────────────────────────────────────────────

async function handleReferral(
  stripe: Stripe,
  promotionCodeId: string,
  refereeCustomerId: string,
  refereeEmail: string
): Promise<void> {
  try {
    const promo = await stripe.promotionCodes.retrieve(promotionCodeId);
    const referrerCustomerId = promo.metadata?.referrerCustomerId;
    const referralCode = promo.code;

    if (!referrerCustomerId) return; // not a referral promo code

    const now = new Date().toISOString();
    const CREDIT_CENTS = 5000; // $50 AUD
    const FREE_INVOICES = 20;

    // 1. Apply $50 balance credit to referrer
    await stripe.customers.createBalanceTransaction(referrerCustomerId, {
      amount: -CREDIT_CENTS, // negative = credit
      currency: "aud",
      description: `Referral reward — ${refereeEmail} joined via ${referralCode}`,
      metadata: { type: "referral_reward", referralCode, refereeCustomerId },
    });

    // 2. Unlock 20 free invoices for referee in Firestore
    await adminDb.collection("settings").doc("billing").update({
      freeInvoiceCredits: FREE_INVOICES,
      freeInvoicesUsed: 0,
      referredBy: referralCode,
      referredAt: now,
    });

    // 3. Update referral record
    const referralRef = adminDb.collection("referrals").doc(referralCode);
    const referralSnap = await referralRef.get();
    if (referralSnap.exists) {
      const data = referralSnap.data() as {
        totalReferrals?: number;
        totalCreditsEarned?: number;
        referrals?: unknown[];
      };
      await referralRef.update({
        totalReferrals: (data.totalReferrals ?? 0) + 1,
        totalCreditsEarned: (data.totalCreditsEarned ?? 0) + CREDIT_CENTS,
        referrals: [
          ...(data.referrals ?? []),
          { refereeCustomerId, refereeEmail, signedUpAt: now, creditAmountCents: CREDIT_CENTS },
        ],
      });
    }

    console.log(`[referral] $50 credit → ${referrerCustomerId} | 20 free invoices → ${refereeCustomerId}`);
  } catch (err) {
    console.error("[referral] handleReferral failed:", err);
    // Non-fatal — don't fail the webhook
  }
}
