import { orm } from '../../db/drizzle';
import { 
  documents, 
  documentItems, 
  productionProjects, 
  pendingMaterials, 
  items, 
  customers, 
  crmLeads, 
  journalVouchers 
} from '../../db/schema';
import { eq } from 'drizzle-orm';
import { logger } from '../../middleware/logger';
import { RuleEngineService, RuleExpression, EvaluationTraceResult } from '../ruleEngine.service.js';

export interface WorkflowConditionRule {
  field: string;
  operator: string;
  value: any;
}

export interface WorkflowRuleGroup {
  matchType?: 'AND' | 'OR';
  logic?: 'AND' | 'OR' | 'NOT';
  rules?: (WorkflowConditionRule | WorkflowRuleGroup)[];
  conditions?: (WorkflowConditionRule | WorkflowRuleGroup)[];
}

export interface RuleEvaluationResult {
  rule: WorkflowConditionRule;
  passed: boolean;
  actualValue: any;
}

export class WorkflowRuleEngine {
  /**
   * Validate syntax of condition rules array or group using central RuleEngineService
   */
  static validateRuleSyntax(ruleGroup: WorkflowRuleGroup | WorkflowConditionRule[] | any): { valid: boolean; error?: string } {
    return RuleEngineService.validateExpression(ruleGroup);
  }

  /**
   * Evaluate conditions and return detailed breakdown for each rule
   */
  static evaluateRuleBreakdown(rulesInput: WorkflowRuleGroup | WorkflowConditionRule[] | any, context: Record<string, any>): {
    passed: boolean;
    matchType: 'AND' | 'OR';
    breakdown: RuleEvaluationResult[];
    trace?: EvaluationTraceResult;
  } {
    const trace = RuleEngineService.evaluateWithTrace(rulesInput, context);

    let matchType: 'AND' | 'OR' = 'AND';
    if (rulesInput && !Array.isArray(rulesInput) && typeof rulesInput === 'object') {
      const m = (rulesInput.matchType || rulesInput.logic || 'AND').toString().toUpperCase();
      matchType = m === 'OR' ? 'OR' : 'AND';
    }

    const breakdown: RuleEvaluationResult[] = [];
    
    // Extract flat breakdown items from trace
    if (trace.traceTree) {
      const extractRules = (node: any) => {
        if (!node) return;
        if (node.type === 'rule') {
          breakdown.push({
            rule: {
              field: node.field || '',
              operator: node.operator || 'eq',
              value: node.expectedValue
            },
            passed: node.passed,
            actualValue: node.actualValue
          });
        }
        if (node.children && Array.isArray(node.children)) {
          node.children.forEach(extractRules);
        }
      };
      extractRules(trace.traceTree);
    }

    return {
      passed: trace.passed,
      matchType,
      breakdown,
      trace
    };
  }

  /**
   * Evaluate JSON condition rules against entity context data
   */
  static evaluateConditions(rulesInput: WorkflowRuleGroup | WorkflowConditionRule[] | any, context: Record<string, any>): boolean {
    return RuleEngineService.evaluate(rulesInput, context);
  }
}

/**
 * Fetch context data for an entity to evaluate JSON conditions
 */
export async function getEntityContext(entityType: string, entityId: string, txExecutor: any = orm): Promise<Record<string, any>> {
  const context: Record<string, any> = { entityType, entityId };
  try {
    const numericId = Number(entityId) || 0;
    if (entityType === 'document' || entityType === 'doc' || entityType === 'invoice' || entityType === 'proforma') {
      let doc = null;
      if (numericId > 0) {
        [doc] = await txExecutor.select().from(documents).where(eq(documents.id, numericId));
      }
      if (!doc) {
        [doc] = await txExecutor.select().from(documents).where(eq(documents.refNumber, String(entityId)));
      }
      if (doc) {
        const itemsList = await txExecutor.select().from(documentItems).where(eq(documentItems.documentId, doc.id));
        const totalAmount = itemsList.reduce((acc: number, item: any) => acc + (Number(item.quantity || 0) * Number(item.unitPrice || 0) - Number(item.discount || 0)), 0);
        context.amount = totalAmount || Number(doc.totalAmount) || 0;
        context.finalAmount = totalAmount || Number(doc.totalAmount) || 0;
        context.totalAmount = totalAmount || Number(doc.totalAmount) || 0;
        context.itemCount = itemsList.length;
        context.docType = doc.type;
        context.type = doc.type;
        context.status = doc.status;
        context.buyerName = doc.buyerName || '';
        context.buyer_name = doc.buyerName || '';
        context.buyerCity = doc.buyerCity || '';
        context.buyer_city = doc.buyerCity || '';
        context.currency = doc.currency || 'IRR';
        context.refNumber = doc.refNumber || '';
        context.ref_number = doc.refNumber || '';
        context.createdById = doc.createdById;
        context.notes = doc.notes || '';
      }
    } else if (entityType === 'project') {
      const [proj] = await txExecutor.select().from(productionProjects).where(eq(productionProjects.id, numericId));
      if (proj) {
        context.priority = proj.priority || 'medium';
        context.quantity = Number(proj.quantity) || 1;
        context.status = proj.status;
        context.title = proj.title;
        context.projectCode = proj.projectCode || '';
      }
    } else if (entityType === 'pending_material') {
      const [mat] = await txExecutor.select().from(pendingMaterials).where(eq(pendingMaterials.id, numericId));
      if (mat) {
        context.weight = Number(mat.weight) || 0;
        context.unit = mat.unit;
        context.category = mat.category || '';
        context.status = mat.status;
        context.title = mat.title || '';
      }
    } else if (entityType === 'item') {
      const [item] = await txExecutor.select().from(items).where(eq(items.id, numericId));
      if (item) {
        context.code = item.code;
        context.name = item.name;
        context.category = item.category;
        context.currentStock = Number(item.currentStock) || 0;
        context.purchasePrice = Number(item.purchasePrice) || 0;
        context.salesPrice = Number(item.salesPrice) || 0;
      }
    } else if (entityType === 'customer') {
      const [cust] = await txExecutor.select().from(customers).where(eq(customers.id, numericId));
      if (cust) {
        context.code = cust.code;
        context.name = cust.name;
        context.type = cust.type;
        context.balance = Number(cust.balance) || 0;
      }
    } else if (entityType === 'crm_lead') {
      const [lead] = await txExecutor.select().from(crmLeads).where(eq(crmLeads.id, numericId));
      if (lead) {
        context.title = lead.title;
        context.status = lead.status;
        context.value = Number(lead.value) || 0;
        context.source = lead.source || '';
      }
    } else if (entityType === 'journal_voucher') {
      const [jv] = await txExecutor.select().from(journalVouchers).where(eq(journalVouchers.id, numericId));
      if (jv) {
        context.voucherNumber = jv.voucherNumber;
        context.status = jv.status;
        context.totalDebit = Number(jv.totalDebit) || 0;
        context.totalCredit = Number(jv.totalCredit) || 0;
        context.amount = Number(jv.totalDebit) || 0;
      }
    }
  } catch (err: any) {
    logger.warn(`[WorkflowDslParser] Entity context error for ${entityType} #${entityId}: ${err.message}`);
  }
  return context;
}
