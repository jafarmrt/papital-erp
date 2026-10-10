import type { DbExecutor } from '../db/drizzle.js';
import type { DecimalValue } from '../lib/financialDecimal.js';
import { documentAuditSnapshot, documentLineSummary, type DocumentAuditChange, type DocumentVoidAudit } from './documents/documentAudit.js';
import type { StockReversalResult } from './documents/documentStockEngine.service.js';
import { 
  DocumentRefNumberService, 
  DocumentStockEngine, 
  DocumentCreationService, 
  DocumentLifecycleService, 
  DocumentQueryService 
} from './documents/index.js';
import type { 
  DbClient, 
  GetDocumentsFilter, 
  DocumentLineItemInput, 
  CreateDocumentInput, 
  UpdateDocumentInput, 
  FormattedDocumentItem, 
  FormattedDocument, 
  PaginatedDocumentsResult 
} from './documents/types.js';

export type {
  DbClient,
  GetDocumentsFilter,
  DocumentLineItemInput,
  CreateDocumentInput,
  UpdateDocumentInput,
  FormattedDocumentItem,
  FormattedDocument,
  PaginatedDocumentsResult
};

export {
  DocumentRefNumberService,
  DocumentStockEngine,
  DocumentCreationService,
  DocumentLifecycleService,
  DocumentQueryService
};

/**
 * Unified Facade for Document operations.
 * Binds and delegates to specialized sub-services:
 * - DocumentRefNumberService: Atomic reference numbering and peeking
 * - DocumentStockEngine: Inventory stock movements, reversals, and ledger reconciliation
 * - DocumentCreationService: Creation, updating, and note management
 * - DocumentLifecycleService: Strict 4-step finalization and cascade soft-deletion
 * - DocumentQueryService: Document retrieval, pagination, and settlement calculation
 */
export class DocumentService {
  /**
   * Updates the notes of a specific document.
   */
  static async updateDocumentNotes(id: number, notes: string, externalTx?: DbExecutor): Promise<DocumentAuditChange> {
    return DocumentCreationService.updateDocumentNotes(id, notes, externalTx);
  }

  /**
   * Updates an existing document (proforma or draft) and its line items.
   */
  static async updateDocument(id: number, body: UpdateDocumentInput, externalTx?: DbExecutor): Promise<DocumentAuditChange> {
    return DocumentCreationService.updateDocument(id, body, externalTx);
  }

  /**
   * Peeks the next reference number for a document type WITHOUT incrementing any counter.
   */
  static async peekNextRef(type: string, dateOrFiscalYear?: string | number): Promise<string> {
    return DocumentRefNumberService.peekNextRef(type, dateOrFiscalYear);
  }

  /**
   * Calculates the next reference number for a given document type using the atomic document_ref_counters table.
   */
  static async getNextRef(type: string, dateOrFiscalYear?: string | number, externalTx?: DbClient): Promise<string> {
    return DocumentRefNumberService.getNextRef(type, dateOrFiscalYear, externalTx);
  }

  /**
   * Creates a new document and applies associated inventory changes.
   */
  static async createDocument(body: CreateDocumentInput): Promise<number> {
    return DocumentCreationService.createDocument(body);
  }

  /**
   * Same as createDocument, plus the project reservation released in the same transaction (v7.0.102, TD-233).
   */
  static async createDocumentWithDetails(
    body: CreateDocumentInput,
    actor?: { userId?: number; allowBackdate?: boolean }
  ): ReturnType<typeof DocumentCreationService.createDocumentWithDetails> {
    return DocumentCreationService.createDocumentWithDetails(body, actor);
  }

  /**
   * Retrieves a list of documents, optionally filtered by type, status, date range, search query, and pagination.
   */
  static async getDocuments(
    typeOrFilter?: string | GetDocumentsFilter
  ): Promise<FormattedDocument[] | PaginatedDocumentsResult> {
    return DocumentQueryService.getDocuments(typeOrFilter);
  }

  /** v10.0.41 (TD-929): the stored document for an audit row of another package (WooCommerce invoice) */
  static documentAuditSnapshot = documentAuditSnapshot;
  static documentLineSummary = documentLineSummary;

  /**
   * Retrieves a document by its ID, with its associated items.
   */
  static async getDocumentById(id: number): Promise<FormattedDocument | null> {
    return DocumentQueryService.getDocumentById(id);
  }

  /**
   * Retrieves detailed invoice settlement status with payment breakdown.
   */
  static async getInvoiceSettlementStatus(documentId: number) {
    return DocumentQueryService.getInvoiceSettlementStatus(documentId);
  }

  /**
   * Applies stock movement for a single document item (creates transaction and updates item stocks/WAC).
   */
  static async applyStockMovement(
    tx: DbClient,
    params: {
      itemId: number;
      documentId?: number | null;
      inOut: 'in' | 'out';
      quantity: number;
      price: DecimalValue;
      date: string;
      documentType: string;
      documentRef: string;
      user: string;
      targetLoc: string;
      notes?: string;
    }
  ): Promise<{ transactionId: number }> {
    return DocumentStockEngine.applyStockMovement(tx, params);
  }

  /**
   * Centrally reverts inventory movements for document void/deletion (DB-009).
   */
  static async applyStockReversal(
    tx: DbClient,
    params: {
      itemId: number;
      quantity: number;
      originalDirection: 'in' | 'out';
      unitPrice: number;
      location: string;
    }
  ): Promise<StockReversalResult> {
    return DocumentStockEngine.applyStockReversal(tx, params);
  }

  /**
   * Finalizes a draft or proforma document in a strict 4-step atomic orchestration.
   */
  static async finalizeDocument(
    id: number,
    user?: string,
    externalTx?: DbExecutor,
    options?: { strict?: boolean; vatAmount?: number; vatPercent?: number; exchangeRate?: number; allowBackdate?: boolean }
  ): Promise<DocumentAuditChange | null> {
    return DocumentLifecycleService.finalizeDocument(id, user, externalTx, options);
  }

  /**
   * Soft deletes a document and performs a cascade soft-delete on associated documentItems and transactions.
   */
  static async deleteDocument(id: number, user?: string, externalTx?: DbExecutor, audit?: DocumentVoidAudit): Promise<void> {
    return DocumentLifecycleService.deleteDocument(id, user, externalTx, audit);
  }

  /**
   * Reconciles and rebuilds inventory stocks directly from the transaction ledger (Event Sourcing).
   */
  static async reconcileAndRebuildStock(targetItemId?: number): Promise<{
    reconciledCount: number;
    discrepanciesFixed: number;
  }> {
    return DocumentStockEngine.reconcileAndRebuildStock(targetItemId);
  }
}
