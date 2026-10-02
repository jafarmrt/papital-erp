import { User } from '../types';
import GlobalReservationsPanel from '../components/documents/GlobalReservationsPanel';
import DocItemsTable from '../components/documents/DocItemsTable';
import { FinancialAttachmentUploader } from '../components/accounting/FinancialAttachmentUploader';
import { ItemFormModal } from '../components/items/ItemFormModal';
import { StockDocumentHeader } from '../components/documents/stock/StockDocumentHeader';
import { StockActionToggle } from '../components/documents/stock/StockActionToggle';
import { StockDocumentDetailsFields } from '../components/documents/stock/StockDocumentDetailsFields';
import { ProjectReservedItemsCard } from '../components/documents/stock/ProjectReservedItemsCard';
import { StockItemPicker } from '../components/documents/stock/StockItemPicker';
import { StockSubmitBar } from '../components/documents/stock/StockSubmitBar';
import { useStockDocumentReferenceData } from '../hooks/documents/useStockDocumentReferenceData';
import { useStockDocumentForm } from '../hooks/documents/useStockDocumentForm';
import { useStockDocumentSubmit } from '../hooks/documents/useStockDocumentSubmit';
import { createStockDocumentItemActions } from '../hooks/documents/stockDocumentItemActions';

/**
 * فرم «ورود و خروج به انبار» (رسید و حواله). TD-080 (بخش ۳): فقط ترکیب بخش‌ها؛ لیست‌های مرجع،
 * وضعیت فرم، کنترل‌کننده‌های اقلام، ثبت و منطق رزرو در hooks/documents و lib/documents هستند.
 */
export default function DocumentsPage({ user: currentUser }: { user: User }) {
  const refData = useStockDocumentReferenceData();
  const form = useStockDocumentForm(currentUser, refData);
  const actions = createStockDocumentItemActions(form, refData.itemsList);
  const { handleSubmit } = useStockDocumentSubmit(form, refData, currentUser);
  const { warehouses, personnelList, projectsList, suppliersList, categories } = refData;
  const { actionType, docItems } = form;

  return (
    <div className="space-y-6">
      {/* Page Header Harmonized with Projects Page */}
      <StockDocumentHeader
        actionType={actionType}
        totalReservedItemsCount={form.totalReservedItemsCount}
        onToggleReservations={() => form.setShowGlobalReservationsModal(!form.showGlobalReservationsModal)}
      />

      {/* V9 Phase 5.2: پنل رزروهای سراسری استخراج‌شده */}
      <GlobalReservationsPanel
        isOpen={form.showGlobalReservationsModal}
        onClose={() => form.setShowGlobalReservationsModal(false)}
        reservations={form.allGlobalReservations}
      />

      {/* Main Card Container */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden flex flex-col">
        {/* Action Type Toggle Header */}
        <StockActionToggle actionType={actionType} onChange={form.setActionType} />

        <form onSubmit={handleSubmit} className="p-5 sm:p-6 space-y-6">
          <StockDocumentDetailsFields
            form={form}
            currentUser={currentUser}
            warehouses={warehouses}
            projectsList={projectsList}
            personnelList={personnelList}
            suppliersList={suppliersList}
          />

          {/* Selected Project Reserved Items Info Card */}
          {actionType === 'out' && form.selectedProjectObj && (
            <ProjectReservedItemsCard
              project={form.selectedProjectObj}
              reservedItems={form.selectedProjectReservedItems}
              docItems={docItems}
              onAddAll={actions.handleAddAllProjectReservedItems}
              onAddSingle={actions.handleAddSingleProjectReservedItem}
            />
          )}

          {/* Item Selection Section */}
          <StockItemPicker
            form={form}
            onItemSelect={actions.handleItemSelect}
            onAddItem={actions.handleAddItem}
            onCreateItem={() => {
              form.setModalItemToEdit(null);
              form.setIsItemModalOpen(true);
            }}
          />

          {/* V9 Phase 5.2: جدول اقلام سند استخراج‌شده */}
          <DocItemsTable
            docItems={docItems}
            actionType={actionType}
            currencyLabel={form.currency}
            totalSum={form.totalSum}
            getItemReservationSummary={form.getItemReservationSummary}
            onUpdateItemQty={actions.handleUpdateItemQty}
            onUpdateItemPrice={actions.handleUpdateItemPrice}
            onRemove={actions.handleRemove}
            canEditItem={form.canCreateOrEditItem}
            onEditItem={(item) => {
              form.setModalItemToEdit(item);
              form.setIsItemModalOpen(true);
            }}
          />

          {/* پیوست مدارک، فاکتور، بارنامه و اسناد مثبته */}
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4">
            <FinancialAttachmentUploader
              attachments={form.attachments}
              onChange={form.setAttachments}
              title={actionType === 'in' ? 'الصاق تصویر فاکتور خرید، پیش‌فاکتور و بارنامه' : 'الصاق تصویر حواله امضا شده و رسید تحویل کالا'}
              description="امکان الصاق چندین تصویر و فایل اسناد با فشرده‌سازی خودکار هوشمند تا ۳۰۰ کیلوبایت برای هر فایل"
            />
          </div>

          {/* Submit Action Button */}
          <StockSubmitBar
            actionType={actionType}
            itemCount={docItems.length}
            totalQuantitySum={form.totalQuantitySum}
            disabled={docItems.length === 0 || currentUser.role === 'viewer' || form.isSaving}
            isSaving={form.isSaving}
          />
        </form>
      </div>

      {/* مودال تعریف کالای جدید یا افزودن/ویرایش تصویر کالا */}
      {form.isItemModalOpen && (
        <ItemFormModal
          isOpen={form.isItemModalOpen}
          onClose={() => {
            form.setIsItemModalOpen(false);
            form.setModalItemToEdit(null);
          }}
          item={form.modalItemToEdit}
          editingItem={form.modalItemToEdit}
          categories={categories || []}
          warehouses={warehouses}
          onSuccess={form.handleItemModalSuccess}
        />
      )}
    </div>
  );
}
