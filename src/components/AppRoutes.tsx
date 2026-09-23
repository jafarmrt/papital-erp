import React, { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { User } from '../types';
import { PageLoader } from './PageLoader';
import { ProtectedRoute } from './auth/ProtectedRoute';
import TimezoneProvider from './providers/TimezoneProvider';
import { ConfirmDialogHost } from './ConfirmDialogHost';
import { ErrorBoundary } from './ErrorBoundary';

// Helper for resilient lazy loading with auto-retry and cache-busting reload
function lazyWithRetry<T extends React.ComponentType<any>>(
  factory: () => Promise<{ default: T }>
) {
  return lazy(async () => {
    try {
      return await factory();
    } catch (error: any) {
      console.warn('Dynamic import failed, retrying module load...', error);
      try {
        await new Promise(r => setTimeout(r, 400));
        return await factory();
      } catch (err: any) {
        if (typeof window !== 'undefined') {
          const key = 'chunk_reload_ts';
          const last = Number(sessionStorage.getItem(key) || '0');
          const now = Date.now();
          if (now - last > 3000) {
            sessionStorage.setItem(key, String(now));
            try {
              window.location.reload();
            } catch {
              window.location.href = window.location.href;
            }
            return new Promise(() => {});
          }
        }
        throw err;
      }
    }
  });
}

import Dashboard from '../pages/Dashboard';

// Lazy-loaded page components for Code Splitting (FE-001)
const InventoryStatusPage = lazyWithRetry(() => import('../pages/InventoryStatusPage'));
const CustomersPage = lazyWithRetry(() => import('../pages/CustomersPage'));
const PricingPage = lazyWithRetry(() => import('../pages/PricingPage'));
const GalleryPage = lazyWithRetry(() => import('../pages/GalleryPage'));
const DocumentsPage = lazyWithRetry(() => import('../pages/DocumentsPage'));
const CreateInvoicePage = lazyWithRetry(() => import('../pages/CreateInvoicePage'));
const InvoicesListPage = lazyWithRetry(() => import('../pages/InvoicesListPage'));
const InventoryAuditPage = lazyWithRetry(() => import('../pages/InventoryAuditPage'));
const SettingsPage = lazyWithRetry(() => import('../pages/SettingsPage'));
const UsersPage = lazyWithRetry(() => import('../pages/UsersPage'));
const ActivityLogsPage = lazyWithRetry(() => import('../pages/ActivityLogsPage'));
const TransactionsPage = lazyWithRetry(() => import('../pages/TransactionsPage'));
const ReservedItemsReportPage = lazyWithRetry(() => import('../pages/ReservedItemsReportPage'));
const ProjectsPage = lazyWithRetry(() => import('../pages/ProjectsPage'));
const ProjectInventoryPage = lazyWithRetry(() => import('../pages/ProjectInventoryPage'));
const ProcurementPage = lazyWithRetry(() => import('../pages/ProcurementPage'));
const ReorderAlertsPage = lazyWithRetry(() => import('../pages/ReorderAlertsPage'));
const PendingMaterialsPage = lazyWithRetry(() => import('../pages/PendingMaterialsPage'));
const TransfersPage = lazyWithRetry(() => import('../pages/TransfersPage'));
const DailyLogsPage = lazyWithRetry(() => import('../pages/DailyLogsPage'));
const PersonnelPage = lazyWithRetry(() => import('../pages/PersonnelPage'));
const PieceworkPayrollPage = lazyWithRetry(() => import('../pages/PieceworkPayrollPage'));
const MyPayslipsPage = lazyWithRetry(() => import('../pages/MyPayslipsPage'));
const CRMPage = lazyWithRetry(() => import('../pages/CRMPage'));
const AccountingPage = lazyWithRetry(() => import('../pages/AccountingPage'));
const ApprovalInboxPage = lazyWithRetry(() => import('../pages/ApprovalInboxPage'));
const WorkflowManagementPage = lazyWithRetry(() => import('../pages/WorkflowManagementPage'));
const DomainEventsPage = lazyWithRetry(() => import('../pages/DomainEventsPage'));
const ChangelogPage = lazyWithRetry(() => import('../pages/ChangelogPage'));
const ItemsPage = lazyWithRetry(() => import('../pages/ItemsPage'));

export interface AppRoutesProps {
  user: User;
  userPermissions: { permissions: string[]; isAdmin: boolean; roleName?: string };
  permissionsLoaded: boolean;
}

export function AppRoutes({ user, userPermissions, permissionsLoaded }: AppRoutesProps) {
  return (
    <Suspense fallback={<PageLoader />}>
      {/* V10-1.3: ساعت توافقی واحد — همه فرمتورها از display_timezone تنظیمات تغذیه می‌شوند */}
      <TimezoneProvider>
      {/* V10-3.1: هاست تایید استاندارد — همه confirm های Promise-based از اینجا رندر می‌شوند */}
      <ConfirmDialogHost />
      <ErrorBoundary>
        <Routes>
          <Route path="/" element={<Dashboard />} />
        {/* V10-5.0: وضعیت انبار = داشبورد تحلیلی و هوش تجاری انبار */}
        <Route path="/inventory-status" element={<InventoryStatusPage />} />
        <Route path="/crm" element={
          <ProtectedRoute requiredPerm="crm.view" userPermissions={userPermissions} permissionsLoaded={permissionsLoaded} user={user}>
            <CRMPage user={user} />
          </ProtectedRoute>
        } />
        <Route path="/daily-logs" element={
          <ProtectedRoute requiredPerm={['daily_logs.view', 'daily_logs.create']} userPermissions={userPermissions} permissionsLoaded={permissionsLoaded} user={user}>
            <DailyLogsPage user={user} />
          </ProtectedRoute>
        } />
        <Route path="/reorder-alerts" element={
          <ProtectedRoute requiredPerm={['products.view', 'warehouse.view']} userPermissions={userPermissions} permissionsLoaded={permissionsLoaded} user={user}>
            <ReorderAlertsPage user={user} />
          </ProtectedRoute>
        } />
        {/* V10-2.2: مسیر canonical واحد برای کالاها — تب محصول/مواد اولیه با query param (?type=raw_material) */}
        <Route path="/products" element={
          <ProtectedRoute requiredPerm="products.view" userPermissions={userPermissions} permissionsLoaded={permissionsLoaded} user={user}>
            <ItemsPage user={user} />
          </ProtectedRoute>
        } />
        <Route path="/transfers" element={
          <ProtectedRoute requiredPerm={['products.view', 'warehouse.view']} userPermissions={userPermissions} permissionsLoaded={permissionsLoaded} user={user}>
            <TransfersPage user={user} />
          </ProtectedRoute>
        } />
        {/* V10-2.2: مسیر قدیمی /materials حفظ شد (redirect) */}
        <Route path="/materials" element={<Navigate to="/products?type=raw_material" replace />} />
        <Route path="/pending-materials" element={
          <ProtectedRoute requiredPerm={['pending_materials.view', 'pending_materials.approve']} userPermissions={userPermissions} permissionsLoaded={permissionsLoaded} user={user}>
            <PendingMaterialsPage user={user} />
          </ProtectedRoute>
        } />
        <Route path="/gallery" element={
          <ProtectedRoute requiredPerm="products.view" userPermissions={userPermissions} permissionsLoaded={permissionsLoaded} user={user}>
            <GalleryPage user={user} />
          </ProtectedRoute>
        } />
        <Route path="/pricing" element={
          <ProtectedRoute requiredPerm={['products.edit_price', 'products.view']} userPermissions={userPermissions} permissionsLoaded={permissionsLoaded} user={user}>
            <PricingPage user={user} />
          </ProtectedRoute>
        } />
        <Route path="/customers" element={
          <ProtectedRoute requiredPerm="customers.view" userPermissions={userPermissions} permissionsLoaded={permissionsLoaded} user={user}>
            <CustomersPage user={user} />
          </ProtectedRoute>
        } />
        <Route path="/receipts" element={
          <ProtectedRoute requiredPerm={['warehouse.in', 'documents.view', 'documents.create']} userPermissions={userPermissions} permissionsLoaded={permissionsLoaded} user={user}>
            <DocumentsPage user={user} />
          </ProtectedRoute>
        } />
        <Route path="/remittances" element={
          <ProtectedRoute requiredPerm="documents.create" userPermissions={userPermissions} permissionsLoaded={permissionsLoaded} user={user}>
            <CreateInvoicePage user={user} />
          </ProtectedRoute>
        } />
        <Route path="/invoices/create" element={
          <ProtectedRoute requiredPerm="documents.create" userPermissions={userPermissions} permissionsLoaded={permissionsLoaded} user={user}>
            <CreateInvoicePage user={user} />
          </ProtectedRoute>
        } />
        <Route path="/invoices" element={
          <ProtectedRoute requiredPerm={['documents.view', 'accounting.treasury', 'accounting.view']} userPermissions={userPermissions} permissionsLoaded={permissionsLoaded} user={user}>
            <InvoicesListPage />
          </ProtectedRoute>
        } />
        <Route path="/audit" element={
          <ProtectedRoute requiredPerm="audit.view" userPermissions={userPermissions} permissionsLoaded={permissionsLoaded} user={user}>
            <InventoryAuditPage user={user} />
          </ProtectedRoute>
        } />
        <Route path="/projects" element={
          <ProtectedRoute requiredPerm="projects.view" userPermissions={userPermissions} permissionsLoaded={permissionsLoaded} user={user}>
            <ProjectsPage />
          </ProtectedRoute>
        } />
        <Route path="/project-inventory" element={
          <ProtectedRoute requiredPerm={['projects.view', 'warehouse.view']} userPermissions={userPermissions} permissionsLoaded={permissionsLoaded} user={user}>
            <ProjectInventoryPage user={user} />
          </ProtectedRoute>
        } />
        <Route path="/procurement" element={
          <ProtectedRoute requiredPerm={['procurement.view', 'procurement_officer', 'projects.view', 'documents.view']} userPermissions={userPermissions} permissionsLoaded={permissionsLoaded} user={user}>
            <ProcurementPage user={user} />
          </ProtectedRoute>
        } />
        <Route path="/reserved-items" element={
          <ProtectedRoute requiredPerm={['products.view', 'reports.view', 'warehouse.view', 'documents.view']} userPermissions={userPermissions} permissionsLoaded={permissionsLoaded} user={user}>
            <ReservedItemsReportPage />
          </ProtectedRoute>
        } />
        <Route path="/transactions" element={
          <ProtectedRoute requiredPerm="reports.view" userPermissions={userPermissions} permissionsLoaded={permissionsLoaded} user={user}>
            <TransactionsPage />
          </ProtectedRoute>
        } />
        <Route path="/activity-logs" element={
          <ProtectedRoute requiredPerm={['audit_logs.view', 'reports.view']} userPermissions={userPermissions} permissionsLoaded={permissionsLoaded} user={user}>
            <ActivityLogsPage />
          </ProtectedRoute>
        } />
        <Route path="/settings" element={
          <ProtectedRoute requiredPerm={['settings.manage', 'accounting.coa']} userPermissions={userPermissions} permissionsLoaded={permissionsLoaded} user={user}>
            <SettingsPage currentUser={user} userPermissions={userPermissions} />
          </ProtectedRoute>
        } />
        <Route path="/users" element={
          <ProtectedRoute requiredPerm={['users.manage', 'roles.manage']} userPermissions={userPermissions} permissionsLoaded={permissionsLoaded} user={user}>
            <UsersPage currentUser={user} />
          </ProtectedRoute>
        } />
        <Route path="/personnel" element={
          <ProtectedRoute requiredPerm="personnel.view" userPermissions={userPermissions} permissionsLoaded={permissionsLoaded} user={user}>
            <PersonnelPage />
          </ProtectedRoute>
        } />
        <Route path="/piecework" element={
          <ProtectedRoute requiredPerm="piecework.view" userPermissions={userPermissions} permissionsLoaded={permissionsLoaded} user={user}>
            <PieceworkPayrollPage />
          </ProtectedRoute>
        } />
        <Route path="/my-payslips" element={
          // فیش‌های حقوقی من: برای هر کاربر لاگین‌شده (پرسنلِ کاربر)
          <Suspense fallback={<PageLoader />}>
            <MyPayslipsPage />
          </Suspense>
        } />
        <Route path="/accounting" element={
          <ProtectedRoute requiredPerm={['accounting.view', 'accounting.coa', 'accounting.vouchers', 'accounting.treasury', 'accounting.cheques', 'accounting.reports']} userPermissions={userPermissions} permissionsLoaded={permissionsLoaded} user={user}>
            <AccountingPage userPermissions={userPermissions} user={user} />
          </ProtectedRoute>
        } />
        <Route path="/accounting/:tab" element={
          <ProtectedRoute requiredPerm={['accounting.view', 'accounting.coa', 'accounting.vouchers', 'accounting.treasury', 'accounting.cheques', 'accounting.reports']} userPermissions={userPermissions} permissionsLoaded={permissionsLoaded} user={user}>
            <AccountingPage userPermissions={userPermissions} user={user} />
          </ProtectedRoute>
        } />
        <Route path="/approval-inbox" element={
          <ProtectedRoute requiredPerm="workflow.view" userPermissions={userPermissions} permissionsLoaded={permissionsLoaded} user={user}>
            <ApprovalInboxPage />
          </ProtectedRoute>
        } />
        <Route path="/workflow-designer" element={
          <ProtectedRoute requiredPerm={['workflow.manage', 'settings.manage']} userPermissions={userPermissions} permissionsLoaded={permissionsLoaded} user={user}>
            <WorkflowManagementPage />
          </ProtectedRoute>
        } />
        <Route path="/domain-events" element={
          <ProtectedRoute requiredPerm={['events.view', 'settings.manage']} userPermissions={userPermissions} permissionsLoaded={permissionsLoaded} user={user}>
            <DomainEventsPage currentUser={user} />
          </ProtectedRoute>
        } />
        <Route path="/changelog" element={
          <ProtectedRoute requiredPerm="settings.manage" userPermissions={userPermissions} permissionsLoaded={permissionsLoaded} user={user}>
            <ChangelogPage />
          </ProtectedRoute>
        } />
      </Routes>
      </ErrorBoundary>
      </TimezoneProvider>
    </Suspense>
  );
}

export default AppRoutes;
