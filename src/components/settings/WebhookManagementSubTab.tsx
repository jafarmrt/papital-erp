import React, { useState, useEffect } from 'react';
import { confirmAction } from '../ConfirmDialogHost';
import {
  Globe,
  Plus,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Send,
  Key,
  Copy,
  Check,
  Clock,
  Trash2,
  Edit3,
  ToggleLeft,
  ToggleRight,
  Shield,
  Activity,
  Layers,
  ChevronDown,
  ChevronUp,
  Sliders,
  ExternalLink
} from 'lucide-react';
import { formatPersianDate } from '../../utils';
import { fetchJson } from '../../api';

interface WebhookSubscription {
  id: number;
  name: string;
  targetUrl: string;
  secretKey: string;
  eventPatterns: string[];
  customHeaders?: Record<string, string>;
  isActive: number;
  retryLimit: number;
  timeoutMs: number;
  totalDeliveries: number;
  successfulDeliveries: number;
  failedDeliveries: number;
  lastDeliveryAt?: string;
  lastStatus?: string;
  lastError?: string;
  createdAt: string;
}

interface WebhookDeliveryLog {
  id: number;
  subscriptionId: number;
  subscriptionName: string;
  eventId: string;
  eventType: string;
  targetUrl: string;
  statusCode: number;
  status: 'success' | 'failed' | 'timeout';
  responseBody?: string;
  errorMessage?: string;
  signature: string;
  attempt: number;
  durationMs: number;
  createdAt: string;
}

interface WebhookStats {
  totalSubscriptions: number;
  activeSubscriptions: number;
  totalDeliveries: number;
  successfulDeliveries: number;
  failedDeliveries: number;
  successRate: number;
}

const AVAILABLE_EVENT_PRESETS = [
  { pattern: '*', label: 'تمام رویدادهای سیستم (*)' },
  { pattern: 'document.*', label: 'تمام رویدادهای اسناد و فاکتورها' },
  { pattern: 'document.invoiced', label: 'صدور قطعی فاکتور فروش' },
  { pattern: 'document.settled', label: 'تسویه کامل فاکتور' },
  { pattern: 'inventory.*', label: 'تمام رویدادهای انبارداری' },
  { pattern: 'inventory.stock_in', label: 'ورود کالا به انبار' },
  { pattern: 'inventory.stock_out', label: 'خروج کالا از انبار' },
  { pattern: 'inventory.stock_alert', label: 'هشدار کسر و نقطه سفارش کالا' },
  { pattern: 'treasury.*', label: 'تمام رویدادهای خزانه‌داری و چک‌ها' },
  { pattern: 'workflow.*', label: 'گردش کار و تاییدیه‌ها' }
];

export function WebhookManagementSubTab() {
  const [subscriptions, setSubscriptions] = useState<WebhookSubscription[]>([]);
  const [deliveries, setDeliveries] = useState<WebhookDeliveryLog[]>([]);
  const [stats, setStats] = useState<WebhookStats | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [copiedKeyId, setCopiedKeyId] = useState<number | null>(null);
  const [selectedSubForDeliveries, setSelectedSubForDeliveries] = useState<number | null>(null);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSub, setEditingSub] = useState<WebhookSubscription | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    targetUrl: '',
    secretKey: '',
    eventPatterns: ['*'] as string[],
    customHeadersJson: '{\n  "X-Custom-Auth": "erp-token"\n}',
    isActive: 1,
    retryLimit: 3,
    timeoutMs: 5000
  });

  // Ping Test State
  const [pingTestingId, setPingTestingId] = useState<number | null>(null);
  const [pingResult, setPingResult] = useState<any | null>(null);

  // Toast
  const [toast, setToast] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const showToast = (text: string, type: 'success' | 'error' = 'success') => {
    setToast({ text, type });
    setTimeout(() => setToast(null), 4500);
  };

  const fetchStats = async () => {
    try {
      const data = await fetchJson<{ success?: boolean; stats?: WebhookStats }>('/events/webhooks/stats');
      if (data?.success && data.stats) setStats(data.stats);
    } catch (err) {
      console.error('Error fetching webhook stats:', err);
    }
  };

  const fetchSubscriptions = async () => {
    setIsLoading(true);
    try {
      const data = await fetchJson<{ success?: boolean; data?: WebhookSubscription[] }>('/events/webhooks');
      if (data?.success) {
        setSubscriptions(Array.isArray(data.data) ? data.data : []);
      }
    } catch (err) {
      showToast('خطا در دریافت لیست وب‌هوک‌ها', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchDeliveries = async (subId?: number) => {
    try {
      const params = new URLSearchParams({ limit: '30' });
      if (subId) params.append('subscriptionId', String(subId));

      const data = await fetchJson<{ success?: boolean; data?: WebhookDeliveryLog[] }>(`/events/webhooks/deliveries/list?${params.toString()}`);
      if (data?.success) {
        setDeliveries(Array.isArray(data.data) ? data.data : []);
      }
    } catch (err) {
      console.error('Error fetching deliveries:', err);
    }
  };

  useEffect(() => {
    fetchStats();
    fetchSubscriptions();
    fetchDeliveries();
  }, []);

  const openCreateModal = () => {
    setEditingSub(null);
    setFormData({
      name: '',
      targetUrl: '',
      secretKey: `whsec_${Math.random().toString(36).substring(2, 10)}${Math.random().toString(36).substring(2, 10)}`,
      eventPatterns: ['*'],
      customHeadersJson: '{\n  "X-Custom-Auth": "erp-token"\n}',
      isActive: 1,
      retryLimit: 3,
      timeoutMs: 5000
    });
    setPingResult(null);
    setIsModalOpen(true);
  };

  const openEditModal = (sub: WebhookSubscription) => {
    setEditingSub(sub);
    setFormData({
      name: sub.name,
      targetUrl: sub.targetUrl,
      secretKey: sub.secretKey,
      eventPatterns: sub.eventPatterns || ['*'],
      customHeadersJson: JSON.stringify(sub.customHeaders || {}, null, 2),
      isActive: sub.isActive,
      retryLimit: sub.retryLimit || 3,
      timeoutMs: sub.timeoutMs || 5000
    });
    setPingResult(null);
    setIsModalOpen(true);
  };

  const handleSaveSubscription = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim() || !formData.targetUrl.trim()) {
      showToast('نام درگاه و آدرس URL مقصد الزامی است.', 'error');
      return;
    }

    let parsedHeaders = {};
    try {
      if (formData.customHeadersJson.trim()) {
        parsedHeaders = JSON.parse(formData.customHeadersJson);
      }
    } catch (err) {
      showToast('فرمت JSON هدرهای سفارشی نامعتبر است.', 'error');
      return;
    }

    const payload = {
      name: formData.name.trim(),
      targetUrl: formData.targetUrl.trim(),
      secretKey: formData.secretKey.trim(),
      eventPatterns: formData.eventPatterns,
      customHeaders: parsedHeaders,
      isActive: formData.isActive,
      retryLimit: Number(formData.retryLimit),
      timeoutMs: Number(formData.timeoutMs)
    };

    try {
      const url = editingSub ? `/events/webhooks/${editingSub.id}` : '/events/webhooks';
      const method = editingSub ? 'PUT' : 'POST';

      const data = await fetchJson<{ success?: boolean; message?: string }>(url, {
        method,
        body: JSON.stringify(payload)
      });

      if (data?.success) {
        showToast(data.message || 'درگاه وب‌هوک با موفقیت ذخیره شد.', 'success');
        setIsModalOpen(false);
        fetchStats();
        fetchSubscriptions();
      } else {
        showToast(data?.message || 'خطا در ذخیره‌سازی وب‌هوک', 'error');
      }
    } catch (err) {
      showToast('خطای شبکه در ذخیره‌سازی', 'error');
    }
  };

  const handleToggleActive = async (sub: WebhookSubscription) => {
    try {
      const data = await fetchJson<{ success?: boolean; message?: string }>(`/events/webhooks/${sub.id}/toggle`, {
        method: 'POST'
      });
      if (data?.success) {
        showToast(data.message || 'وضعیت با موفقیت به‌روزرسانی شد.', 'success');
        fetchSubscriptions();
        fetchStats();
      }
    } catch (err) {
      showToast('خطا در تغییر وضعیت وب‌هوک', 'error');
    }
  };

  const handleDeleteSubscription = async (id: number) => {
    if (!(await confirmAction({ title: 'حذف درگاه وب‌هوک', message: 'آیا از حذف این درگاه وب‌هوک اطمینان دارید؟' }))) return;
    try {
      const data = await fetchJson<{ success?: boolean }>(`/events/webhooks/${id}`, {
        method: 'DELETE'
      });
      if (data?.success) {
        showToast('درگاه وب‌هوک با موفقیت حذف شد.', 'success');
        fetchSubscriptions();
        fetchStats();
      }
    } catch (err) {
      showToast('خطا در حذف وب‌هوک', 'error');
    }
  };

  const handlePingTest = async (targetUrl: string, secretKey: string, subId?: number) => {
    if (subId) setPingTestingId(subId);
    setPingResult(null);
    try {
      const data = await fetchJson<{ success?: boolean; statusCode?: number; durationMs?: number; message?: string }>('/events/webhooks/ping', {
        method: 'POST',
        body: JSON.stringify({ targetUrl, secretKey })
      });
      setPingResult(data);
      if (data?.success) {
        showToast(`تست پینگ موفق (${data.statusCode} OK) - تاخیر: ${data.durationMs}ms`, 'success');
      } else {
        showToast(data?.message || 'خطا در تست پینگ وب‌هوک', 'error');
      }
    } catch (err) {
      showToast('خطای ارتباط در تست پینگ', 'error');
    } finally {
      if (subId) setPingTestingId(null);
    }
  };

  const copySecretKey = (id: number, key: string) => {
    navigator.clipboard.writeText(key);
    setCopiedKeyId(id);
    showToast('کلید امنیتی با موفقیت در کلیپ‌بورد کپی شد.', 'success');
    setTimeout(() => setCopiedKeyId(null), 2500);
  };

  const toggleEventPattern = (pattern: string) => {
    let current = [...formData.eventPatterns];
    if (pattern === '*') {
      setFormData({ ...formData, eventPatterns: ['*'] });
      return;
    }

    current = current.filter(p => p !== '*');
    if (current.includes(pattern)) {
      current = current.filter(p => p !== pattern);
      if (current.length === 0) current = ['*'];
    } else {
      current.push(pattern);
    }
    setFormData({ ...formData, eventPatterns: current });
  };

  return (
    <div className="space-y-6" id="webhook-management-tab">
      {/* Toast */}
      {toast && (
        <div
          className={`p-4 rounded-xl shadow-lg border flex items-center justify-between text-sm transition-all duration-300 ${
            toast.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800 dark:bg-emerald-950/40 dark:border-emerald-800/50 dark:text-emerald-300'
              : 'bg-rose-50 border-rose-200 text-rose-800 dark:bg-rose-950/40 dark:border-rose-800/50 dark:text-rose-300'
          }`}
        >
          <div className="flex items-center gap-2">
            {toast.type === 'success' ? <CheckCircle2 className="w-5 h-5" /> : <AlertTriangle className="w-5 h-5" />}
            <span className="font-medium">{toast.text}</span>
          </div>
          <button onClick={() => setToast(null)} className="text-xs opacity-70 hover:opacity-100">
            بستن
          </button>
        </div>
      )}

      {/* Metrics Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">کل اشتراک‌های وب‌هوک</span>
            <div className="p-2 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 rounded-xl">
              <Globe className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-2 text-2xl font-bold text-slate-900 dark:text-white">
            {stats ? stats.totalSubscriptions.toLocaleString('fa-IR') : '۰'}
          </div>
          <p className="text-xs text-slate-400 mt-1">درگاه‌های بیرونی ثبت‌شده</p>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">درگاه‌های فعال</span>
            <div className="p-2 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 rounded-xl">
              <Activity className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-2 text-2xl font-bold text-slate-900 dark:text-white">
            {stats ? stats.activeSubscriptions.toLocaleString('fa-IR') : '۰'}
          </div>
          <p className="text-xs text-slate-400 mt-1">دریافت‌کننده رویدادهای زنده</p>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">کل درخواست‌های ارسالی</span>
            <div className="p-2 bg-purple-50 dark:bg-purple-950/40 text-purple-600 dark:text-purple-400 rounded-xl">
              <Send className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-2 text-2xl font-bold text-slate-900 dark:text-white">
            {stats ? stats.totalDeliveries.toLocaleString('fa-IR') : '۰'}
          </div>
          <p className="text-xs text-slate-400 mt-1">بسته‌های رویداد تحویل داده‌شده</p>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">نرخ موفقیت تحویل</span>
            <div className="p-2 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 rounded-xl">
              <Shield className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-2 text-2xl font-bold text-emerald-600 dark:text-emerald-400">
            {stats ? `%${stats.successRate.toLocaleString('fa-IR')}` : '%۱۰۰'}
          </div>
          <p className="text-xs text-slate-400 mt-1">همراه با اعتبارسنجی امضای SHA256</p>
        </div>
      </div>

      {/* Control Action Bar */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
        <div>
          <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Globe className="w-4 h-4 text-indigo-500" />
            <span>درگاه‌های وب‌هوک و اشتراک سرویس‌های بیرونی</span>
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            ارسال Real-time رویدادهای دامنه‌ای به سامانه‌های خارجی (ووکامرس، لجستیک، حسابداری ابری) با امضای HMAC-SHA256.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              fetchStats();
              fetchSubscriptions();
              fetchDeliveries();
            }}
            className="p-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-xl transition-all"
            title="به‌روزرسانی داده‌ها"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>

          <button
            onClick={openCreateModal}
            className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-xl shadow-md transition-all flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            <span>تعریف وب‌هوک جدید</span>
          </button>
        </div>
      </div>

      {/* Subscriptions List */}
      <div className="space-y-4">
        {subscriptions.length === 0 ? (
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-12 text-center text-slate-400">
            <Globe className="w-8 h-8 text-slate-300 dark:text-slate-600 mx-auto mb-2" />
            هنوز هیچ درگاه وب‌هوکی تعریف نشده است. با کلیک بر روی "تعریف وب‌هوک جدید" اولین درگاه خود را بسازید.
          </div>
        ) : (
          subscriptions.map(sub => {
            const isTestingPing = pingTestingId === sub.id;

            return (
              <div
                key={sub.id}
                className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm space-y-4 hover:border-slate-300 dark:hover:border-slate-700 transition-all"
              >
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-bold text-slate-900 dark:text-white">{sub.name}</span>
                      <button
                        onClick={() => handleToggleActive(sub)}
                        className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full flex items-center gap-1 transition-all ${
                          sub.isActive === 1
                            ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                            : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 border border-slate-200 dark:border-slate-700'
                        }`}
                      >
                        {sub.isActive === 1 ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                        <span>{sub.isActive === 1 ? 'فعال' : 'غیرفعال'}</span>
                      </button>
                    </div>

                    <div className="text-xs text-slate-500 font-mono flex items-center gap-1 dir-ltr text-left">
                      <span className="truncate max-w-md">{sub.targetUrl}</span>
                    </div>
                  </div>

                  {/* Actions & Buttons */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      onClick={() => handlePingTest(sub.targetUrl, sub.secretKey, sub.id)}
                      disabled={isTestingPing}
                      className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-medium rounded-xl transition-all flex items-center gap-1.5"
                    >
                      <Send className={`w-3.5 h-3.5 ${isTestingPing ? 'animate-spin' : ''}`} />
                      <span>تست پینگ و امضا</span>
                    </button>

                    <button
                      onClick={() => {
                        setSelectedSubForDeliveries(selectedSubForDeliveries === sub.id ? null : sub.id);
                        fetchDeliveries(selectedSubForDeliveries === sub.id ? undefined : sub.id);
                      }}
                      className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/50 dark:hover:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 text-xs font-medium rounded-xl transition-all flex items-center gap-1.5"
                    >
                      <Activity className="w-3.5 h-3.5" />
                      <span>لاگ تحویل ({sub.totalDeliveries || 0})</span>
                    </button>

                    <button
                      onClick={() => openEditModal(sub)}
                      className="p-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-xl"
                      title="ویرایش تنظیمات"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>

                    <button
                      onClick={() => handleDeleteSubscription(sub.id)}
                      className="p-2 bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/40 dark:hover:bg-rose-900/40 text-rose-600 dark:text-rose-400 rounded-xl"
                      title="حذف درگاه"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Sub Metadata Row */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 pt-3 border-t border-slate-100 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-400">
                  {/* HMAC Secret Key */}
                  <div className="flex items-center justify-between p-2.5 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200/60 dark:border-slate-700/60">
                    <div className="flex items-center gap-1.5 overflow-hidden">
                      <Key className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                      <span className="font-mono text-[11px] truncate text-slate-700 dark:text-slate-300 dir-ltr text-left">
                        {sub.secretKey}
                      </span>
                    </div>
                    <button
                      onClick={() => copySecretKey(sub.id, sub.secretKey)}
                      className="p-1 text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 rounded"
                      title="کپی کلید امنیتی"
                    >
                      {copiedKeyId === sub.id ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>

                  {/* Patterns */}
                  <div className="p-2.5 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200/60 dark:border-slate-700/60 flex items-center gap-1.5 overflow-x-auto">
                    <span className="text-[11px] text-slate-400 shrink-0">رویدادها:</span>
                    {sub.eventPatterns.map((p, idx) => (
                      <span
                        key={idx}
                        className="font-mono text-[10px] px-2 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 shrink-0"
                      >
                        {p}
                      </span>
                    ))}
                  </div>

                  {/* Delivery Status */}
                  <div className="p-2.5 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200/60 dark:border-slate-700/60 flex items-center justify-between">
                    <span className="text-[11px] text-slate-400">آخرین تحویل:</span>
                    <span className="font-medium text-slate-800 dark:text-slate-200 text-[11px]">
                      {sub.lastDeliveryAt ? formatPersianDate(sub.lastDeliveryAt) : 'بدون ارسال'}
                    </span>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Deliveries Log Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <Send className="w-4 h-4 text-indigo-500" />
            <h4 className="text-sm font-bold text-slate-900 dark:text-white">
              لاگ‌های اخیر تحویل وب‌هوک (Webhook Deliveries)
            </h4>
          </div>
          <button
            onClick={() => fetchDeliveries(selectedSubForDeliveries || undefined)}
            className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1"
          >
            <RefreshCw className="w-3 h-3" />
            <span>تازه‌سازی لاگ‌ها</span>
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead className="bg-slate-50/80 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="p-2.5 font-semibold">درگاه</th>
                <th className="p-2.5 font-semibold">نوع رویداد</th>
                <th className="p-2.5 font-semibold">کد وضعیت</th>
                <th className="p-2.5 font-semibold">وضعیت</th>
                <th className="p-2.5 font-semibold">تاخیر (Latency)</th>
                <th className="p-2.5 font-semibold">امضای ارسالی</th>
                <th className="p-2.5 font-semibold">زمان ارسال</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
              {deliveries.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-slate-400">
                    هنوز لاگ تحویلی ثبت نشده است.
                  </td>
                </tr>
              ) : (
                deliveries.map(deliv => (
                  <tr key={deliv.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                    <td className="p-2.5 font-medium text-slate-900 dark:text-white">{deliv.subscriptionName}</td>
                    <td className="p-2.5 font-mono text-[11px] text-indigo-600 dark:text-indigo-400">{deliv.eventType}</td>
                    <td className="p-2.5 font-mono font-bold">
                      <span
                        className={
                          deliv.statusCode >= 200 && deliv.statusCode < 300
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-rose-600 dark:text-rose-400'
                        }
                      >
                        {deliv.statusCode || 'N/A'}
                      </span>
                    </td>
                    <td className="p-2.5">
                      {deliv.status === 'success' ? (
                        <span className="text-emerald-600 dark:text-emerald-400 font-medium">موفق</span>
                      ) : deliv.status === 'timeout' ? (
                        <span className="text-amber-600 dark:text-amber-400 font-medium">Timeout</span>
                      ) : (
                        <span className="text-rose-600 dark:text-rose-400 font-medium">ناموفق</span>
                      )}
                    </td>
                    <td className="p-2.5 font-mono text-slate-500">{deliv.durationMs}ms</td>
                    <td className="p-2.5 font-mono text-[10px] text-slate-400 max-w-[120px] truncate" title={deliv.signature}>
                      {deliv.signature ? deliv.signature.substring(0, 16) + '...' : '-'}
                    </td>
                    <td className="p-2.5 text-slate-400">{formatPersianDate(deliv.createdAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal: Create/Edit Subscription */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 max-w-2xl w-full shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <Globe className="w-4 h-4 text-indigo-500" />
                  {editingSub ? `ویرایش درگاه وب‌هوک "${editingSub.name}"` : 'تعریف درگاه جدید وب‌هوک (Webhook Subscription)'}
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  پیکربندی آدرس مقصد، رویدادهای مشترک و کلید امنیتی جهت امضای HMAC-SHA256
                </p>
              </div>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveSubscription} className="space-y-4 text-xs">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="font-semibold text-slate-700 dark:text-slate-300">نام یا عنوان سامانه مقصد:</label>
                  <input
                    type="text"
                    required
                    placeholder="مثال: فروشگاه آنلاین ووکامرس"
                    value={formData.name}
                    onChange={e => setFormData({ ...formData, name: e.target.value })}
                    className="w-full bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/60 rounded-xl px-3.5 py-2.5 text-slate-800 dark:text-slate-200 focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-semibold text-slate-700 dark:text-slate-300">کلید سری امضا (HMAC Secret Key):</label>
                  <div className="relative">
                    <input
                      type="text"
                      required
                      value={formData.secretKey}
                      onChange={e => setFormData({ ...formData, secretKey: e.target.value })}
                      className="w-full font-mono text-[11px] bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/60 rounded-xl px-3.5 py-2.5 text-slate-800 dark:text-slate-200 focus:outline-none focus:border-indigo-500 dir-ltr text-left"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setFormData({
                          ...formData,
                          secretKey: `whsec_${Math.random().toString(36).substring(2, 10)}${Math.random().toString(36).substring(2, 10)}`
                        })
                      }
                      className="absolute right-2 top-2 p-1 text-[10px] text-indigo-600 dark:text-indigo-400 hover:underline"
                    >
                      تولید جدید
                    </button>
                  </div>
                </div>
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-slate-700 dark:text-slate-300">آدرس URL مقصد (Endpoint URL):</label>
                <div className="flex items-center gap-2">
                  <input
                    type="url"
                    required
                    placeholder="https://your-domain.com/api/webhook/receiver"
                    value={formData.targetUrl}
                    onChange={e => setFormData({ ...formData, targetUrl: e.target.value })}
                    className="flex-1 font-mono text-[11px] bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/60 rounded-xl px-3.5 py-2.5 text-slate-800 dark:text-slate-200 focus:outline-none focus:border-indigo-500 dir-ltr text-left"
                  />
                  <button
                    type="button"
                    onClick={() => handlePingTest(formData.targetUrl, formData.secretKey)}
                    className="px-3 py-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl font-medium"
                  >
                    تست اتصال
                  </button>
                </div>
              </div>

              {/* Event Subscriptions Presets */}
              <div className="space-y-2">
                <label className="font-semibold text-slate-700 dark:text-slate-300">
                  رویدادهای مورد اشتراک (Event Filter Patterns):
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-44 overflow-y-auto p-2 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200 dark:border-slate-800">
                  {AVAILABLE_EVENT_PRESETS.map(preset => {
                    const isChecked = formData.eventPatterns.includes(preset.pattern);
                    return (
                      <button
                        type="button"
                        key={preset.pattern}
                        onClick={() => toggleEventPattern(preset.pattern)}
                        className={`p-2 rounded-lg text-right transition-all flex items-center justify-between border ${
                          isChecked
                            ? 'bg-indigo-50 dark:bg-indigo-950/60 border-indigo-300 dark:border-indigo-700 text-indigo-900 dark:text-indigo-200 font-bold'
                            : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400'
                        }`}
                      >
                        <span className="text-[11px]">{preset.label}</span>
                        <span className="font-mono text-[10px] opacity-70">[{preset.pattern}]</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Custom Headers JSON */}
              <div className="space-y-1">
                <label className="font-semibold text-slate-700 dark:text-slate-300">هدرهای سفارشی HTTP (Custom Headers):</label>
                <textarea
                  rows={3}
                  value={formData.customHeadersJson}
                  onChange={e => setFormData({ ...formData, customHeadersJson: e.target.value })}
                  className="w-full font-mono text-[11px] p-2.5 bg-slate-950 text-emerald-400 rounded-xl border border-slate-800 focus:outline-none focus:border-indigo-500 dir-ltr text-left"
                />
              </div>

              {/* Advanced Settings Row */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="font-semibold text-slate-700 dark:text-slate-300">سقف تلاش مجدد:</label>
                  <input
                    type="number"
                    min="1"
                    max="10"
                    value={formData.retryLimit}
                    onChange={e => setFormData({ ...formData, retryLimit: parseInt(e.target.value, 10) || 3 })}
                    className="w-full bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/60 rounded-xl px-3 py-2 text-slate-800 dark:text-slate-200"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-semibold text-slate-700 dark:text-slate-300">مهلت پاسخ (میلی‌ثانیه):</label>
                  <input
                    type="number"
                    min="1000"
                    max="30000"
                    step="500"
                    value={formData.timeoutMs}
                    onChange={e => setFormData({ ...formData, timeoutMs: parseInt(e.target.value, 10) || 5000 })}
                    className="w-full bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/60 rounded-xl px-3 py-2 text-slate-800 dark:text-slate-200"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-semibold text-slate-700 dark:text-slate-300">وضعیت درگاه:</label>
                  <select
                    value={formData.isActive}
                    onChange={e => setFormData({ ...formData, isActive: parseInt(e.target.value, 10) })}
                    className="w-full bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/60 rounded-xl px-3 py-2 text-slate-800 dark:text-slate-200"
                  >
                    <option value={1}>فعال و آماده دریافت رویداد</option>
                    <option value={0}>غیرفعال</option>
                  </select>
                </div>
              </div>

              {/* Form Action Buttons */}
              <div className="flex items-center justify-between pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl"
                >
                  انصراف
                </button>

                <button
                  type="submit"
                  className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl shadow-md font-semibold transition-all"
                >
                  {editingSub ? 'ذخیره تغییرات درگاه' : 'ایجاد و فعال‌سازی درگاه وب‌هوک'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
