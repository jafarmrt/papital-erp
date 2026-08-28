import { orm } from '../../db/drizzle.js';
import bcrypt from 'bcryptjs';
import {
  users,
  roles,
  customers,
  items,
  warehouses,
  documents,
  documentItems,
  journalVouchers,
  journalVoucherItems,
  workflowDefinitions,
  workflowStates,
  workflowTransitions,
  workflowInstances,
  accounts
} from '../../db/schema.js';
import { eq } from 'drizzle-orm';

/**
 * TST-008: Canonical test password & its real bcrypt hash so factory users can
 * actually authenticate through /api/auth/login (bcrypt.compare passes).
 */
export const TEST_PASSWORD = 'TestPass123!';
export const TEST_PASSWORD_HASH = bcrypt.hashSync(TEST_PASSWORD, 10);

/**
 * Unique ID / Suffix generator for non-colliding test fixtures
 */
function uniqueSuffix(): string {
  return `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
}

/**
 * User Factory
 */
export async function createTestUser(overrides: Partial<typeof users.$inferInsert> = {}, db: any = orm) {
  const suffix = uniqueSuffix();
  const userData = {
    username: overrides.username || `testuser_${suffix}`,
    password: overrides.password || TEST_PASSWORD_HASH,
    fullName: overrides.fullName || `کاربر آزمایشی ${suffix}`,
    role: overrides.role || 'admin',
    avatarUrl: overrides.avatarUrl || '',
    ...overrides
  };

  const [inserted] = await db.insert(users).values(userData).returning();
  return inserted;
}

/**
 * Role Factory
 */
export async function createTestRole(overrides: Partial<typeof roles.$inferInsert> = {}, db: any = orm) {
  const suffix = uniqueSuffix();
  const roleData = {
    name: overrides.name || `نقش آزمایشی ${suffix}`,
    code: overrides.code || `ROLE_${suffix}`,
    description: overrides.description || 'توضیحات نقش آزمایشی',
    permissions: overrides.permissions || ['workflow.view', 'workflow.execute', 'documents.manage'],
    isSystem: overrides.isSystem ?? 0,
    ...overrides
  };

  const [inserted] = await db.insert(roles).values(roleData).returning();
  return inserted;
}

/**
 * Customer / Party Factory
 */
export async function createTestCustomer(overrides: Partial<typeof customers.$inferInsert> = {}, db: any = orm) {
  const suffix = uniqueSuffix();
  const customerData = {
    name: overrides.name || `طرف حساب آزمایشی ${suffix}`,
    contactName: overrides.contactName || 'آقای آزمایشی',
    phone: overrides.phone || '09120000000',
    partyType: overrides.partyType || 'customer',
    version: overrides.version ?? 1,
    isDeleted: 0,
    ...overrides
  };

  const [inserted] = await db.insert(customers).values(customerData).returning();
  return inserted;
}

/**
 * Item / Inventory Product Factory
 */
export async function createTestItem(overrides: Partial<typeof items.$inferInsert> = {}, db: any = orm) {
  const suffix = uniqueSuffix();
  const itemData = {
    type: overrides.type || 'product',
    name: overrides.name || `کالای آزمایشی ${suffix}`,
    code: overrides.code || `ITEM_${suffix}`,
    unit: overrides.unit || 'عدد',
    category: overrides.category || 'دستبند',
    currentStock: overrides.currentStock ?? 100,
    weightedAverageCost: overrides.weightedAverageCost ?? 50000,
    reorderPoint: overrides.reorderPoint ?? 10,
    stocks: overrides.stocks || { main: overrides.currentStock ?? 100 },
    version: overrides.version ?? 1,
    isDeleted: 0,
    ...overrides
  };

  const [inserted] = await db.insert(items).values(itemData).returning();
  return inserted;
}

/**
 * Warehouse / Location Factory
 */
export async function createTestWarehouse(overrides: Partial<typeof warehouses.$inferInsert> = {}, db: any = orm) {
  const suffix = uniqueSuffix();
  const warehouseData = {
    name: overrides.name || `انبار آزمایشی ${suffix}`,
    code: overrides.code || `WH_${suffix}`,
    isActive: overrides.isActive ?? 1,
    ...overrides
  };

  const [inserted] = await db.insert(warehouses).values(warehouseData).returning();
  return inserted;
}

/**
 * Document (Invoice / Purchase / Warehouse) Factory
 */
export async function createTestDocument(
  docOverrides: Partial<typeof documents.$inferInsert> = {},
  itemsList: Array<{ itemId: number; quantity: number; unitPrice: number; location?: string }> = [],
  db: any = orm
) {
  const suffix = uniqueSuffix();
  const docData = {
    type: docOverrides.type || 'invoice',
    refNumber: docOverrides.refNumber || `DOC_${suffix}`,
    date: docOverrides.date || new Date().toISOString().split('T')[0],
    user: docOverrides.user || 'admin',
    status: docOverrides.status || 'final',
    buyerName: docOverrides.buyerName || 'خریدار آزمایشی',
    version: docOverrides.version ?? 1,
    isDeleted: 0,
    ...docOverrides
  };

  const [insertedDoc] = await db.insert(documents).values(docData).returning();

  const insertedItems = [];
  if (itemsList.length > 0) {
    for (const item of itemsList) {
      const [itemRow] = await db
        .insert(documentItems)
        .values({
          documentId: insertedDoc.id,
          itemId: item.itemId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          discount: 0,
          location: item.location || 'main'
        })
        .returning();
      insertedItems.push(itemRow);
    }
  }

  return { document: insertedDoc, items: insertedItems };
}

/**
 * Accounting Journal Voucher Factory
 */
export async function createTestVoucher(
  voucherOverrides: Partial<typeof journalVouchers.$inferInsert> = {},
  itemsList: Array<{ accountId: number; debit: number; credit: number; description?: string }> = [],
  db: any = orm
) {
  const suffix = uniqueSuffix();
  
  // Calculate totals if items provided
  const totalDebit = itemsList.reduce((sum, i) => sum + (i.debit || 0), 0);
  const totalCredit = itemsList.reduce((sum, i) => sum + (i.credit || 0), 0);

  const voucherData = {
    voucherNumber: voucherOverrides.voucherNumber || Math.floor(Math.random() * 900000) + 100000,
    date: voucherOverrides.date || new Date().toISOString().split('T')[0],
    voucherType: voucherOverrides.voucherType || 'general',
    status: voucherOverrides.status || 'approved',
    totalDebit: voucherOverrides.totalDebit ?? totalDebit,
    totalCredit: voucherOverrides.totalCredit ?? totalCredit,
    description: voucherOverrides.description || `سند حسابداری آزمایشی ${suffix}`,
    version: voucherOverrides.version ?? 1,
    isDeleted: 0,
    ...voucherOverrides
  };

  const [insertedVoucher] = await db.insert(journalVouchers).values(voucherData).returning();

  const insertedItems = [];
  if (itemsList.length > 0) {
    for (let idx = 0; idx < itemsList.length; idx++) {
      const item = itemsList[idx];
      const [itemRow] = await db
        .insert(journalVoucherItems)
        .values({
          voucherId: insertedVoucher.id,
          accountId: item.accountId,
          rowOrder: idx + 1,
          debit: item.debit || 0,
          credit: item.credit || 0,
          description: item.description || 'سطر سند آزمایشی'
        })
        .returning();
      insertedItems.push(itemRow);
    }
  }

  return { voucher: insertedVoucher, items: insertedItems };
}

/**
 * Workflow Definition & Instance Factory
 */
export async function createTestWorkflow(overrides: {
  definition?: Partial<typeof workflowDefinitions.$inferInsert>;
  states?: Array<{ key: string; title: string; type?: string }>;
  transitions?: Array<{ fromKey: string; toKey: string; actionKey: string; title: string }>;
} = {}, db: any = orm) {
  const suffix = uniqueSuffix();
  const defData = {
    code: overrides.definition?.code || `WF_${suffix}`,
    title: overrides.definition?.title || `گردش کار آزمایشی ${suffix}`,
    entityType: overrides.definition?.entityType || 'document',
    version: overrides.definition?.version ?? 1,
    isActive: 1,
    ...overrides.definition
  };

  const [insertedDef] = await db.insert(workflowDefinitions).values(defData).returning();

  // Create default states if not provided
  const stateDefs = overrides.states || [
    { key: 'draft', title: 'پیش‌نویس', type: 'initial' },
    { key: 'review', title: 'در حال بررسی', type: 'intermediate' },
    { key: 'approved', title: 'تایید شده', type: 'terminal' }
  ];

  const stateMap: Record<string, typeof workflowStates.$inferSelect> = {};
  for (let idx = 0; idx < stateDefs.length; idx++) {
    const s = stateDefs[idx];
    const [st] = await db
      .insert(workflowStates)
      .values({
        workflowDefinitionId: insertedDef.id,
        stateKey: s.key,
        title: s.title,
        stateType: s.type || 'intermediate',
        stepOrder: idx + 1
      })
      .returning();
    stateMap[s.key] = st;
  }

  // Create transitions if provided
  const transDefs = overrides.transitions || [
    { fromKey: 'draft', toKey: 'review', actionKey: 'submit', title: 'ارسال جهت بررسی' },
    { fromKey: 'review', toKey: 'approved', actionKey: 'approve', title: 'تایید نهایی' }
  ];

  const createdTransitions = [];
  for (const tr of transDefs) {
    if (stateMap[tr.fromKey] && stateMap[tr.toKey]) {
      const [trans] = await db
        .insert(workflowTransitions)
        .values({
          workflowDefinitionId: insertedDef.id,
          fromStateId: stateMap[tr.fromKey].id,
          toStateId: stateMap[tr.toKey].id,
          actionKey: tr.actionKey,
          title: tr.title,
          approvalRuleType: 'SINGLE'
        })
        .returning();
      createdTransitions.push(trans);
    }
  }

  return {
    definition: insertedDef,
    states: stateMap,
    transitions: createdTransitions
  };
}

/**
 * Creates a Workflow Instance linked to a Workflow Definition
 */
export async function createTestWorkflowInstance(
  definitionId: number,
  initialStateId: number,
  entityType = 'document',
  entityId = '1'
) {
  const [instance] = await orm
    .insert(workflowInstances)
    .values({
      workflowDefinitionId: definitionId,
      definitionVersion: 1,
      entityType,
      entityId,
      currentStateId: initialStateId,
      status: 'IN_PROGRESS',
      version: 1
    })
    .returning();

  return instance;
}
