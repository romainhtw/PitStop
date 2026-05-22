const API_VERSION = "2025-01";

export function shopifyGraphqlUrl(): string {
  return `https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/${API_VERSION}/graphql.json`;
}

export async function shopifyFetch<T = unknown>(
  query: string,
  variables?: Record<string, unknown>
): Promise<{ data?: T; errors?: Array<{ message: string }> }> {
  const res = await fetch(shopifyGraphqlUrl(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": process.env.SHOPIFY_ADMIN_ACCESS_TOKEN!,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    throw new Error(`Shopify API error: ${res.status} ${res.statusText}`);
  }

  return res.json();
}

export function toLocationGid(envVal: string | undefined): string {
  if (!envVal) return "";
  return envVal.startsWith("gid://")
    ? envVal
    : `gid://shopify/Location/${envVal}`;
}

export const FIND_VARIANT_QUERY = /* GraphQL */ `
  query FindVariant($query: String!) {
    productVariants(first: 1, query: $query) {
      edges {
        node {
          id
          sku
          barcode
          price
          product {
            title
            productType
          }
          inventoryItem {
            id
          }
        }
      }
    }
  }
`;

const FIND_VARIANT_WITH_INVENTORY_QUERY = /* GraphQL */ `
  query FindVariantWithInventory($query: String!, $locationId: ID!) {
    productVariants(first: 1, query: $query) {
      edges {
        node {
          id
          sku
          barcode
          price
          product {
            title
            productType
          }
          inventoryItem {
            id
            inventoryLevel(locationId: $locationId) {
              quantities(names: ["available"]) {
                quantity
              }
            }
          }
        }
      }
    }
  }
`;

export const ADJUST_INVENTORY_MUTATION = /* GraphQL */ `
  mutation AdjustInventory($input: InventoryAdjustQuantitiesInput!) {
    inventoryAdjustQuantities(input: $input) {
      userErrors {
        field
        message
      }
      inventoryAdjustmentGroup {
        changes {
          name
          delta
          item {
            id
          }
          location {
            id
          }
        }
      }
    }
  }
`;

interface ShopifyVariantNode {
  id: string;
  sku: string;
  barcode: string;
  price?: string;
  product: { title: string; productType?: string };
  inventoryItem: {
    id: string;
    inventoryLevel?: { quantities: Array<{ quantity: number }> } | null;
  };
}

interface FindVariantData {
  productVariants: {
    edges: Array<{ node: ShopifyVariantNode }>;
  };
}

export async function findVariantBySku(
  sku: string,
  locationGid?: string
): Promise<ShopifyVariantNode | null> {
  if (!sku) return null;

  const query = locationGid ? FIND_VARIANT_WITH_INVENTORY_QUERY : FIND_VARIANT_QUERY;

  for (const searchField of [`sku:${sku}`, `barcode:${sku}`]) {
    const variables: Record<string, string> = { query: searchField };
    if (locationGid) variables.locationId = locationGid;
    const result = await shopifyFetch<FindVariantData>(query, variables);
    const edges = result?.data?.productVariants?.edges ?? [];
    if (edges.length > 0) return edges[0].node;
  }

  return null;
}

const SEARCH_BY_TITLE_QUERY = /* GraphQL */ `
  query SearchByTitle($q: String!) {
    products(first: 10, query: $q) {
      nodes {
        title
        variants(first: 5) {
          nodes {
            id
            sku
            barcode
            inventoryItem { id }
          }
        }
      }
    }
  }
`;

interface SearchProductsData {
  products: {
    nodes: Array<{
      title: string;
      variants: {
        nodes: Array<{
          id: string;
          sku: string;
          barcode: string;
          inventoryItem: { id: string };
        }>;
      };
    }>;
  };
}

const SIZE_WORDS = new Set(["xs","s","m","l","xl","xxl","2xl","3xl","4xl","small","medium","large","one","size"]);
const COLOR_WORDS = new Set(["black","white","red","blue","green","yellow","purple","pink","orange","grey","gray","silver","gold","rose","royal","shiny","matte","dark","light","navy","teal","coral","beige","cream","brown","maroon","violet","indigo","lime","aqua","cyan","magenta","pearl","chrome","gloss","satin"]);

function extractCoreModel(name: string): string {
  const tokens = name
    .toLowerCase()
    .replace(/[^\w\s.]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  // Drop single-character tokens (sizes like S, M, L), color words, and pure numbers
  const core = tokens.filter(
    (t) => t.length > 1 && !SIZE_WORDS.has(t) && !COLOR_WORDS.has(t) && !/^\d+$/.test(t)
  );

  // Use first 2 meaningful tokens — conservative to avoid niche supplier terms
  // that don't appear in Shopify product titles (e.g. "ACE LED" from PSI Cycling)
  return core.slice(0, 2).join(" ");
}

async function fetchVariantsByQuery(q: string): Promise<ShopifyVariantNode[]> {
  const result = await shopifyFetch<SearchProductsData>(SEARCH_BY_TITLE_QUERY, { q });
  const products = result?.data?.products?.nodes ?? [];
  const variants: ShopifyVariantNode[] = [];
  for (const p of products) {
    for (const v of p.variants.nodes) {
      variants.push({
        id: v.id,
        sku: v.sku,
        barcode: v.barcode,
        inventoryItem: v.inventoryItem,
        product: { title: p.title },
      });
    }
  }
  return variants;
}

export async function searchVariantsByTitle(name: string): Promise<ShopifyVariantNode[]> {
  if (!name) return [];

  const coreQuery = extractCoreModel(name);
  if (!coreQuery) return [];

  // Search with title: prefix (exact match), then without (broader)
  const [exact, broad] = await Promise.all([
    fetchVariantsByQuery(`title:${coreQuery}`),
    fetchVariantsByQuery(coreQuery),
  ]);

  // Merge, deduplicate by variantId, cap at 10
  const seen = new Set<string>();
  const merged: ShopifyVariantNode[] = [];
  for (const v of [...exact, ...broad]) {
    if (!seen.has(v.id)) {
      seen.add(v.id);
      merged.push(v);
      if (merged.length >= 10) break;
    }
  }
  return merged;
}

export const CATALOG_QUERY = /* GraphQL */ `
  query GetProducts($cursor: String) {
    products(first: 250, after: $cursor, query: "status:active") {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          title
          productType
          status
          tags
          updatedAt
          variants(first: 100) {
            edges {
              node {
                id
                title
                sku
                barcode
                price
                compareAtPrice
                inventoryItem { id }
              }
            }
          }
        }
      }
    }
  }
`;

interface CatalogData {
  products: {
    pageInfo: { hasNextPage: boolean; endCursor: string };
    edges: Array<{
      node: {
        id: string;
        title: string;
        productType: string;
        status: string;
        tags: string[];
        updatedAt: string;
        variants: {
          edges: Array<{
            node: {
              id: string;
              title: string;
              sku: string;
              barcode: string;
              price: string;
              compareAtPrice: string | null;
              inventoryItem: { id: string };
            };
          }>;
        };
      };
    }>;
  };
}

export interface CatalogVariant {
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
}

export async function fetchAllActiveVariants(): Promise<CatalogVariant[]> {
  const variants: CatalogVariant[] = [];
  let cursor: string | undefined;

  for (;;) {
    const vars: Record<string, unknown> = cursor ? { cursor } : {};
    const page: { data?: CatalogData } = await shopifyFetch<CatalogData>(CATALOG_QUERY, vars);
    const products = page?.data?.products;
    if (!products) break;

    for (const { node: p } of products.edges) {
      for (const { node: v } of p.variants.edges) {
        variants.push({
          variantId: v.id,
          productId: p.id,
          productTitle: p.title,
          variantTitle: v.title === "Default Title" ? "" : v.title,
          sku: v.sku || "",
          barcode: v.barcode || "",
          price: parseFloat(v.price) || 0,
          compareAtPrice: v.compareAtPrice ? parseFloat(v.compareAtPrice) : null,
          inventoryItemId: v.inventoryItem.id,
          productType: p.productType || "",
          status: p.status,
          tags: p.tags,
          shopifyUpdatedAt: p.updatedAt,
        });
      }
    }

    if (!products.pageInfo.hasNextPage) break;
    cursor = products.pageInfo.endCursor;
  }

  return variants;
}

export const REGISTER_WEBHOOK_MUTATION = /* GraphQL */ `
  mutation RegisterWebhook($topic: WebhookSubscriptionTopic!, $callbackUrl: URL!) {
    webhookSubscriptionCreate(
      topic: $topic
      webhookSubscription: { callbackUrl: $callbackUrl, format: JSON }
    ) {
      userErrors { field message }
      webhookSubscription { id topic }
    }
  }
`;

interface AdjustInventoryData {
  inventoryAdjustQuantities: {
    userErrors: Array<{ field: string; message: string }>;
    inventoryAdjustmentGroup: {
      changes: Array<{
        name: string;
        delta: number;
        item: { id: string };
        location: { id: string };
      }>;
    } | null;
  };
}

export async function adjustInventory(
  inventoryItemId: string,
  locationId: string,
  delta: number
): Promise<{ userErrors: Array<{ field: string; message: string }> }> {
  const result = await shopifyFetch<AdjustInventoryData>(
    ADJUST_INVENTORY_MUTATION,
    {
      input: {
        reason: "received",
        name: "available",
        changes: [
          {
            inventoryItemId,
            locationId,
            delta,
          },
        ],
      },
    }
  );

  return {
    userErrors:
      result?.data?.inventoryAdjustQuantities?.userErrors ?? [],
  };
}
