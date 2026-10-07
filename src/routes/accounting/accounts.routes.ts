/**
 * مسیرهای کدینگ حساب‌ها و نگاشت مفهومی سرفصل‌ها (ChartOfAccountsService / AccountMappingService، AGENTS.md §11).
 * authenticateToken در src/routes/accounting.routes.ts پیش از این روتر اعمال می‌شود.
 */
import { Router } from 'express';
import type { z } from 'zod';
import { authorizePermission, requireSystemAdmin } from '../../middleware/authorize.js';
import { AccountingService } from '../../services/accounting.service.js';
import { AccountMappingService } from '../../services/accounting/accountMapping.service.js';
import { logActivity, extractClientIp } from '../../lib/auditLogger.js';
import { validate, paramsIdSchema } from '../../middleware/validate.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { createAccountSchema, updateAccountSchema, saveAccountMappingsSchema } from './accounting.schemas.js';

const router = Router();

// ==========================================
// 2. CHART OF ACCOUNTS (کدینگ حساب‌ها)
// ==========================================
router.get('/accounting/accounts', authorizePermission('accounting.coa', 'accounting.vouchers', 'accounting.treasury', 'accounting.reports', 'accounting.view'), asyncHandler(async (req, res) => {
  const data = await AccountingService.getAllAccounts();
  res.json(data);
}));

router.get('/accounting/accounts/tree', authorizePermission('accounting.coa', 'accounting.reports', 'accounting.view'), asyncHandler(async (req, res) => {
  const tree = await AccountingService.getAccountsTree();
  res.json(tree);
}));

const seedAccountsHandler = asyncHandler(async (req, res) => {
  const result = await AccountingService.seedStandardAccounts();
  await logActivity({
    userId: req.user?.id,
    username: req.user?.username || 'admin',
    userFullName: req.user?.fullName || '',
    action: 'SEED',
    entity: 'حسابداری:کدینگ_پیش‌فرض',
    description: 'استقرار و همگام‌سازی ساختار کدینگ استاندارد حساب‌ها',
    details: result,
    ipAddress: extractClientIp(req)
  });
  res.json({ message: 'کدینگ استاندارد حساب‌ها با موفقیت مستقر و همگام شد', ...result });
});
router.post('/accounting/accounts/seed-default', requireSystemAdmin, seedAccountsHandler);
router.post('/accounting/accounts/seed-standard', requireSystemAdmin, seedAccountsHandler);

router.post('/accounting/accounts', authorizePermission('accounting.coa'), validate(createAccountSchema), asyncHandler(async (req, res) => {
  const account = await AccountingService.createAccount(req.body);
  await logActivity({
    userId: req.user?.id,
    username: req.user?.username || 'system',
    userFullName: req.user?.fullName || '',
    action: 'CREATE',
    entity: 'account',
    entityId: String(account.id),
    description: `تعریف حساب جدید: ${account.name} (کد: ${account.code})`,
    details: { account },
    ipAddress: req.ip || '',
  });
  res.status(201).json(account);
}));

router.put('/accounting/accounts/:id', authorizePermission('accounting.coa'), validate(updateAccountSchema), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const updated = await AccountingService.updateAccount(id, req.body);
  await logActivity({
    userId: req.user?.id,
    username: req.user?.username || 'system',
    userFullName: req.user?.fullName || '',
    action: 'UPDATE',
    entity: 'account',
    entityId: String(id),
    description: `ویرایش حساب: ${updated.name} (کد: ${updated.code})`,
    details: { changes: req.body },
    ipAddress: req.ip || '',
  });
  res.json(updated);
}));

router.delete('/accounting/accounts/:id', authorizePermission('accounting.coa'), validate(paramsIdSchema), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const result = await AccountingService.deleteAccount(id);
  await logActivity({
    userId: req.user?.id,
    username: req.user?.username || 'system',
    userFullName: req.user?.fullName || '',
    action: 'DELETE',
    entity: 'account',
    entityId: String(id),
    description: `حذف حساب با شناسه ${id}`,
    details: { id },
    ipAddress: req.ip || '',
  });
  res.json(result);
}));

router.post('/accounting/accounts/:id/restore', authorizePermission('accounting.coa'), validate(paramsIdSchema), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const restored = await AccountingService.restoreAccount(id);
  await logActivity({
    userId: req.user?.id,
    username: req.user?.username || 'system',
    userFullName: req.user?.fullName || '',
    action: 'UPDATE',
    entity: 'account',
    entityId: String(id),
    description: `احیای حساب حذف‌شده: ${restored.name} (کد: ${restored.code})`,
    details: { account: restored },
    ipAddress: req.ip || '',
  });
  res.json(restored);
}));

// ==========================================
// ACCOUNT MAPPINGS (نگاشت مفهومی سرفصل‌های حسابداری)
// ==========================================
router.get('/accounting/mappings', authorizePermission('accounting.coa', 'accounting.view'), asyncHandler(async (req, res) => {
  // V1.7.0: متادیتای کامل — مپینگ‌ها + غیرفعال‌ها + وضعیت کدینگ (برای دکمه همگام‌سازی شرطی)
  const mappings = await AccountingService.getAccountMappings();
  const meta = await AccountMappingService.getMappingsWithMeta();
  res.json({
    ...mappings,
    disabled: meta.disabled,
    accountsCount: meta.accountsCount,
    chartHasAccounts: meta.chartHasAccounts,
  });
}));

router.post('/accounting/mappings', authorizePermission('accounting.coa'), validate(saveAccountMappingsSchema), asyncHandler(async (req, res) => {
  const { disabled, ...mappings } = (req.body || {}) as z.infer<typeof saveAccountMappingsSchema>['body'];
  const updated = await AccountingService.saveAccountMappings(mappings);
  if (Array.isArray(disabled)) {
    await AccountMappingService.setDisabledMappings(disabled);
  }
  await logActivity({
    userId: req.user?.id,
    username: req.user?.username || 'admin',
    userFullName: req.user?.fullName || '',
    action: 'UPDATE',
    entity: 'حسابداری:نگاشت_مفهومی_سرفصل‌ها',
    description: 'به‌روزرسانی تنظیمات نگاشت مفهومی حساب‌ها و سرفصل‌های پیش‌فرض',
    details: { changes: req.body, result: updated, disabled: disabled || [] },
    ipAddress: extractClientIp(req)
  });
  res.json({ message: 'تنظیمات نگاشت سرفصل‌ها با موفقیت ذخیره شد', data: updated, disabled: disabled || [] });
}));

export default router;
