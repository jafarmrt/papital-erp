import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { User } from '../types';
import { PageLoader } from './PageLoader';
import { ProtectedRoute } from './auth/ProtectedRoute';
import TimezoneProvider from './providers/TimezoneProvider';
import { ConfirmDialogHost } from './ConfirmDialogHost';

// Lazy-loaded page components for Code Splitting (FE-001)
const Dashboard = lazy(() => import('../pages/Dashboard'));
const InventoryStatusPage = lazy(() => import('../pages/InventoryStatusPage'));
const CustomersPage = lazy(() => import('../pages/CustomersPage'));
const PricingPage = lazy(() => import('../pages/PricingPage'));
const GalleryPage = lazy(() => import('../pages/GalleryPage'));
const DocumentsPage = lazy(() => import('../pages/DocumentsPage'));
const CreateInvoicePage = lazy(() => import('../pages/CreateInvoicePage'));
const InvoicesListPage = lazy(() => import('../pages/InvoicesListPage'));
const InventoryAuditPage = lazy(() => import('../pages/InventoryAuditPage'));
const SettingsPage = lazy(() => import('../pages/SettingsPage'));
const UsersPage = lazy(() => import('../pages/UsersPage'));
const ActivityLogsPage = lazy(() => import('../pages/ActivityLogsPage'));
const TransactionsPage = lazy(() => import('../pages/TransactionsPage'));
const ReservedItemsReportPage = lazy(() => import('../pages/ReservedItemsReportPage'));
const ProjectsPage = lazy(() => import('../pages/ProjectsPage'));
const ProjectInventoryPage = lazy(() => import('../pages/ProjectInventoryPage'));
const ReorderAlertsPage = lazy(() => import('../pages/ReorderAlertsPage'));
const PendingMaterialsPage = lazy(() => import('../pages/PendingMaterialsPage'));
const TransfersPage = lazy(() => import('../pages/TransfersPage'));
const DailyLogsPage = lazy(() => import('../pages/DailyLogsPage'));
const PersonnelPage = lazy(() => import('../pages/PersonnelPage'));
const PieceworkPayrollPage = lazy(() => import('../pages/PieceworkPayrollPage'));
const MyPayslipsPage = lazy(() => import('../pages/MyPayslipsPage'));
const CRMPage = lazy(() => import('../pages/CRMPage'));
const AccountingPage = lazy(() => import('../pages/AccountingPage'));
const ApprovalInboxPage = lazy(() => import('../pages/ApprovalInboxPage'));
const WorkflowManagementPage = lazy(() => import('../pages/WorkflowManagementPage'));
const DomainEventsPage = lazy(() => import('../pages/DomainEventsPage'));
const ChangelogPage = lazy(() => import('../pages/ChangelogPage'));
const ItemsPage = lazy(() => import('../pages/ItemsPage'));

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
          <ProtectedRoute requiredPerm="documents.view" userPermissions={userPermissions} permissionsLoaded={permissionsLoaded} user={user}>
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
          <ProtectedRoute requiredPerm="settings.manage" userPermissions={userPermissions} permissionsLoaded={permissionsLoaded} user={user}>
            <SettingsPage currentUser={user} />
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
      </TimezoneProvider>
    </Suspense>
  );
}

export default AppRoutes;
