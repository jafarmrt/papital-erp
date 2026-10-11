import { and, eq, inArray, sql, SQL } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { items, transfers } from '../../db/schema.js';
import { containsLikePattern } from '../../lib/sqlLike.js';
import {
  TRANSFER_CODE_PAGE_SIZE, TransferCodeListFilters, TransferCodePage,
} from '../../lib/transfers/transferCodeList.js';

/**
 * v10.0.182 (OBS-R1-82): فهرست کدهای ترنسفر در پایگاه‌داده. پیش‌تر `GET /transfers` همه طرح‌ها و همه کالاهای محصول را
 * می‌خواند و جست‌وجو، مرتب‌سازی و صفحه‌بندی را در حافظه انجام می‌داد؛ اکنون یک صفحه از کدها و فقط کالاهای همان صفحه
 * خوانده می‌شود. کد ترنسفر یک کالا بخش سوم کد آن است (`1403-B-003-01` → `003`)، همان قاعده `extractTransferCode`.
 */

/** بخش سوم کد کالا (بی فاصله‌های دو سو)؛ کالای بی آن کد ترنسفر ندارد */
export const itemTransferCodeSql = sql<string>`btrim(split_part(${items.code}, '-', 3))`;

const liveProduct = and(eq(items.type, 'product'), eq(items.isDeleted, 0));

export const TRANSFER_PRODUCT_FIELDS = {
  id: items.id,
  name: items.name,
  code: items.code,
  type: items.type,
  category: items.category,
  unit: items.unit,
  currentStock: items.currentStock,
  image: items.image,
  thumbnail: items.thumbnail,
  weightedAverageCost: items.weightedAverageCost,
  color: items.color,
  weight: items.weight,
  material: items.material,
  size: items.size,
};

export type TransferProduct = Awaited<ReturnType<typeof productsOfCodes>>[number];

export interface TransferCodeRow {
  id: number | null;
  code: string;
  title: string;
  image: string;
  thumbnail: string;
  notes: string;
  createdAt: string | null;
  updatedAt: string | null;
  productCount: number;
  products: TransferProduct[];
}

interface CodeSqlRow extends Record<string, unknown> {
  id: number | null;
  code: string;
  title: string | null;
  image: string | null;
  thumbnail: string | null;
  notes: string | null;
  created_at: string | null;
  updated_at: string | null;
  product_count: number;
}

const rowsOf = <T>(res: { rows?: unknown[] }): T[] => (Array.isArray(res.rows) ? (res.rows as T[]) : []);

/** کالاهای محصول زنده‌ای که کد ترنسفرشان یکی از این کدهاست، به ترتیب کد کالا */
export async function productsOfCodes(codes: string[]) {
  if (codes.length === 0) return [];
  return orm.select({ ...TRANSFER_PRODUCT_FIELDS, transferCode: itemTransferCodeSql })
    .from(items)
    .where(and(liveProduct, inArray(itemTransferCodeSql, codes)))
    .orderBy(items.code);
}

/** همه کدها: طرح ذخیره‌شده زنده یا کدی که در کد کالای محصول زنده آمده، با شمار کالاها */
const codesCte = sql`
  product_codes AS (
    SELECT ${itemTransferCodeSql} AS code, count(*)::int AS product_count
    FROM ${items}
    WHERE ${liveProduct} AND ${itemTransferCodeSql} <> ''
    GROUP BY 1
  ),
  codes AS (
    SELECT coalesce(s.code, p.code) AS code, s.id, s.title, s.image, s.thumbnail, s.notes,
           s.created_at, s.updated_at, coalesce(p.product_count, 0)::int AS product_count
    FROM (SELECT * FROM ${transfers} WHERE ${transfers.isDeleted} = 0) s
    FULL OUTER JOIN product_codes p ON p.code = s.code
  )`;

function toRow(r: CodeSqlRow, products: TransferProduct[]): TransferCodeRow {
  return {
    id: r.id ?? null,
    code: r.code,
    title: r.title || `ترنسفر کد ${r.code}`,
    image: r.image || '',
    thumbnail: r.thumbnail || '',
    notes: r.notes || '',
    createdAt: r.created_at ?? null,
    updatedAt: r.updated_at ?? null,
    productCount: Number(r.product_count) || 0,
    products,
  };
}

export async function listTransferCodes(filters: TransferCodeListFilters): Promise<TransferCodePage<TransferCodeRow>> {
  const page = Math.max(1, filters.page ?? 1);
  const limit = filters.limit ?? TRANSFER_CODE_PAGE_SIZE;
  const conditions: SQL[] = [];
  const search = (filters.search ?? '').trim();
  if (search) {
    const pattern = containsLikePattern(search);
    // عنوان پیش‌فرض «ترنسفر کد …» هم جست‌وجو می‌شود، و نام و کد کالاهای متصل، مانند پالایش پیشین صفحه
    conditions.push(sql`(
      c.code ILIKE ${pattern}
      OR coalesce(nullif(c.title, ''), 'ترنسفر کد ' || c.code) ILIKE ${pattern}
      OR coalesce(c.notes, '') ILIKE ${pattern}
      OR EXISTS (
        SELECT 1 FROM ${items}
        WHERE ${liveProduct} AND ${itemTransferCodeSql} = c.code
          AND (${items.name} ILIKE ${pattern} OR ${items.code} ILIKE ${pattern})
      )
    )`);
  }
  if (filters.image === 'with_image') conditions.push(sql`coalesce(c.image, '') <> ''`);
  if (filters.image === 'without_image') conditions.push(sql`coalesce(c.image, '') = ''`);
  const where = conditions.length > 0 ? sql`WHERE ${sql.join(conditions, sql` AND `)}` : sql``;

  const [pageRes, countRes, summaryRes] = await Promise.all([
    orm.execute(sql`WITH ${codesCte}
      SELECT c.* FROM codes c ${where}
      ORDER BY nullif(regexp_replace(c.code, '[^0-9]', '', 'g'), '')::numeric NULLS LAST, lower(c.code), c.code
      LIMIT ${limit} OFFSET ${(page - 1) * limit}`),
    orm.execute(sql`WITH ${codesCte} SELECT count(*)::int AS total FROM codes c ${where}`),
    orm.execute(sql`WITH ${codesCte}
      SELECT count(*)::int AS total_codes,
             count(*) FILTER (WHERE coalesce(c.image, '') <> '')::int AS with_image,
             coalesce(sum(c.product_count), 0)::int AS linked_products
      FROM codes c`),
  ]);
  const codeRows = rowsOf<CodeSqlRow>(pageRes);
  const products = await productsOfCodes(codeRows.map(r => r.code));
  const byCode = new Map<string, TransferProduct[]>();
  for (const p of products) {
    const list = byCode.get(p.transferCode) ?? [];
    list.push(p);
    byCode.set(p.transferCode, list);
  }
  const total = Number(rowsOf<{ total: number }>(countRes)[0]?.total) || 0;
  const summary = rowsOf<{ total_codes: number; with_image: number; linked_products: number }>(summaryRes)[0];
  return {
    data: codeRows.map(r => toRow(r, byCode.get(r.code) ?? [])),
    total,
    page,
    limit,
    totalPages: Math.max(1, Math.ceil(total / limit)),
    summary: {
      totalCodes: Number(summary?.total_codes) || 0,
      withImage: Number(summary?.with_image) || 0,
      linkedProducts: Number(summary?.linked_products) || 0,
    },
  };
}

/** یک کد با کالاهایش؛ null وقتی نه طرح زنده‌ای دارد و نه کالایی آن را در کدش دارد (TD-493) */
export async function getTransferCode(code: string): Promise<TransferCodeRow | null> {
  const [saved] = await orm.select().from(transfers)
    .where(and(eq(transfers.code, code), eq(transfers.isDeleted, 0))).limit(1);
  const products = await productsOfCodes([code]);
  if (!saved && products.length === 0) return null;
  return toRow({
    id: saved?.id ?? null,
    code,
    title: saved?.title ?? null,
    image: saved?.image ?? null,
    thumbnail: saved?.thumbnail ?? null,
    notes: saved?.notes ?? null,
    created_at: saved?.createdAt ?? null,
    updated_at: saved?.updatedAt ?? null,
    product_count: products.length,
  }, products);
}
