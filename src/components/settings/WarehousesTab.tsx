import React from 'react';
import { Plus, Edit2, Trash2 } from 'lucide-react';
import { Warehouse } from '../../hooks/useSettings';

interface WarehousesTabProps {
  warehouses: Warehouse[];
  onOpenCreateModal: () => void;
  onOpenEditModal: (wh: Warehouse) => void;
  onDeleteWarehouse: (id: number) => void;
}

export function WarehousesTab({
  warehouses,
  onOpenCreateModal,
  onOpenEditModal,
  onDeleteWarehouse
}: WarehousesTabProps) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-xs flex flex-col min-h-[400px] max-w-4xl mx-auto text-right font-farsi">
      <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-slate-50 rounded-t-xl">
        <h3 className="font-bold border-0 p-0 m-0 text-slate-800 text-sm">🏬 مدیریت انبارها</h3>
        <button
          onClick={onOpenCreateModal}
          className="px-3 py-1.5 text-xs font-bold bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 flex items-center gap-1 transition-colors cursor-pointer"
        >
          <Plus size={14} /> انبار جدید
        </button>
      </div>

      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm text-right">
          <thead className="bg-slate-50 text-slate-500 border-b border-slate-200 text-xs">
            <tr>
              <th className="p-3 font-medium">نام انبار</th>
              <th className="p-3 font-medium">کد سیستم</th>
              <th className="p-3 font-medium text-center">عملیات</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-xs">
            {warehouses.map((w) => (
              <tr key={w.id} className="hover:bg-slate-50">
                <td className="p-3 font-medium text-slate-800">{w.name}</td>
                <td className="p-3 font-mono text-slate-500 text-left" dir="ltr">
                  {w.code}
                </td>
                <td className="p-3 text-center">
                  <div className="flex items-center justify-center gap-2">
                    <button
                      onClick={() => onOpenEditModal(w)}
                      className="text-blue-500 hover:text-blue-700 bg-blue-50 p-1.5 rounded-lg transition-colors cursor-pointer"
                      title="ویرایش"
                    >
                      <Edit2 size={14} />
                    </button>
                    {w.code !== 'main' && (
                      <button
                        onClick={() => onDeleteWarehouse(w.id)}
                        className="text-red-500 hover:text-red-700 bg-red-50 p-1.5 rounded-lg transition-colors cursor-pointer"
                        title="حذف"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface WarehouseModalProps {
  isOpen: boolean;
  onClose: () => void;
  isEditing?: boolean;
  whForm: { name: string; code: string };
  setWhForm: React.Dispatch<React.SetStateAction<{ name: string; code: string }>>;
  isSaving: boolean;
  onSubmit: (e: React.FormEvent) => void;
}

export function WarehouseModal({
  isOpen,
  onClose,
  isEditing,
  whForm,
  setWhForm,
  isSaving,
  onSubmit
}: WarehouseModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs z-50 flex items-center justify-center p-4 font-farsi text-right">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm overflow-hidden max-h-[85vh] flex flex-col">
        <div className="px-6 py-4 border-b border-slate-200">
          <h3 className="font-bold text-base text-slate-800 border-0 p-0 m-0">
            {isEditing ? 'ویرایش انبار' : 'تعریف انبار جدید'}
          </h3>
        </div>
        <form onSubmit={onSubmit} className="p-6 space-y-4 text-xs overflow-y-auto">
          <div>
            <label className="block font-medium mb-1 text-slate-700">نام انبار</label>
            <input
              required
              type="text"
              value={whForm.name}
              onChange={(e) => setWhForm({ ...whForm, name: e.target.value })}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:ring-1 focus:ring-emerald-500 outline-none"
            />
          </div>
          <div>
            <label className="block font-medium mb-1 text-slate-700">کد سیستم</label>
            <input
              required
              disabled={isEditing}
              type="text"
              value={whForm.code}
              onChange={(e) =>
                setWhForm({ ...whForm, code: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') })
              }
              className="w-full border border-slate-300 rounded-lg px-3 py-2 font-mono text-left focus:ring-1 focus:ring-emerald-500 outline-none disabled:bg-slate-100"
              dir="ltr"
            />
          </div>
          <div className="pt-4 flex justify-end gap-2 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-slate-300 rounded-lg hover:bg-slate-50 text-slate-600 cursor-pointer"
            >
              انصراف
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 font-bold cursor-pointer"
            >
              {isSaving ? 'در حال ثبت...' : 'ثبت انبار'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
