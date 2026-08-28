import React from 'react';
import { X, FileSpreadsheet, ArrowRight, Check, Loader2 } from 'lucide-react';
import { UnifiedExcelModalProps } from './excel/types';
import { useUnifiedExcelImport } from './excel/useUnifiedExcelImport';
import { ExcelUploadStep } from './excel/ExcelUploadStep';
import { ExcelPreviewStep } from './excel/ExcelPreviewStep';
import { ExcelResultStep } from './excel/ExcelResultStep';

export default function UnifiedExcelModal({
  isOpen,
  onClose,
  onSuccess,
  typeFilter = '',
  title = 'مدیریت ورود و خروجی جامع اکسل'
}: UnifiedExcelModalProps) {
  const {
    step,
    isExporting,
    isImporting,
    isLoadingMetadata,
    previewRows,
    filteredPreviewRows,
    filterMode,
    setFilterMode,
    searchQuery,
    setSearchQuery,
    importResult,
    fileInputRef,
    totalRows,
    mismatchCount,
    duplicateBatchCount,
    duplicateDbCount,
    totalIssues,
    handleClose,
    handleResetModal,
    handleDownloadExport,
    handleDownloadTemplate,
    handleFileChange,
    handleCellEdit,
    handleConfirmImport
  } = useUnifiedExcelImport({
    typeFilter,
    onSuccess,
    onClose
  });

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-[80] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl overflow-hidden animate-in fade-in zoom-in-95 duration-200 flex flex-col max-h-[92vh]">
        
        {/* Modal Header */}
        <div className="px-6 py-4 bg-slate-900 text-white flex justify-between items-center shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-500/20 rounded-xl text-blue-400">
              <FileSpreadsheet size={22} />
            </div>
            <div>
              <h3 className="font-bold text-base">{title}</h3>
              <p className="text-xs text-slate-300">
                {step === 'upload' && 'مدیریت ورود و خروجی جامع کالاها، موجودی انبارها و قیمت‌گذاری‌ها'}
                {step === 'preview' && 'بررسی صحت سیستم کدینگ، پیشوند دسته‌بندی‌ها و عدم وجود نام‌های تکراری'}
                {step === 'result' && 'نتیجه نهایی پردازش و ثبت داده‌ها در سیستم'}
              </p>
            </div>
          </div>
          <button 
            onClick={handleClose} 
            className="p-1 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-colors cursor-pointer"
          >
            <X size={20} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          {step === 'upload' && (
            <ExcelUploadStep
              isExporting={isExporting}
              isLoadingMetadata={isLoadingMetadata}
              fileInputRef={fileInputRef}
              onDownloadExport={handleDownloadExport}
              onDownloadTemplate={handleDownloadTemplate}
              onFileChange={handleFileChange}
            />
          )}

          {step === 'preview' && (
            <ExcelPreviewStep
              previewRows={previewRows}
              filteredPreviewRows={filteredPreviewRows}
              totalRows={totalRows}
              mismatchCount={mismatchCount}
              duplicateBatchCount={duplicateBatchCount}
              duplicateDbCount={duplicateDbCount}
              totalIssues={totalIssues}
              searchQuery={searchQuery}
              filterMode={filterMode}
              onSearchChange={setSearchQuery}
              onFilterModeChange={setFilterMode}
              onCellEdit={handleCellEdit}
            />
          )}

          {step === 'result' && importResult && (
            <ExcelResultStep importResult={importResult} />
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3 bg-slate-100 border-t flex justify-between items-center shrink-0">
          {step === 'preview' ? (
            <>
              <button
                onClick={handleResetModal}
                className="px-4 py-2 text-xs font-bold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-xl transition-all shadow-2xs flex items-center gap-1 cursor-pointer"
              >
                <ArrowRight size={14} />
                بارگذاری فایل دیگر
              </button>

              <button
                onClick={handleConfirmImport}
                disabled={isImporting || duplicateBatchCount + duplicateDbCount > 0 || mismatchCount > 0}
                className="px-6 py-2 text-xs font-bold text-white bg-purple-600 hover:bg-purple-700 disabled:bg-slate-300 rounded-xl transition-all shadow-md flex items-center gap-2 cursor-pointer"
              >
                {isImporting ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                تایید و ثبت نهایی در سیستم
              </button>
            </>
          ) : (
            <div className="w-full flex justify-end">
              <button
                onClick={handleClose}
                className="px-5 py-2 text-xs font-bold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-xl transition-all shadow-2xs cursor-pointer"
              >
                بستن
              </button>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
