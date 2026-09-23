import { ItemFormModalProps } from './form/types';
import { useItemForm } from './form/useItemForm';
import { ItemBasicForm } from './form/ItemBasicForm';
import { ItemWarehouseStockForm } from './form/ItemWarehouseStockForm';
import { ItemSpecificationsForm } from './form/ItemSpecificationsForm';

export function ItemFormModal(props: ItemFormModalProps) {
  const { isOpen, onClose, warehouses } = props;

  const {
    item,
    categories,
    form,
    setForm,
    productYear,
    setProductYear,
    productCatPrefix,
    setProductCatPrefix,
    productTransferCode,
    setProductTransferCode,
    productDesignVar,
    setProductDesignVar,
    rawPrefix,
    setRawPrefix,
    rawNum,
    setRawNum,
    isSaving,
    handleCategoryChange,
    handleReserveProductCode,
    handleReserveRawCode,
    productSerialReserved,
    rawSerialReserved,
    handleImageChange,
    parseMultiValue,
    formatMultiValue,
    handleSubmit
  } = useItemForm(props);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-[80] animate-in fade-in">
      <div className="bg-white rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-slate-50 shrink-0">
          <h2 className="text-sm font-bold text-slate-800">
            {item ? 'ویرایش کالا' : (form.type === 'product' ? 'ثبت محصول نهایی جدید' : 'ثبت ماده اولیه / قطعه جدید')}
          </h2>
          <button 
            type="button" 
            onClick={onClose} 
            className="text-slate-400 hover:text-slate-600 font-bold text-lg w-7 h-7 flex items-center justify-center rounded-lg hover:bg-slate-200 transition-colors cursor-pointer"
          >
            ×
          </button>
        </div>

        {/* Scrollable Form Body */}
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
          <div className="p-5 overflow-y-auto space-y-4 flex-1">
            <ItemBasicForm
              form={form}
              setForm={setForm}
              item={item}
              categories={categories}
              productYear={productYear}
              setProductYear={setProductYear}
              productCatPrefix={productCatPrefix}
              setProductCatPrefix={setProductCatPrefix}
              productTransferCode={productTransferCode}
              setProductTransferCode={setProductTransferCode}
              productDesignVar={productDesignVar}
              setProductDesignVar={setProductDesignVar}
              rawPrefix={rawPrefix}
              setRawPrefix={setRawPrefix}
              rawNum={rawNum}
              setRawNum={setRawNum}
              onCategoryChange={handleCategoryChange}
              onReserveProductCode={handleReserveProductCode}
              onReserveRawCode={handleReserveRawCode}
              productSerialReserved={productSerialReserved}
              rawSerialReserved={rawSerialReserved}
            />

            {(!item || Boolean(item.canSetOpeningBalance ?? (item as any).can_set_opening_balance)) && (
              <ItemWarehouseStockForm
                warehouses={warehouses}
                form={form}
                setForm={setForm}
              />
            )}

            <ItemSpecificationsForm
              form={form}
              setForm={setForm}
              parseMultiValue={parseMultiValue}
              formatMultiValue={formatMultiValue}
              onImageChange={handleImageChange}
            />
          </div>

          {/* Footer */}
          <div className="p-4 border-t border-slate-200 flex justify-end gap-2.5 bg-slate-50 shrink-0">
            <button 
              type="button" 
              onClick={onClose} 
              className="px-4 py-2 border border-slate-300 rounded-xl hover:bg-slate-100 bg-white text-slate-700 text-xs font-bold transition-all cursor-pointer"
            >
              انصراف
            </button>
            <button 
              type="submit" 
              disabled={isSaving} 
              className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold disabled:opacity-50 text-xs shadow-md shadow-blue-600/20 transition-all cursor-pointer"
            >
              {isSaving ? 'در حال ثبت...' : 'ثبت و ذخیره'}
            </button>
          </div>
        </form>

      </div>
    </div>
  );
}

export default ItemFormModal;
