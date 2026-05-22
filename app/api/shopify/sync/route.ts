import { NextRequest, NextResponse } from "next/server";
import { doc, getDoc, updateDoc } from "firebase/firestore/lite";
import { db } from "@/lib/firebase";
import {
  findVariantBySku,
  searchVariantsByTitle,
  adjustInventory,
  toLocationGid,
} from "@/lib/shopify";
import { lookupMapping, saveMapping } from "@/lib/mappings";
import type { PurchaseOrder, LineSyncResult, SyncResult, VariantSuggestion } from "@/lib/types";

export const runtime = "nodejs";

function titleScore(productTitle: string, query: string): number {
  const t = productTitle.toLowerCase();
  const q = query.toLowerCase().trim();
  if (t === q) return 100;
  if (t.startsWith(q)) return 90;
  const words = q.split(/\s+/).filter((w) => w.length > 1);
  if (words.every((w) => t.includes(w))) return 80;
  const matchCount = words.filter((w) => t.includes(w)).length;
  return Math.round((matchCount / Math.max(words.length, 1)) * 60);
}

export async function POST(req: NextRequest) {
  try {
    type SyncOverride = { variantId: string; inventoryItemId: string; productTitle: string };
    const { poId, dryRun, overrides } = (await req.json()) as {
      poId: string;
      dryRun?: boolean;
      overrides?: Record<string, SyncOverride>;
    };

    if (!poId) {
      return NextResponse.json({ error: "poId is required" }, { status: 400 });
    }

    if (
      !process.env.SHOPIFY_STORE_DOMAIN ||
      !process.env.SHOPIFY_ADMIN_ACCESS_TOKEN
    ) {
      return NextResponse.json(
        { error: "Shopify credentials not configured in environment" },
        { status: 500 }
      );
    }

    // Fetch PO
    const poRef = doc(db, "purchaseOrders", poId);
    const poSnap = await getDoc(poRef);
    if (!poSnap.exists()) {
      return NextResponse.json(
        { error: "Purchase order not found" },
        { status: 404 }
      );
    }
    const po = poSnap.data() as PurchaseOrder;

    // Resolve Shopify location GID from PO location
    const rawLocationId =
      po.location === "In-Store Fitzgerald St"
        ? process.env.SHOPIFY_LOCATION_ID_STORE
        : process.env.SHOPIFY_LOCATION_ID_WAREHOUSE;

    const locationGid = toLocationGid(rawLocationId);
    if (!locationGid) {
      return NextResponse.json(
        {
          error: `Shopify location ID not configured for "${po.location}". Set SHOPIFY_LOCATION_ID_STORE or SHOPIFY_LOCATION_ID_WAREHOUSE.`,
        },
        { status: 500 }
      );
    }

    // Process each line item sequentially so we can track individual results
    const results: LineSyncResult[] = [];

    for (const item of po.lineItems.filter((li) => !li.hidden)) {
      const result: LineSyncResult = {
        lineItemId: item.id,
        sku: item.sku,
        name: item.name,
        status: "not_found",
      };

      try {
        const override = overrides?.[item.id];

        if (override) {
          // User confirmed this match manually — persist to mapping table
          result.shopifyVariantId = override.variantId;
          result.inventoryItemId = override.inventoryItemId;
          result.shopifyProductTitle = override.productTitle;
          if (!dryRun) {
            if (item.sku) await saveMapping(po.supplier, item.sku, override);
            if (item.barcode) await saveMapping(po.supplier, item.barcode, override);
          }
          if (dryRun) {
            result.status = "synced";
            result.delta = item.qty;
          } else {
            const { userErrors } = await adjustInventory(
              override.inventoryItemId,
              locationGid,
              item.qty
            );
            if (userErrors.length > 0) {
              result.status = "error";
              result.errorMessage = userErrors.map((e) => e.message).join("; ");
            } else {
              result.status = "synced";
              result.delta = item.qty;
            }
          }
        } else if (!item.sku) {
          result.errorMessage = "No SKU/barcode on this line item";
          // Try name search as fallback when doing a dry-run preview
          if (dryRun && item.name) {
            const byName = await searchVariantsByTitle(item.name);
            if (byName.length > 0) {
              result.suggestions = byName.map<VariantSuggestion>((v) => ({
                variantId: v.id,
                inventoryItemId: v.inventoryItem.id,
                productTitle: v.product.title,
                sku: v.sku || undefined,
                barcode: v.barcode || undefined,
                score: titleScore(v.product.title, item.name),
              }));
            }
          }
        } else {
          // 1. Persistent mapping table (fastest — confirmed by previous syncs)
          const skuMapping = await lookupMapping(po.supplier, item.sku);
          const barcodeMapping = !skuMapping && item.barcode
            ? await lookupMapping(po.supplier, item.barcode)
            : null;
          const knownMatch = skuMapping ?? barcodeMapping;

          let variantId: string | null = null;
          let inventoryItemId: string | null = null;
          let productTitle: string | null = null;

          if (knownMatch) {
            variantId = knownMatch.variantId;
            inventoryItemId = knownMatch.inventoryItemId;
            productTitle = knownMatch.productTitle;
            result.shopifyVariantId = variantId;
            result.inventoryItemId = inventoryItemId;
            result.shopifyProductTitle = productTitle;
            result.matchedFromCache = true;
          } else {
            // 2. Live Shopify lookup: supplier SKU → EAN barcode → title
            let variant = await findVariantBySku(item.sku, dryRun ? locationGid : undefined);
            if (!variant && item.barcode) {
              variant = await findVariantBySku(item.barcode, dryRun ? locationGid : undefined);
            }

            if (variant) {
              variantId = variant.id;
              inventoryItemId = variant.inventoryItem.id;
              productTitle = variant.product?.title ?? null;
              result.shopifyVariantId = variantId;
              result.inventoryItemId = inventoryItemId;
              result.shopifyProductTitle = productTitle ?? undefined;
              if (variant.price) result.shopifyPrice = parseFloat(variant.price);
              const availableQty = variant.inventoryItem?.inventoryLevel?.quantities?.[0]?.quantity;
              if (availableQty != null) result.currentQty = availableQty;
              if (variant.product?.productType) result.shopifyCategory = variant.product.productType;

              const missing: { field: string; suggestedValue: string }[] = [];
              if (!variant.sku && item.sku) missing.push({ field: "sku", suggestedValue: item.sku });
              if (!variant.barcode && item.barcode) missing.push({ field: "barcode", suggestedValue: item.barcode });
              else if (!variant.barcode && item.sku) missing.push({ field: "barcode", suggestedValue: item.sku });
              if (missing.length > 0) result.shopifyMissingFields = missing;

              // Persist this auto-match so the next invoice skips the Shopify lookup
              if (!dryRun) {
                const matchData = { variantId: variant.id, inventoryItemId: variant.inventoryItem.id, productTitle: productTitle ?? "" };
                if (item.sku) await saveMapping(po.supplier, item.sku, matchData);
                if (item.barcode) await saveMapping(po.supplier, item.barcode, matchData);
              }
            }
          }

          if (!variantId || !inventoryItemId) {
            // 3. Title search fallback — only surfaces suggestions, never adjusts inventory
            if (dryRun) {
              const byName = await searchVariantsByTitle(item.name);
              if (byName.length > 0) {
                result.suggestions = byName.map<VariantSuggestion>((v) => ({
                  variantId: v.id,
                  inventoryItemId: v.inventoryItem.id,
                  productTitle: v.product.title,
                  sku: v.sku || undefined,
                  barcode: v.barcode || undefined,
                  score: titleScore(v.product.title, item.name),
                }));
              }
            }
          } else {
            if (dryRun) {
              result.status = "synced";
              result.delta = item.qty;
            } else {
              const { userErrors } = await adjustInventory(inventoryItemId, locationGid, item.qty);
              if (userErrors.length > 0) {
                result.status = "error";
                result.errorMessage = userErrors.map((e) => e.message).join("; ");
              } else {
                result.status = "synced";
                result.delta = item.qty;
              }
            }
          }
        }
      } catch (err) {
        result.status = "error";
        result.errorMessage =
          err instanceof Error ? err.message : "Unknown error";
      }

      results.push(result);
    }

    const syncResult: SyncResult = {
      syncedAt: new Date().toISOString(),
      results,
      successCount: results.filter((r) => r.status === "synced").length,
      notFoundCount: results.filter((r) => r.status === "not_found").length,
      errorCount: results.filter((r) => r.status === "error").length,
    };

    if (!dryRun) {
      await updateDoc(poRef, {
        status: "approved",
        syncResult,
        updatedAt: new Date().toISOString(),
      });

    }

    return NextResponse.json({ ...syncResult, dryRun: !!dryRun });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
