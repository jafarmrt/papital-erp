import React, { useState, useEffect } from 'react';
import { 
  X, 
  Plus, 
  Trash2, 
  Globe, 
  Bell, 
  Smartphone, 
  GitBranch, 
  ShieldCheck, 
  HelpCircle, 
  Play, 
  CheckCircle2, 
  AlertCircle,
  XCircle,
  Code
} from 'lucide-react';
import { fetchJson } from '../../api';

export interface RuleCondition {
  field: string;
  operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'contains' | 'exists';
  value: any;
}

export interface RuleFormData {
  id?: number;
  name: string;
  description: string;
  eventType: string;
  conditionsJson: RuleCondition[];
  actionType: 'webhook' | 'in_app_notification' | 'workflow_trigger' | 'sms_simulation' | 'audit_log';
  actionConfigJson: any;
  isActive: number;
}

interface RuleEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (rule: RuleFormData) => Promise<void>;
  initialRule?: RuleFormData | null;
}

const EVENT_TYPE_OPTIONS = [
  { value: 'InvoiceApproved', label: 'InvoiceApproved (تایید نهایی فاکتور فروش)', category: 'فروش و فاکتور' },
  { value: 'InvoiceCreated', label: 'InvoiceCreated (ثبت فاکتور/پیش‌فاکتور جدید)', category: 'فروش و فاکتور' },
  { value: 'InvoiceCancelled', label: 'InvoiceCancelled (ابطال یا لغو فاکتور)', category: 'فروش و فاکتور' },
  { value: 'PurchaseApproved', label: 'PurchaseApproved (تایید فاکتور خرید / ورودی انبار)', category: 'خرید و تدارکات' },
  { value: 'StockReceived', label: 'StockReceived (ورود کالا به انبار)', category: 'انبارداری' },
  { value: 'StockIssued', label: 'StockIssued (خروج کالا یا صدور حواله انبار)', category: 'انبارداری' },
  { value: 'InventoryReorderAlert', label: 'InventoryReorderAlert (هشدار رسیدن به نقطه سفارش کالا)', category: 'انبارداری' },
  { value: 'TreasuryTransactionApproved', label: 'TreasuryTransactionApproved (تایید تراکنش مالی خزانه‌داری)', category: 'مالی و خزانه‌داری' },
  { value: 'ChequeStatusChanged', label: 'ChequeStatusChanged (تغییر وضعیت چک صیادی)', category: 'مالی و خزانه‌داری' },
  { value: 'WorkflowTransitioned', label: 'WorkflowTransitioned (تغییر وضعیت یا تایید گام گردش کار)', category: 'گردش کار' },
  { value: 'ProjectStageCompleted', label: 'ProjectStageCompleted (تکمیل مرحله پروژه تولید)', category: 'تولید' },
  { value: 'CustomerCreated', label: 'CustomerCreated (تعریف طرف‌حساب/مشتری جدید)', category: 'مشتریان و CRM' },
  { value: '*', label: '* (کلیه رویدادهای سامانه)', category: 'عمومی' }
];

const SUGGESTED_FIELDS = [
  { value: 'payload.totalAmount', label: 'payload.totalAmount (مبلغ کل فاکتور/تراکنش)' },
  { value: 'payload.newStock', label: 'payload.newStock (موجودی جدید کالا در انبار)' },
  { value: 'payload.reorderPoint', label: 'payload.reorderPoint (نقطه سفارش کالا)' },
  { value: 'payload.toStateKey', label: 'payload.toStateKey (کلید وضعیت مقصد در گردش کار)' },
  { value: 'payload.currency', label: 'payload.currency (ارز: IRR, USD, ...)' },
  { value: 'payload.warehouseLocation', label: 'payload.warehouseLocation (نام انبار)' },
  { value: 'metadata.userRole', label: 'metadata.userRole (نقش کاربر ثبت‌کننده)' },
  { value: 'aggregateType', label: 'aggregateType (نوع موجودیت اصلی)' }
];

export function RuleEditorModal({ isOpen, onClose, onSave, initialRule }: RuleEditorModalProps) {
  const [formData, setFormData] = useState<RuleFormData>({
    name: '',
    description: '',
    eventType: 'InvoiceApproved',
    conditionsJson: [],
    actionType: 'in_app_notification',
    actionConfigJson: {
      targetRole: 'admin',
      titleTemplate: 'اعلان رویداد {{eventType}}',
      messageTemplate: 'رویداد بر روی {{aggregateType}} شماره {{aggregateId}} با موفقیت پردازش شد.',
      linkTemplate: '',
      notifType: 'system'
    },
    isActive: 1
  });

  const [isSaving, setIsSaving] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);
  const [isTesting, setIsTesting] = useState(false);

  useEffect(() => {
    if (initialRule) {
      setFormData({
        id: initialRule.id,
        name: initialRule.name || '',
        description: initialRule.description || '',
        eventType: initialRule.eventType || 'InvoiceApproved',
        conditionsJson: Array.isArray(initialRule.conditionsJson) ? initialRule.conditionsJson : [],
        actionType: initialRule.actionType || 'in_app_notification',
        actionConfigJson: initialRule.actionConfigJson || {},
        isActive: initialRule.isActive !== undefined ? initialRule.isActive : 1
      });
    } else {
      setFormData({
        name: '',
        description: '',
        eventType: 'InvoiceApproved',
        conditionsJson: [],
        actionType: 'in_app_notification',
        actionConfigJson: {
          targetRole: 'admin',
          titleTemplate: 'اعلان رویداد {{eventType}}',
          messageTemplate: 'رویداد بر روی {{aggregateType}} شماره {{aggregateId}} با موفقیت پردازش شد.',
          linkTemplate: '',
          notifType: 'system'
        },
        isActive: 1
      });
    }
    setTestResult(null);
  }, [initialRule, isOpen]);

  if (!isOpen) return null;

  const handleAddCondition = () => {
    setFormData(prev => ({
      ...prev,
      conditionsJson: [
        ...prev.conditionsJson,
        { field: 'payload.totalAmount', operator: 'gt', value: 0 }
      ]
    }));
  };

  const handleRemoveCondition = (index: number) => {
    setFormData(prev => ({
      ...prev,
      conditionsJson: prev.conditionsJson.filter((_, i) => i !== index)
    }));
  };

  const handleConditionChange = (index: number, key: keyof RuleCondition, value: any) => {
    setFormData(prev => {
      const updated = [...prev.conditionsJson];
      updated[index] = { ...updated[index], [key]: value };
      return { ...prev, conditionsJson: updated };
    });
  };

  const handleActionTypeChange = (newType: RuleFormData['actionType']) => {
    let defaultConfig: any = {};
    if (newType === 'webhook') {
      defaultConfig = {
        url: 'https://httpbin.org/post',
        method: 'POST',
        timeoutMs: 5000,
        secretToken: '',
        includeMetadata: true
      };
    } else if (newType === 'in_app_notification') {
      defaultConfig = {
        targetRole: 'admin',
        titleTemplate: 'اعلان رویداد {{eventType}}',
        messageTemplate: 'رویداد با موفقیت در سیستم ثبت گردید.',
        linkTemplate: '',
        notifType: 'system'
      };
    } else if (newType === 'sms_simulation') {
      defaultConfig = {
        recipientPhoneTemplate: '09120000000',
        messageTemplate: 'سازمان: فاکتور {{payload.refNumber}} به مبلغ {{payload.totalAmount}} ریال تایید شد.',
        senderLine: '30009988'
      };
    } else if (newType === 'workflow_trigger') {
      defaultConfig = {
        workflowCode: 'INVOICE_APPROVAL',
        entityType: 'invoice',
        entityIdField: 'payload.documentId',
        commentTemplate: 'شروع خودکار بر پایه رویداد {{eventType}}'
      };
    } else if (newType === 'audit_log') {
      defaultConfig = {
        category: 'رویداد_خودکار',
        tag: 'AUTOMATION_TRIGGER',
        descriptionTemplate: 'اقدام خودکار برای رویداد {{eventType}} اجرا شد.'
      };
    }

    setFormData(prev => ({
      ...prev,
      actionType: newType,
      actionConfigJson: defaultConfig
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) return;

    try {
      setIsSaving(true);
      await onSave(formData);
      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  const handleRunTest = async () => {
    try {
      setIsTesting(true);
      setTestResult(null);

      // V9 Phase 4.1: استفاده از fetchJson استاندارد (ارسال خودکار X-CSRF-Token + پاسخ خطای واقعی)
      // پیش از این خطای سرور به‌صورت خاموش بلعیده و به‌عنوان «موفقیت» جعل می‌شد.
      const data = await fetchJson('/events/action-rules/test-draft', {
        method: 'POST',
        body: JSON.stringify({ rule: formData })
      });
      setTestResult(data);
    } catch (err: any) {
      // نمایش واقعی خطای API — هیچ‌گاه شکست را موفقیت جعل نمی‌کنیم
      setTestResult({
        status: 'error',
        simulated: false,
        message: err?.message || 'اجرای آزمایش قانون با خطا مواجه شد.'
      });
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm overflow-y-auto">
      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden text-right">
        
        {/* Header */}
        <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/70 dark:bg-slate-800/40">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-indigo-600 text-white rounded-2xl shadow-sm">
              <Code className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-800 dark:text-white">
                {formData.id ? 'ویرایش قانون اکشن خودکار' : 'ایجاد قانون اکشن خودکار جدید'}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                تعریف شروط فعال‌سازی و اقدامات خودکار بر پایه رویدادهای سامانه
              </p>
            </div>
          </div>
          <button 
            type="button"
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-6 flex-1 custom-scrollbar">
          
          {/* General Information */}
          <div className="space-y-4">
            <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300 border-r-2 border-indigo-600 pr-2">
              ۱. مشخصات پایه قانون
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5">
                  نام قانون <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="مثال: ارسال وب‌هوک تایید فاکتور فروش"
                  className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-slate-800 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5">
                  رویداد فعال‌کننده <span className="text-rose-500">*</span>
                </label>
                <select
                  value={formData.eventType}
                  onChange={(e) => setFormData(prev => ({ ...prev, eventType: e.target.value }))}
                  className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-slate-800 dark:text-white"
                >
                  {EVENT_TYPE_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5">
                توضیحات تکمیلی
              </label>
              <input
                type="text"
                value={formData.description}
                onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                placeholder="توضیح هدف یا سناریوی تجاری این اقدام خودکار..."
                className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-slate-800 dark:text-white"
              />
            </div>
          </div>

          {/* Conditions Builder */}
          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300 border-r-2 border-indigo-600 pr-2">
                ۲. شروط فیلتر رویداد
              </h4>
              <button
                type="button"
                onClick={handleAddCondition}
                className="inline-flex items-center gap-1 px-3 py-1.5 bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 rounded-xl text-xs font-medium transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>افزودن شرط</span>
              </button>
            </div>

            {formData.conditionsJson.length === 0 ? (
              <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-dashed border-slate-200 dark:border-slate-700 text-center text-xs text-slate-500">
                هیچ شرطی تعریف نشده است؛ اقدام برای تمامی رخدادهای رویداد <span className="font-mono text-indigo-600 font-bold">{formData.eventType}</span> اجرا خواهد شد.
              </div>
            ) : (
              <div className="space-y-2.5">
                {formData.conditionsJson.map((cond, idx) => (
                  <div key={idx} className="flex items-center gap-2 bg-slate-50 dark:bg-slate-800/60 p-3 rounded-2xl border border-slate-200 dark:border-slate-700">
                    
                    {/* Field */}
                    <div className="flex-1">
                      <input
                        type="text"
                        placeholder="فیلد (مثال: payload.totalAmount)"
                        value={cond.field}
                        onChange={(e) => handleConditionChange(idx, 'field', e.target.value)}
                        className="w-full px-2.5 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-mono text-slate-800 dark:text-white"
                      />
                    </div>

                    {/* Operator */}
                    <div className="w-36">
                      <select
                        value={cond.operator}
                        onChange={(e) => handleConditionChange(idx, 'operator', e.target.value as any)}
                        className="w-full px-2.5 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-800 dark:text-white"
                      >
                        <option value="eq">مساوی (=)</option>
                        <option value="neq">مخالف (≠)</option>
                        <option value="gt">بزرگتر (&gt;)</option>
                        <option value="gte">بزرگتر مساوی (&ge;)</option>
                        <option value="lt">کوچکتر (&lt;)</option>
                        <option value="lte">کوچکتر مساوی (&le;)</option>
                        <option value="contains">شامل متن</option>
                        <option value="in">عضو مجموعه</option>
                        <option value="exists">وجود مقدار</option>
                      </select>
                    </div>

                    {/* Value */}
                    <div className="flex-1">
                      <input
                        type="text"
                        placeholder="مقدار مورد انتظار"
                        value={cond.value}
                        onChange={(e) => handleConditionChange(idx, 'value', e.target.value)}
                        className="w-full px-2.5 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-800 dark:text-white"
                      />
                    </div>

                    {/* Delete */}
                    <button
                      type="button"
                      onClick={() => handleRemoveCondition(idx)}
                      className="p-2 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg transition-colors"
                      title="حذف شرط"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Action Configuration */}
          <div className="space-y-4 pt-2">
            <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300 border-r-2 border-indigo-600 pr-2">
              ۳. انتخاب و پیکربندی اقدام
            </h4>

            {/* Action Type Select Buttons */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5">
              {[
                { type: 'in_app_notification', label: 'اعلان درون‌برنامه', icon: Bell, color: 'text-purple-600 bg-purple-50 dark:bg-purple-950/50' },
                { type: 'webhook', label: 'ارسال وب‌هوک', icon: Globe, color: 'text-blue-600 bg-blue-50 dark:bg-blue-950/50' },
                { type: 'sms_simulation', label: 'پیامک هوشمند', icon: Smartphone, color: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/50' },
                { type: 'workflow_trigger', label: 'تحریک گردش کار', icon: GitBranch, color: 'text-amber-600 bg-amber-50 dark:bg-amber-950/50' },
                { type: 'audit_log', label: 'ثبت ممیزی ویژه', icon: ShieldCheck, color: 'text-slate-600 bg-slate-100 dark:bg-slate-800' }
              ].map(item => {
                const isSelected = formData.actionType === item.type;
                const Icon = item.icon;
                return (
                  <button
                    key={item.type}
                    type="button"
                    onClick={() => handleActionTypeChange(item.type as any)}
                    className={`p-3 rounded-2xl border text-center transition-all flex flex-col items-center gap-2 ${
                      isSelected 
                        ? 'border-indigo-600 bg-indigo-50/50 dark:bg-indigo-950/40 ring-2 ring-indigo-500/20' 
                        : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
                    }`}
                  >
                    <div className={`p-2 rounded-xl ${item.color}`}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <span className="text-xs font-bold text-slate-800 dark:text-white">
                      {item.label}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Dynamic Action Config Form */}
            <div className="bg-slate-50 dark:bg-slate-800/40 p-4 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-3">
              
              {/* Webhook Form */}
              {formData.actionType === 'webhook' && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                      آدرس وب‌هوک (URL) <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="url"
                      required
                      value={formData.actionConfigJson?.url || ''}
                      onChange={(e) => setFormData(prev => ({
                        ...prev,
                        actionConfigJson: { ...prev.actionConfigJson, url: e.target.value }
                      }))}
                      placeholder="https://api.yourdomain.com/erp-events"
                      className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-mono text-left dir-ltr text-slate-800 dark:text-white"
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                        متد HTTP
                      </label>
                      <select
                        value={formData.actionConfigJson?.method || 'POST'}
                        onChange={(e) => setFormData(prev => ({
                          ...prev,
                          actionConfigJson: { ...prev.actionConfigJson, method: e.target.value }
                        }))}
                        className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-800 dark:text-white"
                      >
                        <option value="POST">POST</option>
                        <option value="PUT">PUT</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                        مهلت زمانی (میلی‌ثانیه)
                      </label>
                      <input
                        type="number"
                        value={formData.actionConfigJson?.timeoutMs || 5000}
                        onChange={(e) => setFormData(prev => ({
                          ...prev,
                          actionConfigJson: { ...prev.actionConfigJson, timeoutMs: parseInt(e.target.value, 10) || 5000 }
                        }))}
                        className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-800 dark:text-white"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                        توکن امنیتی هدر
                      </label>
                      <input
                        type="text"
                        value={formData.actionConfigJson?.secretToken || ''}
                        onChange={(e) => setFormData(prev => ({
                          ...prev,
                          actionConfigJson: { ...prev.actionConfigJson, secretToken: e.target.value }
                        }))}
                        placeholder="اختیاری..."
                        className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-mono text-slate-800 dark:text-white"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* In-App Notification Form */}
              {formData.actionType === 'in_app_notification' && (
                <div className="space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                        نقش کاربری هدف
                      </label>
                      <select
                        value={formData.actionConfigJson?.targetRole || 'admin'}
                        onChange={(e) => setFormData(prev => ({
                          ...prev,
                          actionConfigJson: { ...prev.actionConfigJson, targetRole: e.target.value }
                        }))}
                        className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-800 dark:text-white"
                      >
                        <option value="admin">مدیر سیستم</option>
                        <option value="warehouse_keeper">انباردار</option>
                        <option value="accountant">حسابدار</option>
                        <option value="sales_manager">مدیر فروش</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                        عنوان اعلان
                      </label>
                      <input
                        type="text"
                        value={formData.actionConfigJson?.titleTemplate || ''}
                        onChange={(e) => setFormData(prev => ({
                          ...prev,
                          actionConfigJson: { ...prev.actionConfigJson, titleTemplate: e.target.value }
                        }))}
                        placeholder="مثال: فاکتور فروش {{payload.refNumber}} تایید شد"
                        className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-800 dark:text-white"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                      قالب متن اعلان (Message Template)
                    </label>
                    <textarea
                      rows={2}
                      value={formData.actionConfigJson?.messageTemplate || ''}
                      onChange={(e) => setFormData(prev => ({
                        ...prev,
                        actionConfigJson: { ...prev.actionConfigJson, messageTemplate: e.target.value }
                      }))}
                      placeholder="متن پیام اعلان همراه با متغیرهایی مانند {{payload.itemName}} یا {{metadata.userName}}"
                      className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-800 dark:text-white"
                    />
                  </div>
                </div>
              )}

              {/* SMS Simulation Form */}
              {formData.actionType === 'sms_simulation' && (
                <div className="space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                        شماره گیرنده یا متغیر
                      </label>
                      <input
                        type="text"
                        value={formData.actionConfigJson?.recipientPhoneTemplate || ''}
                        onChange={(e) => setFormData(prev => ({
                          ...prev,
                          actionConfigJson: { ...prev.actionConfigJson, recipientPhoneTemplate: e.target.value }
                        }))}
                        placeholder="مثال: 09120000000 یا {{payload.customerPhone}}"
                        className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-800 dark:text-white font-mono"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                        سرشماره ارسال پیامک
                      </label>
                      <input
                        type="text"
                        value={formData.actionConfigJson?.senderLine || '30009988'}
                        onChange={(e) => setFormData(prev => ({
                          ...prev,
                          actionConfigJson: { ...prev.actionConfigJson, senderLine: e.target.value }
                        }))}
                        className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-800 dark:text-white font-mono"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                      قالب متن پیامک
                    </label>
                    <textarea
                      rows={2}
                      value={formData.actionConfigJson?.messageTemplate || ''}
                      onChange={(e) => setFormData(prev => ({
                        ...prev,
                        actionConfigJson: { ...prev.actionConfigJson, messageTemplate: e.target.value }
                      }))}
                      placeholder="متن پیامک ارسالی..."
                      className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-800 dark:text-white"
                    />
                  </div>
                </div>
              )}

              {/* Workflow Trigger Form */}
              {formData.actionType === 'workflow_trigger' && (
                <div className="space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                        کد فرآیند گردش کار
                      </label>
                      <input
                        type="text"
                        value={formData.actionConfigJson?.workflowCode || ''}
                        onChange={(e) => setFormData(prev => ({
                          ...prev,
                          actionConfigJson: { ...prev.actionConfigJson, workflowCode: e.target.value }
                        }))}
                        placeholder="مثال: INVOICE_APPROVAL یا MATERIAL_QC"
                        className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-mono text-slate-800 dark:text-white"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                        فیلد شناسه موجودیت
                      </label>
                      <input
                        type="text"
                        value={formData.actionConfigJson?.entityIdField || 'payload.documentId'}
                        onChange={(e) => setFormData(prev => ({
                          ...prev,
                          actionConfigJson: { ...prev.actionConfigJson, entityIdField: e.target.value }
                        }))}
                        className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-mono text-slate-800 dark:text-white"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Audit Log Form */}
              {formData.actionType === 'audit_log' && (
                <div className="space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                        دسته‌بندی ممیزی
                      </label>
                      <input
                        type="text"
                        value={formData.actionConfigJson?.category || ''}
                        onChange={(e) => setFormData(prev => ({
                          ...prev,
                          actionConfigJson: { ...prev.actionConfigJson, category: e.target.value }
                        }))}
                        placeholder="مثال: خزانه‌داری:تراکنش_کلان"
                        className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-800 dark:text-white"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                        برچسب اختصاصی
                      </label>
                      <input
                        type="text"
                        value={formData.actionConfigJson?.tag || ''}
                        onChange={(e) => setFormData(prev => ({
                          ...prev,
                          actionConfigJson: { ...prev.actionConfigJson, tag: e.target.value }
                        }))}
                        placeholder="مثال: HIGH_VALUE"
                        className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-mono text-slate-800 dark:text-white"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Template Variables Helper Guide */}
              <div className="p-3 bg-indigo-50/70 dark:bg-indigo-950/30 rounded-xl text-[11px] text-indigo-700 dark:text-indigo-300 flex items-start gap-2">
                <HelpCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <div>
                  <span className="font-bold">راهنمای استفاده از متغیرهای رویداد در متن‌ها:</span>
                  <div className="mt-1 flex flex-wrap gap-1.5 font-mono text-[10px]">
                    <span className="px-1.5 py-0.5 bg-white dark:bg-slate-900 rounded border border-indigo-200 dark:border-indigo-800">{`{{payload.refNumber}}`}</span>
                    <span className="px-1.5 py-0.5 bg-white dark:bg-slate-900 rounded border border-indigo-200 dark:border-indigo-800">{`{{payload.itemName}}`}</span>
                    <span className="px-1.5 py-0.5 bg-white dark:bg-slate-900 rounded border border-indigo-200 dark:border-indigo-800">{`{{payload.totalAmount}}`}</span>
                    <span className="px-1.5 py-0.5 bg-white dark:bg-slate-900 rounded border border-indigo-200 dark:border-indigo-800">{`{{metadata.userName}}`}</span>
                    <span className="px-1.5 py-0.5 bg-white dark:bg-slate-900 rounded border border-indigo-200 dark:border-indigo-800">{`{{aggregateId}}`}</span>
                  </div>
                </div>
              </div>

            </div>
          </div>

          {/* Test Feedback Area */}
          {testResult && (
            testResult.status === 'error' ? (
              <div className="p-3.5 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/60 rounded-2xl flex items-start gap-2.5 text-xs text-rose-800 dark:text-rose-200">
                <XCircle className="w-4 h-4 mt-0.5 text-rose-600 shrink-0" />
                <div>
                  <span className="font-bold">خطا در تست قانون:</span> {testResult.message}
                </div>
              </div>
            ) : (
              <div className="p-3.5 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 rounded-2xl flex items-start gap-2.5 text-xs text-emerald-800 dark:text-emerald-200">
                <CheckCircle2 className="w-4 h-4 mt-0.5 text-emerald-600 shrink-0" />
                <div>
                  <span className="font-bold">نتیجه تست آنلاین:</span> {testResult.message || 'اقدام با موفقیت شبیه‌سازی و اعتبارسنجی شد.'}
                </div>
              </div>
            )
          )}

          {/* Footer Actions */}
          <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
            <button
              type="button"
              onClick={handleRunTest}
              disabled={isTesting}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-medium transition-colors"
            >
              <Play className="w-3.5 h-3.5" />
              <span>{isTesting ? 'در حال تست...' : 'تست آنلاین قانون'}</span>
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2.5 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl text-xs font-medium transition-colors"
              >
                انصراف
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-sm transition-colors disabled:opacity-50"
              >
                {isSaving ? 'در حال ذخیره‌سازی...' : 'ذخیره قانون خودکار'}
              </button>
            </div>
          </div>

        </form>
      </div>
    </div>
  );
}
