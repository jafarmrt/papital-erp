import { orm } from '../../db/drizzle.js';
import { terminateOpenWorkflows } from '../../services/workflow/workflowTermination.js';

/**
 * v11 phase 6.1p (C2, decision ت۵۲-۴): a sales draft or proforma recorded through `POST /api/documents` enters the approval
 * workflow, and its direct finalize waits for the inbox (409 `DOCUMENT_IN_WORKFLOW`). A test of the finalize itself
 * (stock, numbering, audit, events) closes the running workflow first, the state of a document without one.
 */
export async function closeDocumentWorkflow(documentId: number | string): Promise<number[]> {
  return orm.transaction(tx => terminateOpenWorkflows(tx, {
    entityType: 'document',
    entityId: documentId,
    actionKey: 'test_close',
    actionTitle: 'test close',
    comment: 'closed by the test before the direct finalize',
    userName: 'test',
  }));
}
