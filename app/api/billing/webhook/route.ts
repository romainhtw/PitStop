import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { adminDb } from "@/lib/firebaseAdmin";
import { requireEnv } from "@/lib/requireEnv";

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

  try {
    const billingRef = adminDb.collection("settings").doc("billing");

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode === "subscription" && session.subscription && session.customer) {
          const sub = await stripe.subscriptions.retrieve(session.subscription as string);
          const rawEnd = (sub as unknown as Record<string, unknown>).current_period_end as number | undefined
            ?? ((sub.items?.data?.[0] as unknown as Record<string, unknown>)?.current_period_end as number | undefined);
          await billingRef.set({
            customerId: session.customer as string,
            subscriptionId: session.subscription as string,
            status: sub.status,
            currentPeriodEnd: rawEnd ? new Date(rawEnd * 1000).toISOString() : "",
            planName: sub.items.data[0]?.plan?.nickname ?? "PitStop",
            updatedAt: new Date().toISOString(),
          }, { merge: true });
        }
        break;
      }

      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const rawEnd = (sub as unknown as Record<string, unknown>).current_period_end as number | undefined
          ?? ((sub.items?.data?.[0] as unknown as Record<string, unknown>)?.current_period_end as number | undefined);
        await billingRef.set({
          subscriptionId: sub.id,
          status: sub.status,
          currentPeriodEnd: rawEnd ? new Date(rawEnd * 1000).toISOString() : "",
          updatedAt: new Date().toISOString(),
        }, { merge: true });
        break;
      }
    }
  } catch (err) {
    console.error("[stripe-webhook] Handler error:", err);
    return NextResponse.json({ error: "Handler failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
