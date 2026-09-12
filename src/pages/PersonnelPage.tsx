import React, { useState } from 'react';
import { Users, UserPlus, FileSpreadsheet } from 'lucide-react';
import { usePersonnel } from '../hooks/usePersonnel';
import { PersonnelStatsCards } from '../components/personnel/PersonnelStatsCards';
import { PersonnelTable } from '../components/personnel/PersonnelTable';
import { PersonnelFormModal } from '../components/personnel/PersonnelFormModal';
import { PersonnelDetailModal } from '../components/personnel/PersonnelDetailModal';
import { PersonnelExcelModal } from '../components/personnel/PersonnelExcelModal';

export function PersonnelPage() {
  const [showExcelModal, setShowExcelModal] = useState<boolean>(false);
  const {
    personnelList,
    usersList,
    isLoading,
    searchQuery,
    setSearchQuery,
    statusFilter,
    setStatusFilter,
    resetFilters,
    currentPage,
    setCurrentPage,
    pageSize,
    setPageSize,
    totalPages,
    totalFilteredCount,
    totalAllCount,
    startIndex,
    endIndex,
    paginatedPersonnel,
    showFormModal,
    setShowFormModal,
    editingId,
    showDetailModal,
    setShowDetailModal,
    selectedPersonnel,
    isSaving,
    showNobitexPass,
    setShowNobitexPass,
    formData,
    setFormData,
    loadData,
    handleOpenAddModal,
    handleOpenEditModal,
    handleSave,
    handleDelete,
    handleViewDetail,
    filteredPersonnel,
    stats
  } = usePersonnel();

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto font-farsi text-slate-800 dir-rtl">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200/80 shadow-2xs">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 bg-blue-50 text-blue-600 rounded-xl">
              <Users size={24} />
            </div>
            <div>
              <h1 className="text-xl font-black text-slate-900">مدیریت پرسنل و منابع انسانی</h1>
              <p className="text-xs text-slate-500 mt-0.5">
                ثبت، ویرایش و مشاهده شناسنامه کامل پرسنل، حساب‌های مالی، مهارت‌ها و وضعیت همکاری
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5 shrink-0 flex-wrap">
          <button
            onClick={() => setShowExcelModal(true)}
            className="px-4 py-2.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200/80 rounded-xl text-xs font-bold transition-all shadow-2xs flex items-center justify-center gap-2 cursor-pointer"
          >
            <FileSpreadsheet size={18} className="text-emerald-600" />
            <span>ورود و خروجی اکسل</span>
          </button>

          <button
            onClick={handleOpenAddModal}
            className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 active:scale-98 text-white rounded-xl text-xs font-bold transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer shrink-0"
          >
            <UserPlus size={18} />
            <span>ثبت پرسنل جدید</span>
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <PersonnelStatsCards stats={stats} />

      {/* Personnel Table & Filter Bar */}
      <PersonnelTable
        personnelList={paginatedPersonnel}
        totalFilteredCount={totalFilteredCount}
        totalAllCount={totalAllCount}
        currentPage={currentPage}
        pageSize={pageSize}
        totalPages={totalPages}
        startIndex={startIndex}
        endIndex={endIndex}
        onPageChange={setCurrentPage}
        onPageSizeChange={setPageSize}
        isLoading={isLoading}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        onResetFilters={resetFilters}
        onViewDetail={handleViewDetail}
        onEdit={handleOpenEditModal}
        onDelete={handleDelete}
      />

      {/* Modal 1: Create / Edit Form */}
      <PersonnelFormModal
        isOpen={showFormModal}
        onClose={() => setShowFormModal(false)}
        onSubmit={handleSave}
        editingId={editingId}
        formData={formData}
        setFormData={setFormData}
        usersList={usersList}
        isSaving={isSaving}
        showNobitexPass={showNobitexPass}
        setShowNobitexPass={setShowNobitexPass}
      />

      {/* Modal 2: View Detail / Dossier */}
      <PersonnelDetailModal
        isOpen={showDetailModal}
        onClose={() => setShowDetailModal(false)}
        personnel={selectedPersonnel}
        onEdit={(p) => {
          setShowDetailModal(false);
          handleOpenEditModal(p);
        }}
      />

      {/* Modal 3: Excel Import / Export */}
      <PersonnelExcelModal
        isOpen={showExcelModal}
        onClose={() => setShowExcelModal(false)}
        onSuccess={loadData}
        existingPersonnel={personnelList}
      />
    </div>
  );
}

export default PersonnelPage;

