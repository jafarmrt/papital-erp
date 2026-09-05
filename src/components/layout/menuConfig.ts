import { ComponentType } from 'react';
import {
  LayoutDashboard,
  Package,
  Warehouse,
  FileOutput,
  FileInput,
  History,
  Users,
  FileCode2,
  Settings,
  ClipboardList,
  Image,
  DollarSign,
  UsersRound,
  ShieldAlert,
  Layers,
  AlertTriangle,
  CalendarCheck,
  Wallet,
  Target,
  CheckSquare,
  ShoppingCart,
  Landmark,
  FolderTree,
  FileText,
  Building2,
  CreditCard,
  BarChart3,
  Lock,
  Workflow,
  Zap,
  Compass,
  Calculator
} from 'lucide-react';
import { User } from '../../types';

export interface MenuItem {
  name: string;
  path: string;
  icon: ComponentType<{ className?: string; size?: number }>;
  visible: boolean;
}

export interface MenuGroup {
  id: string;
  title: string;
  groupIcon: ComponentType<{ className?: string; size?: number }>;
  items: MenuItem[];
}

// V10-5.3: نقشه دید منو per-role — roleCode → فهرست pathهای «مخفی‌شده» (deny-list wins)
export type MenuVisibilityMap = Record<string, string[]>;

export function getMenuGroups(
  user?: User | null,
  userPermissions?: { permissions?: string[]; isAdmin?: boolean; roleName?: string } | null,
  menuVisibility?: MenuVisibilityMap | null
): MenuGroup[] {
  const isAdmin = Boolean(userPermissions?.isAdmin || user?.role === 'admin');

  const hasPerm = (permKey: string) => {
    if (isAdmin) return true;
    const permissions = Array.isArray(userPermissions?.permissions) ? userPermissions.permissions : [];
    return permissions.includes(permKey);
  };

  return [
    {
      id: 'main',
      title: 'اصلی',
      groupIcon: Compass,
      items: [
        { name: 'داشبورد', path: '/', icon: LayoutDashboard, visible: true },
        { name: 'کارتابل تاییدات و گردش کار', path: '/approval-inbox', icon: CheckSquare, visible: true },
      ]
    },
    {
      id: 'inventory',
      title: 'انبار',
      groupIcon: Package,
      items: [
        // V10-5.0: محتوای فعلی داشبورد BI انبار؛ داشبورد سراسری آینده در «/» جای می‌گیرد
        { name: 'وضعیت انبار', path: '/inventory-status', icon: Warehouse, visible: true },
        { name: 'محصولات و مواد اولیه', path: '/products', icon: Package, visible: hasPerm('products.view') },
        { name: 'ورود و خروج انبار', path: '/receipts', icon: FileInput, visible: hasPerm('warehouse.in') || hasPerm('documents.view') || hasPerm('documents.create') },
        { name: 'تأیید مواد اولیه جدید', path: '/pending-materials', icon: CheckSquare, visible: hasPerm('products.view') },
        { name: 'کدهای ترنسفر', path: '/transfers', icon: Layers, visible: hasPerm('products.view') },
        { name: 'هشدار نقطه سفارش', path: '/reorder-alerts', icon: AlertTriangle, visible: hasPerm('products.view') },
        { name: 'قیمت‌گذاری اقلام', path: '/pricing', icon: DollarSign, visible: hasPerm('products.edit_price') || hasPerm('products.view') },
        { name: 'گالری تصویری', path: '/gallery', icon: Image, visible: hasPerm('products.view') },
        { name: 'انبارگردانی دوره‌ای', path: '/audit', icon: ClipboardList, visible: hasPerm('audit.view') },
      ]
    },
    {
      id: 'crm',
      title: 'فروش و مشتریان',
      groupIcon: Target,
      items: [
        { name: 'مدیریت CRM و فروش', path: '/crm', icon: Target, visible: hasPerm('crm.view') },
        { name: 'طرفین حساب (مشتریان)', path: '/customers', icon: UsersRound, visible: hasPerm('customers.view') },
        { name: 'صدور فاکتور و پیش‌فاکتور', path: '/invoices/create', icon: FileOutput, visible: hasPerm('documents.create') },
      ]
    },
    {
      id: 'production',
      title: 'برنامه‌ریزی و کنترل تولید',
      groupIcon: Layers,
      items: [
        { name: 'کنترل پروژه‌های تولید', path: '/projects', icon: Layers, visible: hasPerm('projects.view') },
        { name: 'کنترل موجودی BOM', path: '/project-inventory', icon: ShoppingCart, visible: hasPerm('projects.view') || hasPerm('warehouse.view') },
      ]
    },
    {
      id: 'hr',
      title: 'منابع انسانی و پرسنل',
      groupIcon: Users,
      items: [
        { name: 'مشخصات پرسنل', path: '/personnel', icon: Users, visible: hasPerm('personnel.view') },
        // V10-5.4: گزارش کار روزانه به گروه HR منتقل شد
        { name: 'گزارش کار روزانه', path: '/daily-logs', icon: CalendarCheck, visible: hasPerm('daily_logs.view') || hasPerm('daily_logs.create') },
        { name: 'حقوق و دستمزد', path: '/piecework', icon: Calculator, visible: hasPerm('piecework.view') },
        // فیش‌های حقوقی من: برای تمام کاربران لاگین‌شده (پرسنلی که کاربر سیستم هستند)
        { name: 'فیش‌های حقوقی من', path: '/my-payslips', icon: Wallet, visible: true },
      ]
    },
    {
      id: 'reports',
      title: 'گزارش‌ها و نظارت',
      groupIcon: History,
      items: [
        { name: 'گزارش اقلام رزروی', path: '/reserved-items', icon: Lock, visible: hasPerm('products.view') || hasPerm('reports.view') || hasPerm('warehouse.view') },
        { name: 'گزارش تراکنش‌ها', path: '/transactions', icon: History, visible: hasPerm('reports.view') },
      ]
    },
    {
      id: 'accounting',
      title: 'مالی و حسابداری دوبل',
      groupIcon: Landmark,
      items: [
        { name: 'داشبورد مالی', path: '/accounting/dashboard', icon: LayoutDashboard, visible: hasPerm('accounting.view') },
        { name: 'مرور حساب‌ها (درخت و کاردکس)', path: '/accounting/explorer', icon: Layers, visible: hasPerm('accounting.reports') },
        { name: 'کدینگ و درخت حساب‌ها', path: '/accounting/coa', icon: FolderTree, visible: hasPerm('accounting.coa') },
        { name: 'اسناد دوبل حسابداری', path: '/accounting/vouchers', icon: FileText, visible: hasPerm('accounting.vouchers') },
        { name: 'خزانه‌داری و حساب‌های بانکی', path: '/accounting/treasury', icon: Building2, visible: hasPerm('accounting.treasury') },
        { name: 'لیست اسناد و فاکتورها', path: '/invoices', icon: ClipboardList, visible: hasPerm('documents.view') || hasPerm('accounting.treasury') || hasPerm('accounting.view') },
        { name: 'مدیریت چک‌های صیادی', path: '/accounting/cheques', icon: CreditCard, visible: hasPerm('accounting.cheques') },
        { name: 'صورت‌ها و گزارش‌های مالی', path: '/accounting/reports', icon: BarChart3, visible: hasPerm('accounting.reports') },
        { name: 'بستن سال مالی', path: '/accounting/fiscal-closing', icon: Lock, visible: hasPerm('accounting.vouchers') },
      ]
    },
    {
      id: 'system',
      title: 'مدیریت و سیستم',
      groupIcon: Settings,
      items: [
        // V10-5.2: هم‌راستا با API — events.view (admin از طریق isAdmin عبور می‌کند)
        { name: 'رویدادها و اتوماسیون سازمانی', path: '/domain-events', icon: Zap, visible: hasPerm('events.view') },
        { name: 'طراح فرایند و گردش کار (SLA)', path: '/workflow-designer', icon: Workflow, visible: user?.role === 'admin' },
        { name: 'مدیریت کاربران و نقش‌ها', path: '/users', icon: Users, visible: user?.role === 'admin' },
        { name: 'تنظیمات سامانه', path: '/settings', icon: Settings, visible: user?.role === 'admin' },
        { name: 'سجل تغییرات', path: '/activity-logs', icon: ShieldAlert, visible: hasPerm('audit_logs.view') || hasPerm('reports.view') },
        { name: 'معرفی و به‌روزرسانی‌ها', path: '/changelog', icon: FileCode2, visible: user?.role === 'admin' },
      ]
    }
  ].map(group => ({
    ...group,
    items: group.items.map(item => ({
      ...item,
      // V10-5.3: اعمال deny-list دید منو — admin همیشه همه را می‌بیند
      visible: item.visible && !(menuVisibility && user?.role && user.role !== 'admin' && Array.isArray(menuVisibility[user.role]) && menuVisibility[user.role].includes(item.path))
    }))
  }));
}
