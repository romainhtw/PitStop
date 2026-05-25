export type POStatus = "draft" | "awaiting_review" | "ordered" | "approved";

export interface LineItemOptionValue {
  optionName: string;
  optionValue: string;
}

export interface InvoiceTotals {
  subtotal: number;
  taxTotal: number;
  freightShipping: number;
  insurance: number;
  customsTariffs: number;
  brokerageFees: number;
  grandTotal: number;
}

export interface LineItem {
  id: string;
  name: string;
  sku: string;
  barcode?: string;
  optionValues?: LineItemOptionValue[];
  category: string;
  qty: number;
  costPrice: number;
  retailPrice: number;
  gstApplicable: boolean;
  hidden?: boolean;
}

export interface VariantSuggestion {
  variantId: string;
  inventoryItemId: string;
  productTitle: string;
  sku?: string;
  barcode?: string;
  score?: number;
}

export interface LineSyncResult {
  lineItemId: string;
  sku: string;
  name: string;
  status: "synced" | "not_found" | "error";
  shopifyVariantId?: string;
  inventoryItemId?: string;
  shopifyProductTitle?: string;
  delta?: number;
  errorMessage?: string;
  suggestions?: VariantSuggestion[];
  shopifyMissingFields?: { field: string; suggestedValue: string }[];
  shopifyPrice?: number;
  currentQty?: number;
  shopifyCategory?: string;
  matchedFromCache?: boolean;
  costDrift?: { historicalCost: number; parsedCost: number; pctChange: number };
  landedCost?: number;
  initialQty?: number;
  conflictError?: { expectedQty: number; actualQty: number; suggestedQty: number };
  untrackedInventory?: boolean;
}

export interface SyncResult {
  syncedAt: string;
  results: LineSyncResult[];
  successCount: number;
  notFoundCount: number;
  errorCount: number;
  duplicateInvoice?: { detectedAt: string; originalPoId: string };
  locationInactive?: boolean;
}

export interface InventoryEntry {
  id: string;
  merchantId?: string;
  productTitle: string;
  variantId: string;
  sku: string;
  barcode: string;
  location: string;
  qtyAdded: number;
  costPrice: number;
  retailPrice: number;
  poId: string;
  invoiceNumber: string;
  supplier: string;
  syncedAt: string;
}

export interface SupplierProfile {
  id: string;
  merchantId?: string;
  name: string;
  parseHints: string;
  defaultLocation: PurchaseOrder["location"] | "";
  approvedPOCount: number;
  lastSeen: string;
  updatedAt: string;
  leadTimeDays?: number;
  safetyStockDays?: number;
}

export interface ShopifyProduct {
  merchantId?: string;
  variantId: string;
  productId: string;
  productTitle: string;
  variantTitle: string;
  sku: string;
  barcode: string;
  price: number;
  compareAtPrice: number | null;
  inventoryItemId: string;
  productType: string;
  status: string;
  tags: string[];
  shopifyUpdatedAt: string;
  syncedAt: string;
  onHandQtyStore?: number;
  onHandQtyWarehouse?: number;
  unitCost?: number | null;
}

export interface AuditLog {
  id: string;
  merchantId?: string;
  poId: string;
  supplier: string;
  invoiceNumber: string;
  location: string;
  syncedAt: string;
  successCount: number;
  notFoundCount: number;
  errorCount: number;
  referenceDocumentUri: string;
  items: Array<{
    name: string;
    sku: string;
    status: string;
    delta?: number;
    landedCost?: number;
  }>;
}

export interface PurchaseOrder {
  id: string;
  merchantId?: string;
  supplier: string;
  invoiceNumber: string;
  invoiceDate: string;
  currency?: string;
  exchangeRate?: number;
  taxVatNumber?: string;
  orderNumber: string;
  location: "In-Store Fitzgerald St" | "Warehouse";
  paymentTerms: string;
  lineItems: LineItem[];
  shippingCost: number;
  invoiceTotals?: InvoiceTotals;
  status: POStatus;
  orderedAt?: string;
  pdfUrl?: string;
  syncResult?: SyncResult;
  createdAt: string;
  updatedAt: string;
}
