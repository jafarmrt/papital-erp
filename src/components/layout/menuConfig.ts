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
  ShoppingBag,
  Landmark,
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
import { canOpenPage, isSystemAdminViewer } from '../../lib/permissions/pageAccess';

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
  // v9.0.114 (TD-668، ت۲ بسته ۱۶): دید هر پیوند همان دسترسی صفحه در جدول یکتای pageAccess است (همان مسیر و API صفحه)
  const viewer = { permissions: userPermissions?.permissions, isAdmin: userPermissions?.isAdmin, role: user?.role };
  const open = (path: string) => canOpenPage(path, viewer);

  return [
    {
      id: 'main',
      title: 'اصلی',
      groupIcon: Compass,
      items: [
        { name: 'داشبورد', path: '/', icon: LayoutDashboard, visible: open('/') },
        { name: 'کارتابل تاییدات و گردش کار', path: '/approval-inbox', icon: CheckSquare, visible: open('/approval-inbox') },
      ]
    },
    {
      id: 'inventory',
      title: 'انبار',
      groupIcon: Package,
      items: [
        // V10-5.0: محتوای فعلی داشبورد BI انبار؛ داشبورد سراسری آینده در «/» جای می‌گیرد
        { name: 'وضعیت انبار', path: '/inventory-status', icon: Warehouse, visible: open('/inventory-status') },
        { name: 'محصولات و مواد اولیه', path: '/products', icon: Package, visible: open('/products') },
        { name: 'ورود و خروج انبار', path: '/receipts', icon: FileInput, visible: open('/receipts') },
        { name: 'تأیید مواد اولیه جدید', path: '/pending-materials', icon: CheckSquare, visible: open('/pending-materials') },
        { name: 'کدهای ترنسفر', path: '/transfers', icon: Layers, visible: open('/transfers') },
        { name: 'هشدار نقطه سفارش', path: '/reorder-alerts', icon: AlertTriangle, visible: open('/reorder-alerts') },
        { name: 'قیمت‌گذاری اقلام', path: '/pricing', icon: DollarSign, visible: open('/pricing') },
        { name: 'گالری تصویری', path: '/gallery', icon: Image, visible: open('/gallery') },
        { name: 'انبارگردانی دوره‌ای', path: '/audit', icon: ClipboardList, visible: open('/audit') },
      ]
    },
    {
      id: 'crm',
      title: 'فروش و مشتریان',
      groupIcon: Target,
      items: [
        { name: 'ارتباط با مشتری و فروش', path: '/crm', icon: Target, visible: open('/crm') },
        { name: 'طرفین حساب', path: '/customers', icon: UsersRound, visible: open('/customers') },
        { name: 'صدور فاکتور و پیش‌فاکتور', path: '/invoices/create', icon: FileOutput, visible: open('/invoices/create') },
      ]
    },
    {
      id: 'production',
      title: 'برنامه‌ریزی و کنترل تولید',
      groupIcon: Layers,
      items: [
        { name: 'کنترل پروژه‌های تولید', path: '/projects', icon: Layers, visible: open('/projects') },
      ]
    },
    {
      id: 'procurement',
      title: 'خرید و تدارکات',
      groupIcon: ShoppingBag,
      items: [
        { name: 'میز کار تدارکات و خرید', path: '/procurement', icon: ShoppingBag, visible: open('/procurement') },
      ]
    },
    {
      id: 'hr',
      title: 'منابع انسانی و پرسنل',
      groupIcon: Users,
      items: [
        { name: 'مشخصات پرسنل', path: '/personnel', icon: Users, visible: open('/personnel') },
        // V10-5.4: گزارش کار روزانه به گروه HR منتقل شد
        { name: 'گزارش کار روزانه', path: '/daily-logs', icon: CalendarCheck, visible: open('/daily-logs') },
        { name: 'حقوق و دستمزد', path: '/piecework', icon: Calculator, visible: open('/piecework') },
        // فیش‌های حقوقی من: برای تمام کاربران لاگین‌شده (پرسنلی که کاربر سیستم هستند)
        { name: 'فیش‌های حقوقی من', path: '/my-payslips', icon: Wallet, visible: open('/my-payslips') },
      ]
    },
    {
      id: 'reports',
      title: 'گزارش‌ها و نظارت',
      groupIcon: History,
      items: [
        { name: 'گزارش اقلام رزروی', path: '/reserved-items', icon: Lock, visible: open('/reserved-items') },
        { name: 'گزارش تراکنش‌ها', path: '/transactions', icon: History, visible: open('/transactions') },
      ]
    },
    {
      id: 'accounting',
      title: 'مالی و حسابداری دوبل',
      groupIcon: Landmark,
      items: [
        { name: 'داشبورد مالی', path: '/accounting/dashboard', icon: LayoutDashboard, visible: open('/accounting/dashboard') },
        { name: 'مرور حساب‌ها (درخت و کاردکس)', path: '/accounting/explorer', icon: Layers, visible: open('/accounting/explorer') },
        { name: 'اسناد دوبل حسابداری', path: '/accounting/vouchers', icon: FileText, visible: open('/accounting/vouchers') },
        { name: 'خزانه‌داری و حساب‌های بانکی', path: '/accounting/treasury', icon: Building2, visible: open('/accounting/treasury') },
        { name: 'لیست اسناد و فاکتورها', path: '/invoices', icon: ClipboardList, visible: open('/invoices') },
        { name: 'مدیریت چک‌های صیادی', path: '/accounting/cheques', icon: CreditCard, visible: open('/accounting/cheques') },
        { name: 'صورت‌ها و گزارش‌های مالی', path: '/accounting/reports', icon: BarChart3, visible: open('/accounting/reports') },
        { name: 'بستن سال مالی', path: '/accounting/fiscal-closing', icon: Lock, visible: open('/accounting/fiscal-closing') },
      ]
    },
    {
      id: 'system',
      title: 'مدیریت و سیستم',
      groupIcon: Settings,
      items: [
        { name: 'رویدادها و اتوماسیون سازمانی', path: '/domain-events', icon: Zap, visible: open('/domain-events') },
        { name: 'طراح فرایند و گردش کار', path: '/workflow-designer', icon: Workflow, visible: open('/workflow-designer') },
        { name: 'مدیریت کاربران و نقش‌ها', path: '/users', icon: Users, visible: open('/users') },
        { name: 'تنظیمات سامانه', path: '/settings', icon: Settings, visible: open('/settings') },
        { name: 'سجل تغییرات', path: '/activity-logs', icon: ShieldAlert, visible: open('/activity-logs') },
        { name: 'معرفی و به‌روزرسانی‌ها', path: '/changelog', icon: FileCode2, visible: open('/changelog') },
      ]
    }
  ].map(group => ({
    ...group,
    items: group.items.map(item => ({
      ...item,
      // V10-5.3: اعمال deny-list دید منو — admin همیشه همه را می‌بیند
      visible: item.visible && !(menuVisibility && user?.role && !isSystemAdminViewer(viewer) && Array.isArray(menuVisibility[user.role]) && menuVisibility[user.role].includes(item.path))
    }))
  }));
}
