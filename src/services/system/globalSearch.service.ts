import { eq, and, or, asc, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { items, customers, documents, productionProjects } from '../../db/schema.js';
import { containsLikePattern, startsWithLikePattern } from '../../lib/sqlLike.js';
import { normalizeSearchText } from '../../lib/search/searchText.js';
import { foldedSearchSql } from '../../lib/search/searchSql.js';
import { logger } from '../../middleware/logger.js';
import { phoneMatchKeySql, phoneSearchKey } from '../../lib/search/phoneMatchKey.js';

/**
 * جستجوی سراسری چندبخشی (GET /global-search).
 * v7.0.53 (audit P2-10): هر بخش فقط وقتی جستجو می‌شود که کاربر مجوز مشاهده همان بخش را داشته باشد
 * (بررسی مجوز در روت انجام می‌شود و این‌جا فقط پرچم آن می‌رسد)؛ بخش بدون مجوز خالی است، نه خطا.
 * نویسه‌های % و _ ورودی escape می‌شوند. v11 phase 6.3p (C12): بخشی که خطا بدهد در `failedSections` نام برده می‌شود.
 * v9.0.291 (TD-675، B16-11): متن ستون و متن جست‌وجو هر دو با `normalizeSearchText` یکسان می‌شوند (ي/ك/ى عربی و ارقام فارسی
 * و عربی)، و نتیجه به ترتیب «برابر، سپس آغاز با، سپس شامل» و بعد کوتاه‌ترین نام می‌آید. پیش‌تر بی ترتیب بود، پس با پنج نام
 * «علی …» خودِ «علی» در پنج نتیجه نمی‌آمد و «كيان» عربی «کیان» را نمی‌یافت.
 */

/** ستون یکسان‌شده برای مقایسه، همان `normalizeSearchText` در SQL */
function folded(column: AnyColumn): SQL {
  return foldedSearchSql(column);
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

export type GlobalSearchSection = keyof GlobalSearchScope;

export interface GlobalSearchResult {
  items: GlobalSearchItem[];
  customers: GlobalSearchCustomer[];
  documents: GlobalSearchDocument[];
  projects: GlobalSearchProject[];
  /**
   * v11 phase 6.3p (C12): the sections whose query failed. Before, a failed section was only logged and came back empty,
   * so the user read «nothing found» where the search had not run.
   */
  failedSections: GlobalSearchSection[];
}

/** one section: a section without permission is empty, a failed one is logged and named in `failedSections` */
async function runSection<T>(
  section: GlobalSearchSection, allowed: boolean, failed: GlobalSearchSection[], read: () => Promise<T[]>,
): Promise<T[]> {
  if (!allowed) return [];
  try {
    return await read();
  } catch (e) {
    logger.error({ message: `Global search section ${section} failed`, error: e });
    failed.push(section);
    return [];
  }
}

export class GlobalSearchService {
  /**
   * `q` is the trimmed, non-empty search text. v11 phase 6.3p (C12): the four sections run at the same time; before, each
   * waited for the one before it, so the answer took the sum of their times.
   */
  static async search(q: string, scope: GlobalSearchScope): Promise<GlobalSearchResult> {
    const query = normalizeSearchText(q);
    const searchTerm = containsLikePattern(query);
    // OBS-R2-99: a phone-like text also matches the TD-296 phone key
    const phoneKey = phoneSearchKey(q.trim());
    const customerMatch = matchesAny([customers.name, customers.city, customers.province, customers.phone], searchTerm);
    const failedSections: GlobalSearchSection[] = [];

    const [matchingItems, matchingCustomers, matchingDocuments, matchingProjects] = await Promise.all([
      // 1. Products & Raw Materials
      runSection<GlobalSearchItem>('items', scope.items, failedSections, () => orm.select({
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
        .where(and(eq(items.isDeleted, 0), matchesAny([items.name, items.code, items.category, items.material, items.color], searchTerm)))
        .orderBy(matchRank([items.name, items.code], query), sql`length(${items.name})`, asc(items.id))
        .limit(10)),
      // 2. Customers
      runSection<GlobalSearchCustomer>('customers', scope.customers, failedSections, () => orm.select({
        id: customers.id,
        name: customers.name,
        city: customers.city,
        province: customers.province,
        address: customers.address
      })
        .from(customers)
        .where(and(
          eq(customers.isDeleted, 0),
          phoneKey ? or(customerMatch, sql`${phoneMatchKeySql(customers.phone)} LIKE ${containsLikePattern(phoneKey)}`) : customerMatch,
        ))
        .orderBy(matchRank([customers.name], query), sql`length(${customers.name})`, asc(customers.id))
        .limit(5)),
      // 3. Documents & Invoices
      runSection<GlobalSearchDocument>('documents', scope.documents, failedSections, () => orm.select({
        id: documents.id,
        ref_number: documents.refNumber,
        buyer_name: documents.buyerName,
        type: documents.type,
        date: documents.date
      })
        .from(documents)
        .where(and(eq(documents.isDeleted, 0), matchesAny([documents.refNumber, documents.buyerName, documents.notes], searchTerm)))
        .orderBy(matchRank([documents.refNumber, documents.buyerName], query), sql`${documents.date} DESC`, asc(documents.id))
        .limit(5)),
      // 4. Projects
      runSection<GlobalSearchProject>('projects', scope.projects, failedSections, () => orm.select({
        id: productionProjects.id,
        project_code: productionProjects.projectCode,
        title: productionProjects.title,
        status: productionProjects.status,
        customer_name: productionProjects.customerName
      })
        .from(productionProjects)
        .where(and(
          eq(productionProjects.isDeleted, 0),
          matchesAny([productionProjects.title, productionProjects.projectCode, productionProjects.customerName], searchTerm),
        ))
        .orderBy(matchRank([productionProjects.projectCode, productionProjects.title], query), sql`length(${productionProjects.title})`, asc(productionProjects.id))
        .limit(5)),
    ]);

    return {
      items: matchingItems,
      customers: matchingCustomers,
      documents: matchingDocuments,
      projects: matchingProjects,
      failedSections,
    };
  }
}
