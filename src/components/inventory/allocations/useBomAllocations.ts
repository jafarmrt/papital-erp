import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { downloadSheet } from '../../../lib/excel/downloadSheet';
import { useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '../../../api';
import { isProjectOpenForAllocation } from '../../../lib/projects/projectStatus';
import { allocationStatusLabel } from '../../../lib/projects/allocationLabels';
import { warehouseLabel } from '../../../lib/inventory/warehouseLabel';
import { bomAllocationsExportFileName } from '../../../lib/inventoryAudit/exportFileNames';
import { EMPTY_ALLOCATION_STATUS_COUNTS, bomAllocationListUrl } from '../../../lib/inventory/bomAllocationList';
import { errorMessageOf, formatPersianDate, formatPersianNumber, getTodayJalaliDate } from '../../../utils';
import { useDebounce } from '../../../hooks/useDebounce';
import { useWarehousesQuery } from '../../../hooks/queries/useSettingsQueries';
import { invalidateProjectChange, useProjectPickQuery } from '../../../hooks/queries/useProjectQueries';
import { useOpeningRead } from '../../../hooks/queries/readOnEveryOpening';
import { useAllocationPageQuery, useRawMaterialOptionsQuery, type BomAllocationRow } from '../../../hooks/queries/useAllocationQueries';
import { invalidateAfterStockAdjustment } from '../../../hooks/inventoryAudit/useInventoryAuditSave';
import { confirmAction } from '../../ConfirmDialogHost';

/** OBS-R2-45 (TD-1322): rows of one page of the allocation list */
export const ALLOCATION_PAGE_SIZE = 50;

export type { AllocationItemOption, BomAllocationRow } from '../../../hooks/queries/useAllocationQueries';

/**
 * «تخصیص مواد به پروژه‌ها»: one page of the allocations under the search and status, the counts of every status, the
 * pickers of the allocation form and the writes (allocate, consume, release) and the Excel export.
 * 10.3 (ARCH review finding 3, part 11): the list is read through the shared cache under `inventory`, read again on each
 * opening of the tab and never shown from an earlier visit; a stock change anywhere (this tab's writes included)
 * invalidates it. Each write also refreshes the projects, whose steps and issued materials count the allocations.
 */
export function useBomAllocations() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  // OBS-R2-45 (TD-1322): one page from the server, with the counts of every status under the search
  const debouncedSearch = useDebounce(search);
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [debouncedSearch, statusFilter]);

  const query = useAllocationPageQuery({ page, limit: ALLOCATION_PAGE_SIZE, search: debouncedSearch, status: statusFilter });
  const read = useOpeningRead(query, true);
  const total = read.data?.total ?? 0;
  // a consume or release can empty the last page: go to the page that is now the last one
  const lastPage = Math.max(1, Math.ceil(total / ALLOCATION_PAGE_SIZE));
  const pastTheEnd = read.data !== undefined && page > lastPage;
  if (pastTheEnd) setPage(lastPage);
  // v9.0.415 (TD-760): a refused read (a 403) says so, never the empty table «هیچ تخصیصی یافت نشد»
  const loadError = read.error ? errorMessageOf(read.error) || 'خواندن تخصیص‌های مواد اولیه ممکن نشد.' : null;
  const loading = query.isFetching || pastTheEnd || (read.data === undefined && !read.error);
  const reload = () => { void query.refetch({ cancelRefetch: false }); };

  // v9.0.410 (TD-759، تصمیم ت۹ الف): پروژه لغوشده یا تکمیل‌شده مواد تازه نمی‌گیرد و پیشنهاد نمی‌شود
  const projectsList = (useProjectPickQuery().data ?? []).filter(p => isProjectOpenForAllocation(p.status));
  const itemsList = useRawMaterialOptionsQuery().data ?? [];
  const { data: warehousesList = [] } = useWarehousesQuery();

  /** after an allocation, a consume or a release: the stock screens, this list and the projects that count it */
  const afterWrite = () => {
    void invalidateAfterStockAdjustment(queryClient);
    invalidateProjectChange(queryClient);
  };

  const allocate = (body: { projectId: number; recipientPersonnelId: number | null; itemId: number; quantity: number; location: string; notes: string }) =>
    fetchJson('/inventory/allocations/allocate', {
      method: 'POST',
      body: JSON.stringify({
        projectId: body.projectId,
        recipientPersonnelId: body.recipientPersonnelId,
        allocations: [{ itemId: body.itemId, quantity: body.quantity, location: body.location, notes: body.notes }],
      }),
    }).then(afterWrite);

  const consume = async (alloc: BomAllocationRow) => {
    if (!(await confirmAction({ title: 'مصرف قطعی تخصیص', message: `آیا از مصرف قطعی ${formatPersianNumber(alloc.quantity)} ${alloc.unit} کالای ${alloc.itemName} در پروژه ${alloc.projectCode} اطمینان دارید؟` }))) {
      return;
    }
    try {
      await fetchJson(`/inventory/allocations/${alloc.id}/consume`, { method: 'POST' });
      afterWrite();
    } catch (err) {
      toast.error(errorMessageOf(err) || 'خطا در ثبت مصرف');
    }
  };

  const release = (alloc: BomAllocationRow, reason: string) =>
    fetchJson(`/inventory/allocations/${alloc.id}/release`, { method: 'POST', body: JSON.stringify({ reason }) }).then(afterWrite);

  // OBS-R2-45 (TD-1322): the export holds every allocation of the search and status, not only the page on screen; it is
  // read when the button is pressed, never from the cache
  const [exporting, setExporting] = useState(false);
  const exportExcel = async () => {
    setExporting(true);
    let all: BomAllocationRow[];
    try {
      const res = await fetchJson<{ allocations?: unknown } | null>(bomAllocationListUrl({ search: debouncedSearch, status: statusFilter }));
      all = Array.isArray(res?.allocations) ? (res.allocations as BomAllocationRow[]) : [];
    } catch (err) {
      toast.error(errorMessageOf(err) || 'خواندن تخصیص‌ها برای خروجی اکسل ممکن نشد.');
      setExporting(false);
      return;
    }
    setExporting(false);
    const data = all.map((a, idx) => ({
      'ردیف': idx + 1,
      'شناسه تخصیص': a.id,
      'کد پروژه': a.projectCode,
      'کد کالا': a.itemCode,
      'نام کالای اولیه': a.itemName,
      'مقدار تخصیص': a.quantity,
      'واحد': a.unit,
      'انبار مبداء': warehouseLabel(a.sourceLocation, warehousesList),
      'شناسه تراکنش کاردکس': a.sourceTransactionId || '-',
      'وضعیت': allocationStatusLabel(a.status),
      'تخصیص‌دهنده': a.username,
      'تاریخ تخصیص': a.allocatedAt ? formatPersianDate(a.allocatedAt) : '-',
      'توضیحات': a.notes || ''
    }));

    await downloadSheet(data, 'تخصیص مواد اولیه', bomAllocationsExportFileName(getTodayJalaliDate()));
  };

  return {
    search, setSearch, statusFilter, setStatusFilter, page, setPage,
    allocations: pastTheEnd ? [] : (read.data?.allocations ?? []),
    total,
    statusCounts: read.data?.statusCounts ?? EMPTY_ALLOCATION_STATUS_COUNTS,
    totalPages: lastPage,
    loading, loadError, reload,
    projectsList, itemsList, warehousesList,
    allocate, consume, release,
    exporting, exportExcel,
  };
}

export type BomAllocations = ReturnType<typeof useBomAllocations>;
