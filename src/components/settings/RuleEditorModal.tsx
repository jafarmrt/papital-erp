import React, { useState, useEffect } from 'react';
import { SYSTEM_ADMIN_ROLE } from '../../lib/permissions/permissionCatalog';
import { NotificationRecipientField } from './NotificationRecipientField';
import { X, Plus, Trash2, Globe, Bell, ShieldCheck, HelpCircle, Play, CheckCircle2, XCircle, AlertTriangle, Code } from 'lucide-react';
import { fetchJson } from '../../api';
import { eventFieldOptions } from '../../lib/eventPayloadFields';
import { EventFieldChips } from './EventFieldChips';
import { isRetiredRuleActionType, retiredRuleActionMessage, type RuleActionType, type StoredRuleActionType } from '../../lib/events/ruleActionTypes';
import { ALL_EVENTS_LABEL, ALL_EVENTS_PATTERN, eventTypeLabel, isSubscribableEventPattern, publishedEventTypesByCategory } from '../../lib/events/eventTypeCatalog';

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
  // v9.0.377 (TD-712): a stored rule may still carry a removed type; the editor offers only live ones
  actionType: StoredRuleActionType;
  actionConfigJson: any;
  isActive: number;
}

interface RuleEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (rule: RuleFormData) => Promise<void>;
  initialRule?: RuleFormData | null;
}

// v9.0.381 (TD-726, decision t3 a): only the event types the server publishes (PUBLISHED_EVENT_TYPES), with Persian labels,
// and «همه رویدادها»; the editor used to offer InvoiceCancelled, ChequeStatusChanged, ProjectStageCompleted and
// CustomerCreated, which nothing publishes, so such a rule never ran
const EVENT_TYPE_GROUPS = publishedEventTypesByCategory();

export function RuleEditorModal({ isOpen, onClose, onSave, initialRule }: RuleEditorModalProps) {
  const [formData, setFormData] = useState<RuleFormData>({
    name: '',
    description: '',
    eventType: 'InvoiceApproved',
    conditionsJson: [],
    actionType: 'in_app_notification',
    actionConfigJson: {
      targetRole: SYSTEM_ADMIN_ROLE,
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
          targetRole: SYSTEM_ADMIN_ROLE,
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

  // v7.0.90 (TD-085 بند ۳): فیلدهای رویداد انتخاب‌شده برای شرط‌ها و متغیرهای متن پیام
  const fieldOptions = eventFieldOptions(formData.eventType);
  const canInsertIntoMessage = formData.actionType === 'in_app_notification';
  const retiredAction = isRetiredRuleActionType(formData.actionType);
  const unpublishedEvent = !isSubscribableEventPattern(formData.eventType);
  const insertIntoMessageTemplate = (path: string) => {
    setFormData(prev => {
      const current = String(prev.actionConfigJson?.messageTemplate || '');
      const separator = current === '' || current.endsWith(' ') ? '' : ' ';
      return { ...prev, actionConfigJson: { ...prev.actionConfigJson, messageTemplate: `${current}${separator}{{${path}}}` } };
    });
  };

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

  const handleActionTypeChange = (newType: RuleActionType) => {
    let defaultConfig: any = {};
    if (newType === 'webhook') {
      defaultConfig = {
        url: '',
        method: 'POST',
        timeoutMs: 5000,
        secretToken: '',
        includeMetadata: true
      };
    } else if (newType === 'in_app_notification') {
      defaultConfig = {
        targetRole: SYSTEM_ADMIN_ROLE,
        titleTemplate: 'اعلان رویداد {{eventType}}',
        messageTemplate: 'رویداد با موفقیت در سیستم ثبت گردید.',
        linkTemplate: '',
        notifType: 'system'
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
                  {unpublishedEvent && (
                    <option value={formData.eventType}>{`${formData.eventType} (در سامانه منتشر نمی‌شود)`}</option>
                  )}
                  <option value={ALL_EVENTS_PATTERN}>{ALL_EVENTS_LABEL}</option>
                  {EVENT_TYPE_GROUPS.map(group => (
                    <optgroup key={group.category} label={group.category}>
                      {group.types.map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                {unpublishedEvent && (
                  <p role="alert" className="mt-1.5 text-[11px] text-amber-700 dark:text-amber-300">
                    سامانه رویداد «{formData.eventType}» را منتشر نمی‌کند و این قانون هرگز اجرا نمی‌شود؛ رویداد دیگری برگزینید.
                  </p>
                )}
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

            <datalist id="rule-event-fields">
              {fieldOptions.map((f) => <option key={f.path} value={f.path}>{f.label}</option>)}
            </datalist>

            {formData.conditionsJson.length === 0 ? (
              <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-dashed border-slate-200 dark:border-slate-700 text-center text-xs text-slate-500">
                هیچ شرطی تعریف نشده است؛ اقدام برای تمامی رخدادهای رویداد <span className="text-indigo-600 font-bold">«{eventTypeLabel(formData.eventType)}»</span> اجرا خواهد شد.
              </div>
            ) : (
              <div className="space-y-2.5">
                {formData.conditionsJson.map((cond, idx) => (
                  <div key={idx} className="flex items-center gap-2 bg-slate-50 dark:bg-slate-800/60 p-3 rounded-2xl border border-slate-200 dark:border-slate-700">
                    
                    {/* Field */}
                    <div className="flex-1">
                      <input
                        type="text"
                        list="rule-event-fields"
                        aria-label="فیلد شرط"
                        placeholder="انتخاب فیلد رویداد یا تایپ مسیر"
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
            {retiredAction && (
              <div role="alert" className="p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 rounded-xl text-xs text-amber-800 dark:text-amber-200 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{retiredRuleActionMessage(formData.actionType)}</span>
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              {[
                { type: 'in_app_notification', label: 'اعلان درون‌برنامه', icon: Bell, color: 'text-purple-600 bg-purple-50 dark:bg-purple-950/50' },
                { type: 'webhook', label: 'ارسال وب‌هوک', icon: Globe, color: 'text-blue-600 bg-blue-50 dark:bg-blue-950/50' },
                { type: 'audit_log', label: 'ثبت ممیزی ویژه', icon: ShieldCheck, color: 'text-slate-600 bg-slate-100 dark:bg-slate-800' }
              ].map(item => {
                const isSelected = formData.actionType === item.type;
                const Icon = item.icon;
                return (
                  <button
                    key={item.type}
                    type="button"
                    onClick={() => handleActionTypeChange(item.type as RuleActionType)}
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
                      {/* v9.0.360 (TD-710): a stored token comes back masked; «********» keeps it on save */}
                      <input
                        type="password"
                        autoComplete="new-password"
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
                    <NotificationRecipientField
                      config={formData.actionConfigJson || {}}
                      onChange={(next) => setFormData(prev => ({ ...prev, actionConfigJson: next }))}
                    />

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
                  <span className="font-bold">متغیرهای این رویداد{canInsertIntoMessage ? " (برای افزودن به متن پیام کلیک کنید)" : ""}:</span>
                  <EventFieldChips
                    fields={fieldOptions}
                    onInsert={canInsertIntoMessage ? insertIntoMessageTemplate : undefined}
                  />
                </div>
              </div>

            </div>
          </div>

          {/* Test Feedback Area: v9.0.377 (TD-712) the server's own evaluation, never a made-up success */}
          {testResult && (
            testResult.status === 'error' ? (
              <div className="p-3.5 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/60 rounded-2xl flex items-start gap-2.5 text-xs text-rose-800 dark:text-rose-200">
                <XCircle className="w-4 h-4 mt-0.5 text-rose-600 shrink-0" />
                <div>
                  <span className="font-bold">خطا در تست قانون:</span> {testResult.message}
                </div>
              </div>
            ) : testResult.conditionMatches === false ? (
              <div className="p-3.5 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 rounded-2xl flex items-start gap-2.5 text-xs text-amber-800 dark:text-amber-200">
                <AlertTriangle className="w-4 h-4 mt-0.5 text-amber-600 shrink-0" />
                <div>
                  <span className="font-bold">نتیجه تست آنلاین:</span> {testResult.message}
                </div>
              </div>
            ) : (
              <div className="p-3.5 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 rounded-2xl flex items-start gap-2.5 text-xs text-emerald-800 dark:text-emerald-200">
                <CheckCircle2 className="w-4 h-4 mt-0.5 text-emerald-600 shrink-0" />
                <div>
                  <span className="font-bold">نتیجه تست آنلاین:</span> {testResult.message}
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
