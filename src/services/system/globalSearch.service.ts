import { eq, and, or, ilike } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { items, customers, documents, productionProjects } from '../../db/schema.js';
import { containsLikePattern } from '../../lib/sqlLike.js';
import { logger } from '../../middleware/logger.js';

/**
 * جستجوی سراسری چندبخشی (GET /global-search).
 * v7.0.53 (audit P2-10): هر بخش فقط وقتی جستجو می‌شود که کاربر مجوز مشاهده همان بخش را داشته باشد
 * (بررسی مجوز در روت انجام می‌شود و این‌جا فقط پرچم آن می‌رسد)؛ بخش بدون مجوز خالی است، نه خطا.
 * خطای هر بخش فقط لاگ می‌شود و آن بخش خالی برمی‌گردد. نویسه‌های % و _ ورودی escape می‌شوند.
 */

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
    const searchTerm = containsLikePattern(q);

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
            or(
              ilike(items.name, searchTerm),
              ilike(items.code, searchTerm),
              ilike(items.category, searchTerm),
              ilike(items.material, searchTerm),
              ilike(items.color, searchTerm)
            )
          )
        )
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
            or(
              ilike(customers.name, searchTerm),
              ilike(customers.city, searchTerm),
              ilike(customers.province, searchTerm),
              ilike(customers.phone, searchTerm)
            )
          )
        )
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
            or(
              ilike(documents.refNumber, searchTerm),
              ilike(documents.buyerName, searchTerm),
              ilike(documents.notes, searchTerm)
            )
          )
        )
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
            or(
              ilike(productionProjects.title, searchTerm),
              ilike(productionProjects.projectCode, searchTerm),
              ilike(productionProjects.customerName, searchTerm)
            )
          )
        )
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
