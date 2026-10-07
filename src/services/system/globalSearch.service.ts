import { eq, and, or, asc, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { items, customers, documents, productionProjects } from '../../db/schema.js';
import { containsLikePattern, startsWithLikePattern } from '../../lib/sqlLike.js';
import { normalizeSearchText, SEARCH_FOLD_FROM, SEARCH_FOLD_TO } from '../../lib/search/searchText.js';
import { logger } from '../../middleware/logger.js';

/**
 * جستجوی سراسری چندبخشی (GET /global-search).
 * v7.0.53 (audit P2-10): هر بخش فقط وقتی جستجو می‌شود که کاربر مجوز مشاهده همان بخش را داشته باشد
 * (بررسی مجوز در روت انجام می‌شود و این‌جا فقط پرچم آن می‌رسد)؛ بخش بدون مجوز خالی است، نه خطا.
 * خطای هر بخش فقط لاگ می‌شود و آن بخش خالی برمی‌گردد. نویسه‌های % و _ ورودی escape می‌شوند.
 * v9.0.281 (TD-675، B16-11): متن ستون و متن جست‌وجو هر دو با `normalizeSearchText` یکسان می‌شوند (ي/ك/ى عربی و ارقام فارسی
 * و عربی)، و نتیجه به ترتیب «برابر، سپس آغاز با، سپس شامل» و بعد کوتاه‌ترین نام می‌آید. پیش‌تر بی ترتیب بود، پس با پنج نام
 * «علی …» خودِ «علی» در پنج نتیجه نمی‌آمد و «كيان» عربی «کیان» را نمی‌یافت.
 */

/** ستون یکسان‌شده برای مقایسه، همان `normalizeSearchText` در SQL */
function folded(column: AnyColumn): SQL {
  return sql`translate(lower(coalesce(${column}, '')), ${SEARCH_FOLD_FROM}, ${SEARCH_FOLD_TO})`;
}

function matchesAny(columns: AnyColumn[], pattern: string): SQL {
  return or(...columns.map(column => sql`${folded(column)} LIKE ${pattern}`)) as SQL;
}

/** ۰ برابر، ۱ آغاز با، ۲ شامل؛ روی ستون‌های اصلی هر بخش */
function matchRank(columns: AnyColumn[], q: string): SQL {
  const starts = startsWithLikePattern(q);
  return sql`CASE WHEN ${or(...columns.map(column => sql`${folded(column)} = ${q}`))} THEN 0
    WHEN ${matchesAny(columns, starts)} THEN 1 ELSE 2 END`;
}

export interface GlobalSearchScope {
  items: boolean;
  customers: boolean;
  documents: boolean;
  projects: boolean;
}

export interface GlobalSearchItem {
  id: number;
  name: string;
  code: string;
  type: string;
  category: string | null;
  unit: string | null;
  currentStock: number | null;
  thumbnail: string | null;
}

export interface GlobalSearchCustomer {
  id: number;
  name: string;
  city: string | null;
  province: string | null;
  address: string | null;
}

export interface GlobalSearchDocument {
  id: number;
  ref_number: string;
  buyer_name: string | null;
  type: string;
  date: string;
}

export interface GlobalSearchProject {
  id: number;
  project_code: string;
  title: string;
  status: string | null;
  customer_name: string | null;
}

export interface GlobalSearchResult {
  items: GlobalSearchItem[];
  customers: GlobalSearchCustomer[];
  documents: GlobalSearchDocument[];
  projects: GlobalSearchProject[];
}

export class GlobalSearchService {
  /** `q` is the trimmed, non-empty search text. */
  static async search(q: string, scope: GlobalSearchScope): Promise<GlobalSearchResult> {
    const query = normalizeSearchText(q);
    const searchTerm = containsLikePattern(query);

    // 1. Products & Raw Materials
    let matchingItems: GlobalSearchItem[] = [];
    if (scope.items) {
      try {
        matchingItems = await orm.select({
          id: items.id,
          name: items.name,
          code: items.code,
          type: items.type,
          category: items.category,
          unit: items.unit,
          currentStock: items.currentStock,
          thumbnail: items.thumbnail
        })
        .from(items)
        .where(
          and(
            eq(items.isDeleted, 0),
            matchesAny([items.name, items.code, items.category, items.material, items.color], searchTerm)
          )
        )
        .orderBy(matchRank([items.name, items.code], query), sql`length(${items.name})`, asc(items.id))
        .limit(10);
      } catch (e) {
        logger.error({ message: 'Error fetching search items', error: e });
      }
    }

    // 2. Customers
    let matchingCustomers: GlobalSearchCustomer[] = [];
    if (scope.customers) {
      try {
        matchingCustomers = await orm.select({
          id: customers.id,
          name: customers.name,
          city: customers.city,
          province: customers.province,
          address: customers.address
        })
        .from(customers)
        .where(
          and(
            eq(customers.isDeleted, 0),
            matchesAny([customers.name, customers.city, customers.province, customers.phone], searchTerm)
          )
        )
        .orderBy(matchRank([customers.name], query), sql`length(${customers.name})`, asc(customers.id))
        .limit(5);
      } catch (e) {
        logger.error({ message: 'Error fetching search customers', error: e });
      }
    }

    // 3. Documents & Invoices
    let matchingDocuments: GlobalSearchDocument[] = [];
    if (scope.documents) {
      try {
        matchingDocuments = await orm.select({
          id: documents.id,
          ref_number: documents.refNumber,
          buyer_name: documents.buyerName,
          type: documents.type,
          date: documents.date
        })
        .from(documents)
        .where(
          and(
            eq(documents.isDeleted, 0),
            matchesAny([documents.refNumber, documents.buyerName, documents.notes], searchTerm)
          )
        )
        .orderBy(matchRank([documents.refNumber, documents.buyerName], query), sql`${documents.date} DESC`, asc(documents.id))
        .limit(5);
      } catch (e) {
        logger.error({ message: 'Error fetching search documents', error: e });
      }
    }

    // 4. Projects
    let matchingProjects: GlobalSearchProject[] = [];
    if (scope.projects) {
      try {
        matchingProjects = await orm.select({
          id: productionProjects.id,
          project_code: productionProjects.projectCode,
          title: productionProjects.title,
          status: productionProjects.status,
          customer_name: productionProjects.customerName
        })
        .from(productionProjects)
        .where(
          and(
            eq(productionProjects.isDeleted, 0),
            matchesAny([productionProjects.title, productionProjects.projectCode, productionProjects.customerName], searchTerm)
          )
        )
        .orderBy(matchRank([productionProjects.projectCode, productionProjects.title], query), sql`length(${productionProjects.title})`, asc(productionProjects.id))
        .limit(5);
      } catch (e) {
        logger.error({ message: 'Error fetching search projects', error: e });
      }
    }

    return {
      items: matchingItems,
      customers: matchingCustomers,
      documents: matchingDocuments,
      projects: matchingProjects
    };
  }
}
