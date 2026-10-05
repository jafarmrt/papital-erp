import React from 'react';

/** v8.0.91 (TD-391): فیلدهای نگهبان انتقال در طراح گردش‌کار: «مجوز لازم» (کلید مجوز، علاوه بر نقش) */
export interface WorkflowEdgeGuard {
  requiredPermission: string;
}

interface WorkflowEdgeGuardFieldsProps {
  value: WorkflowEdgeGuard;
  onChange: (patch: Partial<WorkflowEdgeGuard>) => void;
  /** کلیدهای مجوزی که در نقش‌ها به کار رفته‌اند، برای پیشنهاد */
  permissionOptions: string[];
}

export const WorkflowEdgeGuardFields: React.FC<WorkflowEdgeGuardFieldsProps> = ({ value, onChange, permissionOptions }) => (
  <div>
    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">مجوز لازم (اختیاری)</label>
    <input
      type="text"
      dir="ltr"
      list="workflow-edge-permission-options"
      value={value.requiredPermission}
      onChange={(e) => onChange({ requiredPermission: e.target.value.trim() })}
      placeholder="مثلاً accounting.vouchers"
      className="w-full text-xs p-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white font-mono"
    />
    <datalist id="workflow-edge-permission-options">
      {permissionOptions.map((p) => <option key={p} value={p} />)}
    </datalist>
    <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1">
      اگر پر شود، علاوه بر نقش، فقط کسی که این مجوز را دارد (یا مدیر سیستم) این انتقال را اجرا می‌کند.
    </p>
  </div>
);
