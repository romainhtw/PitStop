import { NextRequest, NextResponse } from "next/server";
import { shopifyFetch } from "@/lib/shopify";

export const runtime = "nodejs";

const CREATE_PRODUCT_MUTATION = /* GraphQL */ `
  mutation CreateProduct($input: ProductInput!) {
    productCreate(input: $input) {
      product {
        id
        title
        variants(first: 1) {
          edges {
            node {
              id
              inventoryItem { id }
            }
          }
        }
      }
      userErrors { field message }
    }
  }
`;

interface CreateProductData {
  productCreate: {
    product: {
      id: string;
      title: string;
      variants: {
        edges: Array<{
          node: { id: string; inventoryItem: { id: string } };
        }>;
      };
    } | null;
    userErrors: Array<{ field: string; message: string }>;
  };
}

export async function POST(req: NextRequest) {
  if (!process.env.SHOPIFY_STORE_DOMAIN || !process.env.SHOPIFY_ADMIN_ACCESS_TOKEN) {
    return NextResponse.json({ error: "Shopify not configured" }, { status: 500 });
  }

  const body = await req.json() as {
    title: string;
    sku?: string;
    barcode?: string;
    price?: string;
    productType?: string;
  };

  if (!body.title?.trim()) {
    return NextResponse.json({ error: "Title is required" }, { status: 400 });
  }

  const variantInput: Record<string, unknown> = {
    price: body.price || "0.00",
  };
  if (body.sku) variantInput.sku = body.sku;
  if (body.barcode) variantInput.barcode = body.barcode;

  const productInput: Record<string, unknown> = {
    title: body.title.trim(),
    status: "ACTIVE",
    variants: [variantInput],
  };
  if (body.productType) productInput.productType = body.productType;

  const result = await shopifyFetch<CreateProductData>(CREATE_PRODUCT_MUTATION, {
    input: productInput,
  });

  const errors = result?.data?.productCreate?.userErrors ?? [];
  if (errors.length > 0) {
    return NextResponse.json(
      { error: errors.map((e) => e.message).join(", ") },
      { status: 422 }
    );
  }

  const product = result?.data?.productCreate?.product;
  if (!product) {
    return NextResponse.json({ error: "Product creation failed" }, { status: 500 });
  }

  const variant = product.variants.edges[0]?.node;
  if (!variant) {
    return NextResponse.json({ error: "No variant returned" }, { status: 500 });
  }

  return NextResponse.json({
    variantId: variant.id,
    inventoryItemId: variant.inventoryItem.id,
    productTitle: product.title,
  });
}
