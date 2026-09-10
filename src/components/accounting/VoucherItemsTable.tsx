import React, { useState, useMemo } from 'react';
import { Scale, ArrowRightLeft, Trash2 } from 'lucide-react';
import { formatPersianPrice } from '../../utils';
import { AccountSearchSelect } from './AccountSearchSelect';
import type { Account } from '../../types';

export interface VoucherItemDraft {
  id?: number;
  accountId: number | '';
  detailedType: 'none' | 'customer' | 'supplier' | 'personnel' | 'project' | 'bank_account' | 'custom';
  detailedId: number | null;
  detailedName: string;
  debit: number;
  credit: number;
  description: string;
}

interface VoucherItemsTableProps {
  items: VoucherItemDraft[];
  selectableAccounts: Account[];
  customers: Array<{ id: number; name: string; partyType?: string; city?: string; supplierCategory?: string }>;
  personnelList: Array<{ id: number; firstName?: string; lastName?: string; fullName?: string }>;
  currencyLabel: string;
  updateItem: (index: number, patch: Partial<VoucherItemDraft>) => void;
  addRow: () => void;
  removeRow: (index: number) => void;
  handleAutoBalanceRow: (index: number) => void;
  handleSwapDebitCredit: (index: number) => void;
  rowRefs: React.MutableRefObject<Array<{
    accountRef?: React.RefObject<any>;
    detailedTypeRef?: React.RefObject<any>;
    detailedSelectRef?: React.RefObject<any>;
    descRef?: React.RefObject<any>;
    debitRef?: React.RefObject<any>;
    creditRef?: React.RefObject<any>;
  } | null>>;
}

/**
 * V9 Phase 5.2: جدول ردیف‌های سند حسابداری با ناوبری کیبورد Enter و کلیدهای میان‌بر
 * تراز سطر / جابجایی بدهکار-بستانکار — استخراج‌شده از NewVoucherModal.
 */
export function VoucherItemsTable({
  items,
  selectableAccounts,
  customers,
  personnelList,
  currencyLabel,
  updateItem,
  addRow,
  removeRow,
  handleAutoBalanceRow,
  handleSwapDebitCredit,
  rowRefs
}: VoucherItemsTableProps) {
  const [activeRowIndex, setActiveRowIndex] = useState<number>(0);

  const totalDebit = useMemo(() => items.reduce((acc, it) => acc + (Number(it.debit) || 0), 0), [items]);
  const totalCredit = useMemo(() => items.reduce((acc, it) => acc + (Number(it.credit) || 0), 0), [items]);

  const itemRefs = rowRefs;

  return (
    <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden shadow-xs">
      <div className="overflow-x-auto">
        <table className="w-full text-right border-collapse min-w-[780px]">
          <thead>
            <tr className="bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-xs font-bold">
              <th className="py-2.5 px-3 w-10 text-center">#</th>
              <th className="py-2.5 px-3 w-72">کد و عنوان حساب معین * (جستجوی سریع)</th>
              <th className="py-2.5 px-3 w-52">تفصیلی / شخص</th>
              <th className="py-2.5 px-3">شرح آرتیکل</th>
              <th className="py-2.5 px-3 w-40 text-left">بدهکار ({currencyLabel})</th>
              <th className="py-2.5 px-3 w-40 text-left">بستانکار ({currencyLabel})</th>
              <th className="py-2.5 px-2 w-20 text-center">عملیات</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
            {items.map((it, idx) => {
              const isActiveRow = activeRowIndex === idx;

              return (
                <tr 
                  key={idx} 
                  onClick={() => setActiveRowIndex(idx)}
                  className={`transition ${
                    isActiveRow 
                      ? 'bg-indigo-50/40 dark:bg-indigo-950/20 ring-1 ring-inset ring-indigo-500/20' 
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                  }`}
                >
                  {/* Row Index */}
                  <td className="py-2 px-3 text-center font-bold text-slate-400">
                    {idx + 1}
                  </td>

                  {/* Quick Account Selector */}
                  <td className="py-2 px-2">
                    <AccountSearchSelect
                      accounts={selectableAccounts}
                      value={it.accountId}
                      inputRef={itemRefs.current[idx]?.accountRef}
                      onChange={(accId) => updateItem(idx, { accountId: accId })}
                      onAdvance={() => {
                        // Jump to detailed or description
                        if (it.detailedType !== 'none') {
                          itemRefs.current[idx]?.detailedSelectRef?.current?.focus();
                        } else {
                          itemRefs.current[idx]?.descRef?.current?.focus();
                        }
                      }}
                      placeholder="کد یا عنوان حساب..."
                    />
                  </td>

                  {/* Detailed Selector */}
                  <td className="py-2 px-2">
                    <div className="flex items-center gap-1">
                      <select
                        ref={itemRefs.current[idx]?.detailedTypeRef}
                        value={it.detailedType}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            if (it.detailedType !== 'none') {
                              itemRefs.current[idx]?.detailedSelectRef?.current?.focus();
                            } else {
                              itemRefs.current[idx]?.descRef?.current?.focus();
                            }
                          }
                        }}
                        onChange={e => updateItem(idx, { 
                          detailedType: e.target.value as any,
                          detailedId: null,
                          detailedName: ''
                        })}
                        className="w-24 px-2 py-1.5 text-[11px] bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-800 dark:text-slate-200"
                      >
                        <option value="none">بدون تفصیلی</option>
                        <option value="customer">مشتری</option>
                        <option value="supplier">تامین‌کننده</option>
                        <option value="personnel">پرسنل</option>
                        <option value="custom">متفرقه</option>
                      </select>

                      {it.detailedType === 'customer' && (
                        <select
                          ref={itemRefs.current[idx]?.detailedSelectRef as any}
                          value={it.detailedId || ''}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              itemRefs.current[idx]?.descRef?.current?.focus();
                            }
                          }}
                          onChange={e => {
                            const c = customers.find(x => x.id === Number(e.target.value));
                            updateItem(idx, { detailedId: c ? c.id : null, detailedName: c ? c.name : '' });
                          }}
                          className="flex-1 px-2 py-1.5 text-[11px] bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg"
                        >
                          <option value="">انتخاب مشتری...</option>
                          {(() => {
                            const custs = customers.filter(c => {
                              const pt = c.partyType || (c as any).party_type || 'customer';
                              return pt === 'customer' || pt === 'both';
                            });
                            const list = custs.length > 0 ? custs : customers;
                            return list.map(c => (
                              <option key={c.id} value={c.id}>{c.name} {c.city ? `(${c.city})` : ''}</option>
                            ));
                          })()}
                        </select>
                      )}

                      {it.detailedType === 'supplier' && (
                        <select
                          ref={itemRefs.current[idx]?.detailedSelectRef as any}
                          value={it.detailedId || ''}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              itemRefs.current[idx]?.descRef?.current?.focus();
                            }
                          }}
                          onChange={e => {
                            const s = customers.find(x => x.id === Number(e.target.value));
                            updateItem(idx, { detailedId: s ? s.id : null, detailedName: s ? s.name : '' });
                          }}
                          className="flex-1 px-2 py-1.5 text-[11px] bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg"
                        >
                          <option value="">انتخاب تامین‌کننده...</option>
                          {(() => {
                            const suppliers = customers.filter(c => {
                              const pt = c.partyType || (c as any).party_type;
                              return pt === 'supplier' || pt === 'both';
                            });
                            const list = suppliers.length > 0 ? suppliers : customers;
                            return list.map(s => (
                              <option key={s.id} value={s.id}>
                                {s.name} {s.supplierCategory ? `[${s.supplierCategory}]` : ''} {s.city ? `(${s.city})` : ''}
                              </option>
                            ));
                          })()}
                        </select>
                      )}

                      {it.detailedType === 'personnel' && (
                        <select
                          ref={itemRefs.current[idx]?.detailedSelectRef as any}
                          value={it.detailedId || ''}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              itemRefs.current[idx]?.descRef?.current?.focus();
                            }
                          }}
                          onChange={e => {
                            const p = personnelList.find(x => x.id === Number(e.target.value));
                            updateItem(idx, { detailedId: p ? p.id : null, detailedName: p ? `${p.firstName || ''} ${p.lastName || ''}`.trim() : '' });
                          }}
                          className="flex-1 px-2 py-1.5 text-[11px] bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg"
                        >
                          <option value="">انتخاب پرسنل...</option>
                          {personnelList.map(p => (
                            <option key={p.id} value={p.id}>{p.firstName} {p.lastName}</option>
                          ))}
                        </select>
                      )}

                      {it.detailedType === 'custom' && (
                        <input
                          ref={itemRefs.current[idx]?.detailedSelectRef as any}
                          type="text"
                          value={it.detailedName}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              itemRefs.current[idx]?.descRef?.current?.focus();
                            }
                          }}
                          onChange={e => updateItem(idx, { detailedName: e.target.value })}
                          placeholder="عنوان تفصیلی..."
                          className="flex-1 px-2 py-1.5 text-[11px] bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg"
                        />
                      )}
                    </div>
                  </td>

                  {/* Description */}
                  <td className="py-2 px-2">
                    <input
                      ref={itemRefs.current[idx]?.descRef}
                      type="text"
                      value={it.description}
                      onFocus={() => setActiveRowIndex(idx)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          itemRefs.current[idx]?.debitRef?.current?.focus();
                        }
                      }}
                      onChange={e => updateItem(idx, { description: e.target.value })}
                      placeholder="شرح ردیف..."
                      className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-900 dark:text-white"
                    />
                  </td>

                  {/* Debit Input */}
                  <td className="py-2 px-2">
                    <div className="relative">
                      <input
                        ref={itemRefs.current[idx]?.debitRef}
                        type="number"
                        min="0"
                        step="any"
                        value={it.debit || ''}
                        onFocus={() => setActiveRowIndex(idx)}
                        onKeyDown={(e) => {
                          // Space key in empty debit: auto-balance
                          if (e.key === ' ' && (!it.debit || it.debit === 0)) {
                            e.preventDefault();
                            handleAutoBalanceRow(idx);
                            return;
                          }
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            if (Number(it.debit) > 0) {
                              // Skip credit and jump to next row
                              if (idx + 1 < items.length) {
                                itemRefs.current[idx + 1]?.accountRef?.current?.focus();
                              } else {
                                addRow();
                              }
                            } else {
                              itemRefs.current[idx]?.creditRef?.current?.focus();
                            }
                          }
                        }}
                        onChange={e => updateItem(idx, { debit: parseFloat(e.target.value) || 0 })}
                        placeholder="0"
                        className="w-full px-2.5 py-1.5 text-xs text-left font-mono bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-900 dark:text-white font-bold focus:ring-2 focus:ring-emerald-500"
                      />
                    </div>
                    {it.debit > 0 && (
                      <span className="block text-[9px] text-emerald-600 dark:text-emerald-400 font-mono text-left px-1 mt-0.5 truncate">
                        {formatPersianPrice(it.debit)}
                      </span>
                    )}
                  </td>

                  {/* Credit Input */}
                  <td className="py-2 px-2">
                    <div className="relative">
                      <input
                        ref={itemRefs.current[idx]?.creditRef}
                        type="number"
                        min="0"
                        step="any"
                        value={it.credit || ''}
                        onFocus={() => setActiveRowIndex(idx)}
                        onKeyDown={(e) => {
                          // Space key in empty credit: auto-balance
                          if (e.key === ' ' && (!it.credit || it.credit === 0)) {
                            e.preventDefault();
                            handleAutoBalanceRow(idx);
                            return;
                          }
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            // Jump to next row or create new row
                            if (idx + 1 < items.length) {
                              itemRefs.current[idx + 1]?.accountRef?.current?.focus();
                            } else {
                              addRow();
                            }
                          }
                        }}
                        onChange={e => updateItem(idx, { credit: parseFloat(e.target.value) || 0 })}
                        placeholder="0"
                        className="w-full px-2.5 py-1.5 text-xs text-left font-mono bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-900 dark:text-white font-bold focus:ring-2 focus:ring-rose-500"
                      />
                    </div>
                    {it.credit > 0 && (
                      <span className="block text-[9px] text-rose-600 dark:text-rose-400 font-mono text-left px-1 mt-0.5 truncate">
                        {formatPersianPrice(it.credit)}
                      </span>
                    )}
                  </td>

                  {/* Row Actions */}
                  <td className="py-2 px-2 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <button
                        type="button"
                        onClick={() => handleAutoBalanceRow(idx)}
                        title="تراز کردن این سطر با مانده سند (Alt+B)"
                        className="p-1 text-slate-400 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/30 rounded"
                      >
                        <Scale className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSwapDebitCredit(idx)}
                        title="جابجایی بدهکار / بستانکار (Alt+R)"
                        className="p-1 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 rounded"
                      >
                        <ArrowRightLeft className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => removeRow(idx)}
                        title="حذف سطر (Alt+D)"
                        className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="bg-slate-100 dark:bg-slate-800/80 font-bold border-t-2 border-slate-300 dark:border-slate-600 text-xs">
              <td colSpan={4} className="py-3 px-4 text-left font-bold text-slate-700 dark:text-slate-300">
                مجموع ستون‌ها:
              </td>
              <td className="py-3 px-3 text-left font-mono text-emerald-700 dark:text-emerald-300 font-black text-sm">
                {formatPersianPrice(totalDebit)}
              </td>
              <td className="py-3 px-3 text-left font-mono text-rose-700 dark:text-rose-300 font-black text-sm">
                {formatPersianPrice(totalCredit)}
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

export default VoucherItemsTable;
