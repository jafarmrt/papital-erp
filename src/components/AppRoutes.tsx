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
const MediaLibraryPage = lazyWithRetry(() => import('../pages/MediaLibraryPage'));
const MediaProductPage = lazyWithRetry(() => import('../pages/MediaProductPage'));
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
        <Route path="/inventory-status" element={
          <ProtectedRoute page="/inventory-status" userPermissions={userPermissions} permissionsLoaded={permissionsLoaded} user={user}>
            <InventoryStatusPage />
          </ProtectedRoute>
        } />
        <Route path="/crm" element={
          <ProtectedRoute page="/crm" userPermissions={userPermissions} permissionsLoaded={permissionsLoaded} user={user}>
            <CRMPage user={user} />
          </ProtectedRoute>
        } />
        <Route path="/daily-logs" element={
          <ProtectedRoute page="/daily-logs" userPermissions={userPermissions} permissionsLoaded={permissionsLoaded} user={user}>
            <DailyLogsPage user={user} />
          </ProtectedRoute>
        } />
        <Route path="/reorder-alerts" element={
          <ProtectedRoute page="/reorder-alerts" userPermissions={userPermissions} permissionsLoaded={permissionsLoaded} user={user}>
            <ReorderAlertsPage user={user} />
          </ProtectedRoute>
        } />
        {/* V10-2.2: مسیر canonical واحد برای کالاها — تب محصول/مواد اولیه با query param (?type=raw_material) */}
        <Route path="/products" element={
          <ProtectedRoute page="/products" userPermissions={userPermissions} permissionsLoaded={permissionsLoaded} user={user}>
            <ItemsPage />
          </ProtectedRoute>
        } />
        <Route path="/transfers" element={
          <ProtectedRoute page="/transfers" userPermissions={userPermissions} permissionsLoaded={permissionsLoaded} user={user}>
            <TransfersPage user={user} />
          </ProtectedRoute>
        } />
        {/* V10-2.2: مسیر قدیمی /materials حفظ شد (redirect) */}
        <Route path="/materials" element={<Navigate to="/products?type=raw_material" replace />} />
        <Route path="/pending-materials" element={
          <ProtectedRoute page="/pending-materials" userPermissions={userPermissions} permissionsLoaded={permissionsLoaded} user={user}>
            <PendingMaterialsPage user={user} />
          </ProtectedRoute>
        } />
        <Route path="/gallery" element={
          <ProtectedRoute page="/gallery" userPermissions={userPermissions} permissionsLoaded={permissionsLoaded} user={user}>
            <GalleryPage user={user} />
          </ProtectedRoute>
        } />
        <Route path="/media-library" element={
          <ProtectedRoute page="/media-library" userPermissions={userPermissions} permissionsLoaded={permissionsLoaded} user={user}>
            <MediaLibraryPage user={user} />
          </ProtectedRoute>
        } />
        <Route path="/media-library/products/:itemId" element={
          <ProtectedRoute page="/media-library/products/:itemId" userPermissions={userPermissions} permissionsLoaded={permissionsLoaded} user={user}>
            <MediaProductPage user={user} />
          </ProtectedRoute>
        } />
        <Route path="/pricing" element={
          <ProtectedRoute page="/pricing" userPermissions={userPermissions} permissionsLoaded={permissionsLoaded} user={user}>
            <PricingPage />
          </ProtectedRoute>
        } />
        <Route path="/customers" element={
          <ProtectedRoute page="/customers" userPermissions={userPermissions} permissionsLoaded={permissionsLoaded} user={user}>
            <CustomersPage user={user} />
          </ProtectedRoute>
        } />
        <Route path="/receipts" element={
          <ProtectedRoute page="/receipts" userPermissions={userPermissions} permissionsLoaded={permissionsLoaded} user={user}>
            <DocumentsPage user={user} />
          </ProtectedRoute>
        } />
        <Route path="/remittances" element={
          <ProtectedRoute page="/remittances" userPermissions={userPermissions} permissionsLoaded={permissionsLoaded} user={user}>
            <CreateInvoicePage user={user} />
          </ProtectedRoute>
        } />
        <Route path="/invoices/create" element={
          <ProtectedRoute page="/invoices/create" userPermissions={userPermissions} permissionsLoaded={permissionsLoaded} user={user}>
            <CreateInvoicePage user={user} />
          </ProtectedRoute>
        } />
        <Route path="/invoices" element={
          <ProtectedRoute page="/invoices" userPermissions={userPermissions} permissionsLoaded={permissionsLoaded} user={user}>
            <InvoicesListPage />
          </ProtectedRoute>
        } />
        <Route path="/audit" element={
          <ProtectedRoute page="/audit" userPermissions={userPermissions} permissionsLoaded={permissionsLoaded} user={user}>
            <InventoryAuditPage user={user} />
          </ProtectedRoute>
        } />
        <Route path="/projects" element={
          <ProtectedRoute page="/projects" userPermissions={userPermissions} permissionsLoaded={permissionsLoaded} user={user}>
            <ProjectsPage />
          </ProtectedRoute>
        } />
        <Route path="/project-inventory" element={
          <ProtectedRoute page="/project-inventory" userPermissions={userPermissions} permissionsLoaded={permissionsLoaded} user={user}>
            <ProjectInventoryPage user={user} />
          </ProtectedRoute>
        } />
        <Route path="/procurement" element={
          <ProtectedRoute page="/procurement" userPermissions={userPermissions} permissionsLoaded={permissionsLoaded} user={user}>
            <ProcurementPage />
          </ProtectedRoute>
        } />
        <Route path="/reserved-items" element={
          <ProtectedRoute page="/reserved-items" userPermissions={userPermissions} permissionsLoaded={permissionsLoaded} user={user}>
            <ReservedItemsReportPage />
          </ProtectedRoute>
        } />
        <Route path="/transactions" element={
          <ProtectedRoute page="/transactions" userPermissions={userPermissions} permissionsLoaded={permissionsLoaded} user={user}>
            <TransactionsPage />
          </ProtectedRoute>
        } />
        <Route path="/activity-logs" element={
          <ProtectedRoute page="/activity-logs" userPermissions={userPermissions} permissionsLoaded={permissionsLoaded} user={user}>
            <ActivityLogsPage />
          </ProtectedRoute>
        } />
        <Route path="/settings" element={
          <ProtectedRoute page="/settings" userPermissions={userPermissions} permissionsLoaded={permissionsLoaded} user={user}>
            <SettingsPage currentUser={user} userPermissions={userPermissions} />
          </ProtectedRoute>
        } />
        <Route path="/users" element={
          <ProtectedRoute page="/users" userPermissions={userPermissions} permissionsLoaded={permissionsLoaded} user={user}>
            <UsersPage currentUser={user} userPermissions={userPermissions} />
          </ProtectedRoute>
        } />
        <Route path="/personnel" element={
          <ProtectedRoute page="/personnel" userPermissions={userPermissions} permissionsLoaded={permissionsLoaded} user={user}>
            <PersonnelPage />
          </ProtectedRoute>
        } />
        <Route path="/piecework" element={
          <ProtectedRoute page="/piecework" userPermissions={userPermissions} permissionsLoaded={permissionsLoaded} user={user}>
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
          <ProtectedRoute page="/accounting" userPermissions={userPermissions} permissionsLoaded={permissionsLoaded} user={user}>
            <AccountingPage userPermissions={userPermissions} user={user} />
          </ProtectedRoute>
        } />
        <Route path="/accounting/:tab" element={
          <ProtectedRoute page="/accounting" userPermissions={userPermissions} permissionsLoaded={permissionsLoaded} user={user}>
            <AccountingPage userPermissions={userPermissions} user={user} />
          </ProtectedRoute>
        } />
        <Route path="/approval-inbox" element={
          <ProtectedRoute page="/approval-inbox" userPermissions={userPermissions} permissionsLoaded={permissionsLoaded} user={user}>
            <ApprovalInboxPage />
          </ProtectedRoute>
        } />
        <Route path="/workflow-designer" element={
          <ProtectedRoute page="/workflow-designer" userPermissions={userPermissions} permissionsLoaded={permissionsLoaded} user={user}>
            <WorkflowManagementPage />
          </ProtectedRoute>
        } />
        <Route path="/domain-events" element={
          <ProtectedRoute page="/domain-events" userPermissions={userPermissions} permissionsLoaded={permissionsLoaded} user={user}>
            <DomainEventsPage />
          </ProtectedRoute>
        } />
        <Route path="/changelog" element={
          <ProtectedRoute page="/changelog" userPermissions={userPermissions} permissionsLoaded={permissionsLoaded} user={user}>
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
