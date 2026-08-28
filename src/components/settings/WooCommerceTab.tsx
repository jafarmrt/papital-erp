import React, { useState } from 'react';
import { FolderTree, ShoppingBag, Copy, Check, RefreshCw, Key, ShieldCheck, Database, FileText, AlertTriangle } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { formatPersianDateTime } from '../../utils';

interface WooCommerceTabProps {
  wcStoreUrl: string;
  setWcStoreUrl: (v: string) => void;
  wcConsumerKey: string;
  setWcConsumerKey: (v: string) => void;
  wcConsumerSecret: string;
  setWcConsumerSecret: (v: string) => void;
  wcWebhookSecret: string;
  setWcWebhookSecret: (v: string) => void;
  handleSaveSettings: () => void;
  isSaving: boolean;
  handleTestWcConnection: () => void;
  isTestingWc: boolean;
  manualOrderId: string;
  setManualOrderId: (v: string) => void;
  isSyncingManualOrder: boolean;
  handleSyncManualOrder: (e: React.FormEvent) => void;
  syncedWcOrders: any[];
  wcOrderLogs: any[];
  loadSyncedWcOrders: () => void;
  handleSyncAllStocks: () => void;
  isSyncingAllStocks: boolean;
}

export const WooCommerceTab: React.FC<WooCommerceTabProps> = ({
  wcStoreUrl,
  setWcStoreUrl,
  wcConsumerKey,
  setWcConsumerKey,
  wcConsumerSecret,
  setWcConsumerSecret,
  wcWebhookSecret,
  setWcWebhookSecret,
  handleSaveSettings,
  isSaving,
  handleTestWcConnection,
  isTestingWc,
  manualOrderId,
  setManualOrderId,
  isSyncingManualOrder,
  handleSyncManualOrder,
  syncedWcOrders,
  wcOrderLogs,
  loadSyncedWcOrders,
  handleSyncAllStocks,
  isSyncingAllStocks,
}) => {
  const [copiedWebhook, setCopiedWebhook] = useState(false);
  const [activeLogSubTab, setActiveLogSubTab] = useState<'audit_logs' | 'invoices'>('audit_logs');

  // Generate public webhook URL
  const origin = window.location.origin.replace('ais-dev-', 'ais-pre-');
  const webhookUrl = `${origin}/api/woocommerce/webhook/order`;

  const handleCopyWebhook = () => {
    navigator.clipboard.writeText(webhookUrl);
    setCopiedWebhook(true);
    toast.success('آدرس وب‌هوک کپی شد');
    setTimeout(() => setCopiedWebhook(false), 2500);
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-xs p-6 max-w-4xl mx-auto space-y-8 font-farsi">
      {/* SECTION 1: Store Credentials */}
      <div>
        <h3 className="font-bold border-b border-slate-200 pb-3 mb-6 text-slate-800 text-base flex items-center gap-2">
          <FolderTree size={18} className="text-blue-600" />
          تنظیمات اتصال به فروشگاه ووکامرس (WooCommerce REST API)
        </h3>
        <p className="text-sm text-slate-500 mb-6 leading-relaxed">
          برای اتصال سیستم به فروشگاه وردپرسی، آدرس سایت و کلیدهای دسترسی (Consumer Key و Consumer Secret) را که از مسیر{' '}
          <strong>ووکامرس &gt; پیکربندی &gt; پیشرفته &gt; REST API</strong> دریافت کرده‌اید وارد کنید.
        </p>

        <div className="grid md:grid-cols-2 gap-6 mb-6">
          <div className="md:col-span-2">
            <label className="block text-sm font-medium mb-1 text-slate-700">آدرس سایت (URL)</label>
            <input
              type="url"
              value={wcStoreUrl}
              onChange={(e) => setWcStoreUrl(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 bg-slate-50 border-slate-300 text-sm focus:ring-2 focus:ring-blue-500/50 outline-none text-left"
              placeholder="https://yoursite.com"
              dir="ltr"
            />
            <p className="text-xs text-slate-500 mt-1">آدرس اصلی سایت بدون / در انتها.</p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1 text-slate-700">کلید مشتری (Consumer Key)</label>
            <input
              type="password"
              value={wcConsumerKey}
              onChange={(e) => setWcConsumerKey(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 bg-slate-50 border-slate-300 text-sm focus:ring-2 focus:ring-blue-500/50 outline-none font-mono text-left"
              placeholder="ck_..."
              dir="ltr"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1 text-slate-700">رمز مشتری (Consumer Secret)</label>
            <input
              type="password"
              value={wcConsumerSecret}
              onChange={(e) => setWcConsumerSecret(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 bg-slate-50 border-slate-300 text-sm focus:ring-2 focus:ring-blue-500/50 outline-none font-mono text-left"
              placeholder="cs_..."
              dir="ltr"
            />
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-4 border-t border-slate-100 mb-8">
          <button
            onClick={handleTestWcConnection}
            disabled={isTestingWc || isSaving}
            className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-6 py-2.5 rounded-lg text-sm font-medium transition-colors shadow-sm border border-slate-200 disabled:opacity-50 flex items-center gap-2"
          >
            {isTestingWc ? (
              <div className="w-4 h-4 border-2 border-slate-400 border-t-transparent rounded-full animate-spin"></div>
            ) : (
              <div className="w-4 h-4 flex items-center justify-center">🌐</div>
            )}
            تست اتصال به سایت
          </button>
          <button
            onClick={handleSaveSettings}
            disabled={isSaving || isTestingWc}
            className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 rounded-lg text-sm font-medium transition-colors shadow-sm disabled:opacity-50"
          >
            {isSaving ? 'در حال ذخیره...' : 'ذخیره تنظیمات ووکامرس'}
          </button>
        </div>
      </div>

      {/* SECTION 2: Webhook & Security HMAC */}
      <div className="bg-blue-50/60 border border-blue-200 rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between border-b border-blue-200/80 pb-3">
          <div className="font-bold text-blue-950 text-sm flex items-center gap-2">
            <ShoppingBag size={18} className="text-blue-600" />
            همگام‌سازی دوطرفه خودکار و امنیت وب‌هوک (HMAC SHA-256)
          </div>
          <span className="bg-blue-100 text-blue-800 text-[11px] font-semibold px-2.5 py-0.5 rounded-full flex items-center gap-1">
            <ShieldCheck size={12} />
            HMAC & Idempotency
          </span>
        </div>

        <p className="text-xs text-blue-900 leading-relaxed">
          جهت ثبت خودکار فاکتور فروش و کسر از موجودی انبار به محض خرید مشتری در سایت، آدرس وب‌هوک زیر را در ووکامرس وارد کنید:
        </p>

        <div className="flex items-center gap-2 bg-white border border-blue-200 rounded-lg p-2">
          <input
            type="text"
            readOnly
            value={webhookUrl}
            className="w-full text-xs font-mono text-slate-700 bg-transparent outline-none dir-ltr"
          />
          <button
            onClick={handleCopyWebhook}
            className="bg-blue-600 hover:bg-blue-700 text-white text-xs px-3 py-1.5 rounded flex items-center gap-1.5 transition-colors shrink-0 font-medium"
          >
            {copiedWebhook ? <Check size={14} /> : <Copy size={14} />}
            {copiedWebhook ? 'کپی شد' : 'کپی آدرس وب‌هوک'}
          </button>
        </div>

        {/* HMAC Secret Config */}
        <div className="bg-white/90 border border-blue-200 rounded-lg p-3 space-y-2">
          <label className="block text-xs font-bold text-blue-950 flex items-center gap-1.5">
            <Key size={14} className="text-amber-600" />
            کلید محرمانه امضای دیجیتال وب‌هوک (Webhook Secret Key)
          </label>
          <input
            type="text"
            value={wcWebhookSecret}
            onChange={(e) => setWcWebhookSecret(e.target.value)}
            className="w-full border border-slate-300 rounded px-3 py-1.5 text-xs font-mono bg-slate-50 text-left outline-none focus:ring-1 focus:ring-blue-500"
            placeholder="کد محرمانه ایجادشده در ووکامرس (اختیاری جهت راستی‌آزمایی HMAC SHA-256)"
            dir="ltr"
          />
          <p className="text-[11px] text-slate-500 leading-normal">
            در صورت تنظیم این کلید در ووکامرس و سیستم، تمام وب‌هوک‌های دریافتی از نظر اصالت فرستنده با امضای HMAC SHA-256 اعتبارسنجی می‌شوند.
          </p>
        </div>

        <div className="bg-white/80 rounded-lg p-3 text-xs text-blue-900 space-y-1.5 border border-blue-100">
          <div className="font-semibold text-blue-950 mb-1">📋 مراحل ثبت وب‌هوک در ووکامرس:</div>
          <ol className="list-decimal list-inside space-y-1 leading-relaxed text-blue-800">
            <li>در پیشخوان وردپرس به مسیر <strong>ووکامرس &gt; پیکربندی &gt; پیشرفته &gt; وب‌هوک‌ها (Webhooks)</strong> بروید.</li>
            <li>روی دکمه <strong>«افزودن وب‌هوک»</strong> کلیک کنید.</li>
            <li><strong>نام:</strong> دلخواه (مثلاً: <code>همگام‌سازی فاکتور انبار</code>)، <strong>وضعیت:</strong> <code>فعال (Active)</code>.</li>
            <li><strong>موضوع (Topic):</strong> گزینه‌ی <code>سفارش ایجاد شد (Order Created)</code> یا <code>سفارش بروزرسانی شد</code> را انتخاب کنید.</li>
            <li><strong>نشانی تحویل (Delivery URL):</strong> آدرس وب‌هوک عمومی کپی‌شده در بالا را پیست کنید.</li>
            <li><strong>کد محرمانه (Secret):</strong> در صورت تمایل همان کدی که در کادر بالا وارد کردید را در ووکامرس بگذارید.</li>
          </ol>
        </div>
      </div>

      {/* SECTION 3: Bulk Stock Sync & Manual Order Sync */}
      <div className="grid md:grid-cols-2 gap-6">
        {/* Bulk Sync */}
        <div className="bg-emerald-50/70 border border-emerald-200 rounded-xl p-5 space-y-3">
          <div className="font-bold text-emerald-950 text-sm flex items-center gap-2">
            <Database size={17} className="text-emerald-600" />
            همگام‌سازی دسته‌ای موجودی کل کالاها (Bulk Sync)
          </div>
          <p className="text-xs text-emerald-900 leading-relaxed">
            بروزرسانی یکباره موجودی انبار تمام محصولات دارای کد SKU در فروشگاه آنلاین ووکامرس:
          </p>
          <button
            onClick={handleSyncAllStocks}
            disabled={isSyncingAllStocks || isSaving}
            className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-medium py-2.5 px-4 rounded-lg text-xs shadow-xs transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {isSyncingAllStocks ? (
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
            ) : (
              <RefreshCw size={14} />
            )}
            {isSyncingAllStocks ? 'در حال ارسال موجودی تمام کالاها...' : 'همگام‌سازی موجودی کل کالاها با سایت'}
          </button>
        </div>

        {/* Manual Order Sync */}
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 space-y-3">
          <div className="font-bold text-slate-800 text-sm flex items-center gap-2">
            <RefreshCw size={16} className="text-blue-600" />
            دریافت دستی سفارش با شماره سفارش
          </div>
          <p className="text-xs text-slate-600 leading-relaxed">
            جهت دریافت دستی یک سفارش و صدور فاکتور فروش، شماره سفارش ووکامرس را وارد کنید:
          </p>
          <form onSubmit={handleSyncManualOrder} className="flex gap-2">
            <input
              type="number"
              value={manualOrderId}
              onChange={(e) => setManualOrderId(e.target.value)}
              placeholder="شماره سفارش (مثلاً 1042)"
              className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-xs bg-white focus:ring-2 focus:ring-blue-500 outline-none"
            />
            <button
              type="submit"
              disabled={isSyncingManualOrder || !manualOrderId.trim()}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-xs font-medium transition-colors disabled:opacity-50 flex items-center gap-1.5 shrink-0"
            >
              {isSyncingManualOrder ? (
                <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              ) : null}
              صدور فاکتور
            </button>
          </form>
        </div>
      </div>

      {/* SECTION 4: Audit Logs & Synced Orders Table */}
      <div className="border border-slate-200 rounded-xl overflow-hidden">
        {/* Sub-tabs header */}
        <div className="bg-slate-100/90 px-4 py-3 border-b border-slate-200 flex flex-wrap justify-between items-center gap-3">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveLogSubTab('audit_logs')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5 ${
                activeLogSubTab === 'audit_logs'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
              }`}
            >
              <FileText size={14} />
              سوابق ممیزی سفارشات ({wcOrderLogs.length})
            </button>
            <button
              onClick={() => setActiveLogSubTab('invoices')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5 ${
                activeLogSubTab === 'invoices'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
              }`}
            >
              <ShoppingBag size={14} />
              فاکتورهای صادرشده ({syncedWcOrders.length})
            </button>
          </div>

          <button
            onClick={loadSyncedWcOrders}
            className="text-xs text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1 bg-white px-2.5 py-1 rounded border border-slate-200 shadow-2xs"
          >
            <RefreshCw size={12} />
            به‌روزرسانی جدول
          </button>
        </div>

        <div className="overflow-x-auto">
          {activeLogSubTab === 'audit_logs' ? (
            <table className="w-full text-right text-xs">
              <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="p-3 font-semibold">کد سفارش ووکامرس</th>
                  <th className="p-3 font-semibold">وضعیت پردازش</th>
                  <th className="p-3 font-semibold">نام خریدار / مبالغ</th>
                  <th className="p-3 font-semibold">فاکتور صادرشده ERP</th>
                  <th className="p-3 font-semibold">زمان بروزرسانی</th>
                  <th className="p-3 font-semibold">جزئیات / خطا</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {wcOrderLogs.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-6 text-center text-slate-400">
                      هنوز هیچ سابقه پردازش سفارشی در سیستم ثبت نشده است.
                    </td>
                  </tr>
                ) : (
                  wcOrderLogs.map((log: any, idx: number) => (
                    <tr key={`wc-log-${log.id || idx}-${idx}`} className="hover:bg-slate-50/80">
                      <td className="p-3 font-mono font-bold text-slate-800 dir-ltr text-right">#{log.wcOrderId}</td>
                      <td className="p-3">
                        {log.status === 'processed' && (
                          <span className="bg-emerald-100 text-emerald-800 text-[11px] px-2 py-0.5 rounded-full font-bold inline-flex items-center gap-1">
                            <Check size={12} /> موفق
                          </span>
                        )}
                        {log.status === 'duplicate' && (
                          <span className="bg-amber-100 text-amber-800 text-[11px] px-2 py-0.5 rounded-full font-bold inline-flex items-center gap-1">
                            <RefreshCw size={12} /> تکراری (نادیاده گرفته شد)
                          </span>
                        )}
                        {log.status === 'failed' && (
                          <span className="bg-rose-100 text-rose-800 text-[11px] px-2 py-0.5 rounded-full font-bold inline-flex items-center gap-1">
                            <AlertTriangle size={12} /> خطا
                          </span>
                        )}
                      </td>
                      <td className="p-3 font-medium">
                        {log.buyerName || 'خریدار آنلاین'}
                        {log.totalAmount ? ` ()` : ''}
                      </td>
                      <td className="p-3 font-mono font-bold text-blue-600 dir-ltr text-right">
                        {log.documentId ? `#${log.documentId}` : '—'}
                      </td>
                      <td className="p-3 text-slate-500 font-mono text-[11px]">
                        {log.createdAt ? formatPersianDateTime(log.createdAt) : '—'}
                      </td>
                      <td className="p-3 text-slate-600 max-w-xs truncate" title={log.errorMessage || ''}>
                        {log.errorMessage ? (
                          <span className="text-rose-600 font-mono text-[11px]">{log.errorMessage}</span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          ) : (
            <table className="w-full text-right text-xs">
              <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="p-3 font-semibold">شماره فاکتور ERP</th>
                  <th className="p-3 font-semibold">توضیحات و شماره سفارش</th>
                  <th className="p-3 font-semibold">نام خریدار</th>
                  <th className="p-3 font-semibold">تاریخ ثبت</th>
                  <th className="p-3 font-semibold text-center">وضعیت</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {syncedWcOrders.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="p-6 text-center text-slate-400">
                      هنوز هیچ سفارشی از ووکامرس ثبت نشده است.
                    </td>
                  </tr>
                ) : (
                  syncedWcOrders.map((doc: any, idx: number) => (
                    <tr key={`wc-doc-${doc.id || idx}-${idx}`} className="hover:bg-slate-50/80">
                      <td className="p-3 font-bold text-blue-600 dir-ltr text-right">#{doc.refNumber}</td>
                      <td className="p-3 font-medium">{doc.notes || 'سفارش ووکامرس'}</td>
                      <td className="p-3">{doc.buyerName || 'خریدار آنلاین'}</td>
                      <td className="p-3 text-slate-500">{doc.date}</td>
                      <td className="p-3 text-center">
                        <span className="bg-emerald-100 text-emerald-800 text-[11px] px-2 py-0.5 rounded-full font-medium">
                          فاکتور و کسر انبار ثبت شد
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Troubleshooting Checklist */}
      <div className="bg-amber-50/70 border border-amber-200/80 rounded-xl p-5 text-xs text-amber-900 space-y-3">
        <div className="font-bold text-sm flex items-center gap-2 text-amber-950">
          <span>🛠️</span>
          راهنمای رفع خطاهای احتمالی و پیش‌نیازهای اتصال به ووکامرس:
        </div>
        <ul className="list-disc list-inside space-y-1.5 leading-relaxed text-amber-800">
          <li>
            <strong>دسترسی کلید API:</strong> هنگام ساخت کلید در مسیر <em>ووکامرس &gt; پیکربندی &gt; پیشرفته &gt; REST API</em>، حتماً دسترسی را روی <strong>«خواندن/نوشتن» (Read/Write)</strong> قرار دهید.
          </li>
          <li>
            <strong>پیوندهای یکتا (Permalinks):</strong> در پیشخوان وردپرس به مسیر <em>تنظیمات &gt; پیوندهای یکتا</em> بروید و آن را روی حالت <strong>«نام نوشته» (Post Name)</strong> ذخیره کنید. (روی حالت «ساده» API کار نمی‌کند).
          </li>
          <li>
            <strong>تطابق کد محصول (SKU):</strong> برای کسر خودکار انبار، کد کالای تعریف شده در ERP باید با کد محصول (SKU) در سایت وردپرسی یکسان باشد.
          </li>
        </ul>
      </div>
    </div>
  );
};
