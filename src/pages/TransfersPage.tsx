import React, { useState, useRef, useEffect } from 'react';
import { confirmAction } from '../components/ConfirmDialogHost';
import { toast } from 'react-hot-toast';
import { User } from '../types';
import {
  Layers, Search, Upload, Image as ImageIcon, Plus, RefreshCw,
  Package, AlertCircle, Edit3, X, Check, Eye, Trash2, Filter,
  ChevronRight, ChevronLeft, ChevronsRight, ChevronsLeft, Printer,
  Download
} from 'lucide-react';
import { formatPersianNumber } from '../utils';
import { compressTo300KB } from '../utils/imageCompression';
import { DocPrintModal } from '../components/print/DocPrintModal';
import { SafeImage } from '../components/SafeImage';
import { useTransfersQuery, useSaveTransferMutation, useDeleteTransferMutation, TransferItem } from '../hooks/queries';

export default function TransfersPage({ user }: { user?: User }) {
  const { data: transfers = [], isLoading: loading, refetch } = useTransfersQuery();
  const saveMutation = useSaveTransferMutation();
  const deleteMutation = useDeleteTransferMutation();

  const [search, setSearch] = useState<string>('');
  const [filterType, setFilterType] = useState<'all' | 'with_image' | 'without_image'>('all');
  
  // Pagination states
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(12);
  const gridTopRef = useRef<HTMLDivElement>(null);

  // Modal states
  const [selectedTransfer, setSelectedTransfer] = useState<TransferItem | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState<boolean>(false);
  const isSaving = saveMutation.isPending;

  // Form states inside modal
  const [editCode, setEditCode] = useState<string>('');
  const [editTitle, setEditTitle] = useState<string>('');
  const [editNotes, setEditNotes] = useState<string>('');
  const [editImage, setEditImage] = useState<string>('');
  const [editThumbnail, setEditThumbnail] = useState<string>('');

  // Image lightbox modal state (for transfer designs and product images)
  const [lightboxData, setLightboxData] = useState<{
    url: string;
    title?: string;
    subtitle?: string;
  } | null>(null);

  // V10-3.2: پیش‌نمایش چاپ کارت ترنسفر
  const [printTarget, setPrintTarget] = useState<TransferItem | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadTransfers = () => {
    refetch();
  };

  // Close lightbox on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setLightboxData(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Reset page to 1 on filter or search change
  useEffect(() => {
    setCurrentPage(1);
  }, [search, filterType, pageSize]);

  const openCreateModal = () => {
    setSelectedTransfer(null);
    setEditCode('');
    setEditTitle('');
    setEditNotes('');
    setEditImage('');
    setEditThumbnail('');
    setIsEditModalOpen(true);
  };

  const openEditModal = (item: TransferItem) => {
    setSelectedTransfer(item);
    setEditCode(item.code);
    setEditTitle(item.title || `ترنسفر کد ${item.code}`);
    setEditNotes(item.notes || '');
    setEditImage(item.image || '');
    setEditThumbnail(item.thumbnail || '');
    setIsEditModalOpen(true);
  };

  const handleImageFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error('لطفاً یک فایل تصویری انتخاب کنید');
      e.target.value = '';
      return;
    }

    try {
      // V10-2.3: استاندارد واحد فشرده‌سازی تصاویر (سقف ۳۰۰ کیلوبایت)
      const dataUrl = await compressTo300KB(file);
      setEditImage(dataUrl);

      // Create thumbnail canvas
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_SIZE = 120;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_SIZE) {
            height *= MAX_SIZE / width;
            width = MAX_SIZE;
          }
        } else {
          if (height > MAX_SIZE) {
            width *= MAX_SIZE / height;
            height = MAX_SIZE;
          }
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, width, height);
        const thumbBase64 = canvas.toDataURL('image/jpeg', 0.8);
        setEditThumbnail(thumbBase64);
      };
      img.src = dataUrl;
    } catch {
      toast.error('خطا در پردازش تصویر. لطفاً فایل دیگری انتخاب کنید.');
    }
  };

  const handleSaveTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    const codeToSave = (selectedTransfer ? selectedTransfer.code : editCode).trim();
    if (!codeToSave) {
      toast.error('لطفاً کد ترنسفر را وارد نمایید (مثال: 001 یا 002)');
      return;
    }

    const payload = {
      code: codeToSave,
      title: editTitle.trim() || `ترنسفر کد ${codeToSave}`,
      image: editImage,
      thumbnail: editThumbnail,
      notes: editNotes
    };

    saveMutation.mutate({ code: codeToSave, payload }, {
      onSuccess: () => {
        setIsEditModalOpen(false);
      }
    });
  };

  const handleDeleteTransferImage = async () => {
    const codeToDelete = selectedTransfer?.code || editCode;
    if (!codeToDelete) return;
    if (!(await confirmAction({ title: 'حذف ترنسفر', message: `آیا از پاک کردن تصویر و اطلاعات ترنسفر کد ${codeToDelete} اطمینان دارید؟` }))) return;

    deleteMutation.mutate(codeToDelete, {
      onSuccess: () => {
        setEditImage('');
        setEditThumbnail('');
        setIsEditModalOpen(false);
      }
    });
  };

  // Filter transfers
  const filteredTransfers = transfers.filter(item => {
    // Filter by text
    const matchesSearch = 
      item.code.toLowerCase().includes(search.toLowerCase()) ||
      item.title.toLowerCase().includes(search.toLowerCase()) ||
      item.products.some(p => p.name.toLowerCase().includes(search.toLowerCase()) || p.code.toLowerCase().includes(search.toLowerCase()));

    if (!matchesSearch) return false;

    // Filter by image presence
    if (filterType === 'with_image') return !!item.image;
    if (filterType === 'without_image') return !item.image;

    return true;
  });

  const totalWithImage = transfers.filter(t => !!t.image).length;
  const totalProductsLinked = transfers.reduce((sum, t) => sum + t.productCount, 0);

  // Pagination computations
  const totalItems = filteredTransfers.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safeCurrentPage = Math.min(Math.max(currentPage, 1), totalPages);
  const startIndex = (safeCurrentPage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalItems);
  const paginatedTransfers = filteredTransfers.slice(startIndex, endIndex);

  const handlePageChange = (newPage: number) => {
    const target = Math.min(Math.max(newPage, 1), totalPages);
    setCurrentPage(target);
    if (gridTopRef.current) {
      gridTopRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Top Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white rounded-2xl p-6 shadow-lg relative overflow-hidden shrink-0">
        <div className="absolute top-0 left-0 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 relative z-10">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-indigo-600/30 border border-indigo-400/30 rounded-2xl flex items-center justify-center text-indigo-300 shadow-inner shrink-0">
              <Layers size={26} />
            </div>
            <div>
              <h1 className="text-xl font-black text-white flex items-center gap-2">
                مدیریت و آلبوم کدهای ترنسفر
              </h1>
              <p className="text-xs text-slate-300 mt-1">
                شناسایی خودکار کدهای ترنسفر از روی کد محصولات (مانند کد <code className="bg-slate-800 text-indigo-300 px-1.5 py-0.5 rounded font-mono font-bold">003</code> در <code className="bg-slate-800 text-indigo-300 px-1.5 py-0.5 rounded font-mono font-bold">1403-B-003-01</code>)، بارگذاری تصویر و نمایش محصولات مرتبط
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={openCreateModal}
              className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-2 shadow-md shadow-emerald-600/30 active:scale-95 cursor-pointer"
            >
              <Plus size={16} />
              ثبت طرح ترنسفر جدید
            </button>
            <button
              onClick={loadTransfers}
              className="px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-2 shadow-md shadow-blue-600/30 active:scale-95 cursor-pointer"
            >
              <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
              بروزرسانی داده‌ها
            </button>
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white p-5 border rounded-2xl shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-500 font-bold">تعداد کدهای ترنسفر در سامانه</p>
            <h3 className="text-2xl font-black text-slate-800 mt-1 font-mono">
              {formatPersianNumber(transfers.length)} <span className="text-xs font-sans font-normal text-slate-500">کد طرح</span>
            </h3>
          </div>
          <div className="w-11 h-11 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center font-bold">
            <Layers size={22} />
          </div>
        </div>

        <div className="bg-white p-5 border rounded-2xl shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-500 font-bold">طرح‌های دارای تصویر ثبت‌شده</p>
            <h3 className="text-2xl font-black text-emerald-600 mt-1 font-mono">
              {formatPersianNumber(totalWithImage)} <span className="text-xs font-sans font-normal text-slate-500">طرح مصور</span>
            </h3>
          </div>
          <div className="w-11 h-11 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center font-bold">
            <ImageIcon size={22} />
          </div>
        </div>

        <div className="bg-white p-5 border rounded-2xl shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-500 font-bold">مجموع محصولات مرتبط با ترنسفرها</p>
            <h3 className="text-2xl font-black text-purple-600 mt-1 font-mono">
              {formatPersianNumber(totalProductsLinked)} <span className="text-xs font-sans font-normal text-slate-500">کالا</span>
            </h3>
          </div>
          <div className="w-11 h-11 bg-purple-50 text-purple-600 rounded-2xl flex items-center justify-center font-bold">
            <Package size={22} />
          </div>
        </div>
      </div>

      {/* Toolbar & Filters */}
      <div ref={gridTopRef} className="bg-white p-4 border rounded-2xl shadow-xs flex flex-col md:flex-row items-center justify-between gap-4">
        {/* Search Bar */}
        <div className="relative w-full md:w-96">
          <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="جستجو بر اساس کد ترنسفر، عنوان یا نام محصول..."
            className="w-full pl-3 pr-9 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
          />
        </div>

        {/* Filter buttons */}
        <div className="flex items-center gap-2 w-full md:w-auto overflow-x-auto pb-1 md:pb-0">
          <span className="text-xs font-bold text-slate-400 shrink-0 flex items-center gap-1">
            <Filter size={14} /> فیلتر:
          </span>
          <button
            onClick={() => setFilterType('all')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 ${
              filterType === 'all' 
                ? 'bg-slate-900 text-white shadow-xs' 
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            همه موارد ({formatPersianNumber(transfers.length)})
          </button>
          <button
            onClick={() => setFilterType('with_image')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 ${
              filterType === 'with_image' 
                ? 'bg-emerald-600 text-white shadow-xs' 
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            دارای تصویر ({formatPersianNumber(totalWithImage)})
          </button>
          <button
            onClick={() => setFilterType('without_image')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 ${
              filterType === 'without_image' 
                ? 'bg-amber-600 text-white shadow-xs' 
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            بدون تصویر ({formatPersianNumber(transfers.length - totalWithImage)})
          </button>
        </div>
      </div>

      {/* Main Grid */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-pulse">
          {Array.from({ length: 6 }).map((_, idx) => (
            <div key={idx} className="bg-white border rounded-2xl h-64 p-5 space-y-4">
              <div className="h-6 bg-slate-200 rounded w-1/3"></div>
              <div className="h-32 bg-slate-200 rounded-xl"></div>
              <div className="h-4 bg-slate-200 rounded w-2/3"></div>
            </div>
          ))}
        </div>
      ) : filteredTransfers.length === 0 ? (
        <div className="bg-white p-12 border rounded-2xl text-center space-y-4">
          <AlertCircle size={40} className="mx-auto text-slate-300" />
          <h3 className="font-bold text-slate-700">هیچ کد ترنسفری مطابق با جستجوی شما یافت نشد.</h3>
          <p className="text-xs text-slate-400 max-w-md mx-auto">
            می‌توانید مستقیماً یک طرح ترنسفر جدید ایجاد کنید یا از کدگذاری خودکار محصولات استفاده نمایید.
          </p>
          <div className="flex items-center justify-center gap-2 pt-2">
            <button
              onClick={openCreateModal}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-2 shadow-xs cursor-pointer"
            >
              <Plus size={15} />
              ثبت طرح ترنسفر جدید
            </button>
            {search && (
              <button
                onClick={() => setSearch('')}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-all cursor-pointer"
              >
                پاک کردن جستجو
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {paginatedTransfers.map((item) => (
              <div 
                key={item.code} 
                className="bg-white border border-slate-200 hover:border-blue-300 rounded-2xl shadow-xs hover:shadow-md transition-all flex flex-col justify-between overflow-hidden group"
              >
                {/* Header of Transfer Card */}
                <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <span className="bg-blue-600 text-white font-mono text-xs font-bold px-2.5 py-1 rounded-lg tracking-wider shadow-2xs">
                      کد ترنسفر: {item.code}
                    </span>
                    <h3 className="font-bold text-slate-800 text-xs truncate max-w-[160px]" title={item.title}>
                      {item.title || `ترنسفر کد ${item.code}`}
                    </h3>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] bg-purple-50 text-purple-700 font-bold px-2 py-0.5 rounded-full flex items-center gap-1 border border-purple-200/60">
                      <Package size={12} />
                      {formatPersianNumber(item.productCount)} کالا
                    </span>
                    {/* V10-3.2: چاپ کارت ترنسفر */}
                    <button
                      onClick={() => setPrintTarget(item)}
                      className="w-7 h-7 bg-white border border-slate-200 hover:bg-blue-50 hover:border-blue-300 text-blue-600 p-0 rounded-full flex items-center justify-center transition-colors cursor-pointer shadow-2xs"
                      title="چاپ کارت ترنسفر"
                    >
                      <Printer size={13} />
                    </button>
                  </div>
                </div>

                {/* Transfer Image Container */}
                <div className="p-4 bg-slate-100/60 relative flex items-center justify-center min-h-[160px] max-h-[200px] overflow-hidden group/img">
                  {item.image ? (
                    <>
                      <SafeImage
                        src={item.image}
                        alt={`ترنسفر کد ${item.code}`}
                        className="max-h-36 max-w-full object-contain rounded-xl shadow-xs transition-transform duration-300 group-hover/img:scale-105 cursor-pointer"
                        onClick={() => setLightboxData({
                          url: item.image,
                          title: item.title || `طرح ترنسفر کد ${item.code}`,
                          subtitle: `کد ترنسفر: ${item.code} • ${formatPersianNumber(item.productCount)} کالای متصل`
                        })}
                      />
                      <button
                        onClick={() => setLightboxData({
                          url: item.image,
                          title: item.title || `طرح ترنسفر کد ${item.code}`,
                          subtitle: `کد ترنسفر: ${item.code} • ${formatPersianNumber(item.productCount)} کالای متصل`
                        })}
                        className="absolute top-3 left-3 bg-slate-900/80 hover:bg-slate-900 text-white p-1.5 rounded-xl text-xs opacity-0 group-hover/img:opacity-100 transition-opacity flex items-center gap-1 shadow-sm cursor-pointer"
                        title="بزرگنمایی تصویر طرح ترنسفر"
                      >
                        <Eye size={13} />
                      </button>
                    </>
                  ) : (
                    <div className="text-center p-6 text-slate-400 space-y-2">
                      <ImageIcon size={32} className="mx-auto opacity-40 text-slate-400" />
                      <p className="text-[11px] font-medium">تصویر ترنسفر بارگذاری نشده است</p>
                      <button
                        onClick={() => openEditModal(item)}
                        className="text-[11px] bg-white text-blue-600 border border-blue-200 px-3 py-1 rounded-xl font-bold hover:bg-blue-50 transition-colors shadow-2xs inline-flex items-center gap-1"
                      >
                        <Upload size={12} />
                        بارگذاری تصویر
                      </button>
                    </div>
                  )}
                </div>

                {/* Linked Products Summary Section */}
                <div className="p-4 bg-white flex-1 flex flex-col justify-between">
                  <div className="space-y-2.5">
                    <div className="flex justify-between items-center text-[11px] font-bold text-slate-500 pb-1.5 border-b border-slate-100">
                      <span>محصولات متصل به کد {item.code}:</span>
                      <span className="text-slate-400 font-mono">{formatPersianNumber(item.products.length)} کالا</span>
                    </div>

                    {item.products.length > 0 ? (
                      <div className="space-y-2">
                        {item.products.slice(0, 3).map((prod) => {
                          const prodImg = prod.thumbnail || prod.image;
                          return (
                            <div 
                              key={prod.id} 
                              className="flex items-center justify-between p-2 rounded-xl bg-slate-50 hover:bg-blue-50/40 border border-slate-100 hover:border-blue-200 transition-all group/proditem"
                            >
                              <div className="flex items-center gap-2.5 overflow-hidden min-w-0 flex-1">
                                {prodImg ? (
                                  <div
                                    onClick={() => setLightboxData({
                                      url: prod.image || prod.thumbnail || '',
                                      title: prod.name,
                                      subtitle: `کد محصول: ${prod.code} • دسته‌بندی: ${prod.category || '-'}`
                                    })}
                                    className="relative group/prodimg shrink-0 cursor-pointer"
                                    title="کلیک برای بزرگنمایی تصویر محصول (لایت‌باکس)"
                                  >
                                    <SafeImage
                                      src={prodImg}
                                      alt={prod.name}
                                      className="w-11 h-11 rounded-xl object-cover border border-slate-200 bg-white shadow-2xs group-hover/prodimg:ring-2 group-hover/prodimg:ring-blue-500 group-hover/prodimg:scale-105 transition-all"
                                    />
                                    <div className="absolute inset-0 bg-slate-950/40 opacity-0 group-hover/prodimg:opacity-100 transition-opacity rounded-xl flex items-center justify-center text-white">
                                      <Eye size={15} />
                                    </div>
                                  </div>
                                ) : (
                                  <div className="w-11 h-11 rounded-xl bg-slate-200/90 text-slate-600 flex items-center justify-center text-xs font-black shrink-0 border border-slate-200">
                                    {prod.name.charAt(0)}
                                  </div>
                                )}
                                <div className="min-w-0 flex-1">
                                  <span className="font-bold text-slate-800 text-xs truncate block" title={prod.name}>
                                    {prod.name}
                                  </span>
                                  <div className="flex items-center gap-1.5 mt-0.5">
                                    <span className="font-mono text-[10px] bg-white border border-slate-200 px-1.5 py-0.2 rounded text-slate-700 dir-ltr font-semibold">
                                      {prod.code}
                                    </span>
                                    {prod.category && (
                                      <span className="text-[10px] text-slate-400 truncate max-w-[120px]">
                                        {prod.category}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>

                              {prod.currentStock !== undefined && (
                                <span className="text-[10px] bg-white border border-slate-200 px-2 py-1 rounded-lg text-slate-600 font-bold shrink-0 mr-2 shadow-2xs">
                                  {formatPersianNumber(prod.currentStock)} {prod.unit || 'عدد'}
                                </span>
                              )}
                            </div>
                          );
                        })}

                        {item.products.length > 3 && (
                          <p className="text-[10px] text-slate-400 text-center pt-0.5 font-medium">
                            و {formatPersianNumber(item.products.length - 3)} کالای دیگر متصل به این کد...
                          </p>
                        )}
                      </div>
                    ) : (
                      <p className="text-[11px] text-slate-400 italic text-center py-2">
                        هیچ محصول فعال با کد ترنسفر {item.code} ثبت نشده است.
                      </p>
                    )}
                  </div>

                  {/* Footer Action */}
                  <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                    <button
                      onClick={() => openEditModal(item)}
                      className="flex-1 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold py-2 px-3 rounded-xl transition-all flex items-center justify-center gap-1.5 shadow-2xs"
                    >
                      <Edit3 size={14} className="text-amber-400" />
                      مدیریت تصویر و محصولات
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Pagination Navigation Bar */}
          <div className="bg-white p-4 border border-slate-200 rounded-2xl shadow-xs flex flex-col sm:flex-row items-center justify-between gap-4">
            {/* Info and Page size select */}
            <div className="flex flex-wrap items-center justify-between sm:justify-start gap-4 w-full sm:w-auto text-xs text-slate-600">
              <span className="font-bold text-slate-700">
                نمایش <span className="text-blue-600 font-mono">{formatPersianNumber(totalItems > 0 ? startIndex + 1 : 0)}</span> تا{' '}
                <span className="text-blue-600 font-mono">{formatPersianNumber(endIndex)}</span> از{' '}
                <span className="text-blue-600 font-mono">{formatPersianNumber(totalItems)}</span> کد ترنسفر
              </span>

              <div className="flex items-center gap-1.5 mr-auto sm:mr-0">
                <span className="text-[11px] text-slate-500 font-medium">تعداد در صفحه:</span>
                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setCurrentPage(1);
                  }}
                  className="px-2.5 py-1 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 cursor-pointer"
                >
                  <option value={6}>۶ طرح</option>
                  <option value={12}>۱۲ طرح</option>
                  <option value={24}>۲۴ طرح</option>
                  <option value={48}>۴۸ طرح</option>
                  <option value={96}>۹۶ طرح</option>
                </select>
              </div>
            </div>

            {/* Pagination Buttons */}
            {totalPages > 1 && (
              <div className="flex items-center gap-1.5 w-full sm:w-auto justify-center sm:justify-end overflow-x-auto pb-1 sm:pb-0">
                {/* First page button */}
                <button
                  onClick={() => handlePageChange(1)}
                  disabled={safeCurrentPage === 1}
                  className="p-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-100 transition-all font-bold cursor-pointer"
                  title="صفحه اول"
                >
                  <ChevronsRight size={15} />
                </button>

                {/* Prev button */}
                <button
                  onClick={() => handlePageChange(safeCurrentPage - 1)}
                  disabled={safeCurrentPage === 1}
                  className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-100 transition-all flex items-center gap-1 font-bold text-xs cursor-pointer"
                >
                  <ChevronRight size={15} />
                  قبلی
                </button>

                {/* Numeric buttons */}
                <div className="flex items-center gap-1 px-1">
                  {Array.from({ length: totalPages }, (_, i) => i + 1)
                    .filter((p) => p === 1 || p === totalPages || Math.abs(p - safeCurrentPage) <= 1)
                    .map((p, idx, arr) => {
                      const showEllipsis = idx > 0 && p - arr[idx - 1] > 1;
                      return (
                        <React.Fragment key={p}>
                          {showEllipsis && <span className="text-slate-400 text-xs px-1 select-none">...</span>}
                          <button
                            onClick={() => handlePageChange(p)}
                            className={`min-w-8 h-8 px-2 rounded-xl text-xs font-black transition-all cursor-pointer ${
                              p === safeCurrentPage
                                ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20'
                                : 'bg-slate-50 text-slate-600 hover:bg-slate-100 border border-slate-200'
                            }`}
                          >
                            {formatPersianNumber(p)}
                          </button>
                        </React.Fragment>
                      );
                    })}
                </div>

                {/* Next button */}
                <button
                  onClick={() => handlePageChange(safeCurrentPage + 1)}
                  disabled={safeCurrentPage === totalPages}
                  className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-100 transition-all flex items-center gap-1 font-bold text-xs cursor-pointer"
                >
                  بعدی
                  <ChevronLeft size={15} />
                </button>

                {/* Last page button */}
                <button
                  onClick={() => handlePageChange(totalPages)}
                  disabled={safeCurrentPage === totalPages}
                  className="p-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-100 transition-all font-bold cursor-pointer"
                  title="صفحه آخر"
                >
                  <ChevronsLeft size={15} />
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Edit & Detail Modal */}
      {isEditModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-3 sm:p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[85vh] shadow-2xl border border-slate-200 flex flex-col overflow-hidden animate-in fade-in zoom-in duration-200">
            {/* Modal Header */}
            <div className="px-5 py-3.5 bg-slate-900 text-white flex justify-between items-center shrink-0">
              <div className="flex items-center gap-2">
                <span className="bg-amber-400 text-slate-950 font-mono text-xs font-black px-2.5 py-0.5 rounded-lg">
                  {selectedTransfer ? `کد: ${selectedTransfer.code}` : 'طرح جدید'}
                </span>
                <h2 className="font-bold text-sm">
                  {selectedTransfer ? `مدیریت و تصویر ترنسفر کد ${selectedTransfer.code}` : 'ثبت طرح ترنسفر جدید'}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setIsEditModalOpen(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveTransfer} className="flex flex-col flex-1 overflow-hidden">
              <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4 custom-scrollbar">
                {/* 2-Column Grid */}
                <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
                  {/* Image Upload Box */}
                  <div className="md:col-span-5 flex flex-col">
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">تصویر طرح ترنسفر</label>
                    <div className="border-2 border-dashed border-slate-300 rounded-2xl p-3 bg-slate-50 flex flex-col items-center justify-center gap-2 relative min-h-[140px] max-h-[170px] flex-1">
                      {editImage ? (
                        <div className="relative group w-full flex flex-col items-center justify-center">
                          <img
                            src={editImage}
                            alt="Transfer preview"
                            className="max-h-24 rounded-lg object-contain shadow-2xs bg-white p-1 border cursor-pointer hover:scale-105 transition-transform"
                            onClick={() => setLightboxData({
                              url: editImage,
                              title: editTitle || `طرح ترنسفر کد ${editCode}`,
                              subtitle: `کد ترنسفر: ${editCode}`
                            })}
                            title="کلیک برای مشاهده تصویر بزرگ طرح"
                          />
                          <div className="flex items-center gap-1.5 mt-2">
                            <button
                              type="button"
                              onClick={() => fileInputRef.current?.click()}
                              className="bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-bold px-2.5 py-1 rounded-lg flex items-center gap-1 transition-colors shadow-2xs cursor-pointer"
                            >
                              <Upload size={11} /> تغییر
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setEditImage('');
                                setEditThumbnail('');
                              }}
                              className="bg-rose-100 hover:bg-rose-200 text-rose-700 text-[11px] font-bold px-2.5 py-1 rounded-lg flex items-center gap-1 transition-colors cursor-pointer"
                            >
                              <Trash2 size={11} /> حذف
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="text-center space-y-1 cursor-pointer p-2" onClick={() => fileInputRef.current?.click()}>
                          <div className="w-9 h-9 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center mx-auto">
                            <Upload size={16} />
                          </div>
                          <p className="text-[11px] font-bold text-slate-700">کلیک یا کشیدن تصویر</p>
                          <p className="text-[9px] text-slate-400">JPG, PNG, WEBP (حداکثر ۲ مگابایت)</p>
                        </div>
                      )}

                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        onChange={handleImageFileChange}
                        className="hidden"
                      />
                    </div>
                  </div>

                  {/* Form Fields */}
                  <div className="md:col-span-7 space-y-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        کد ترنسفر <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="text"
                        required
                        disabled={!!selectedTransfer}
                        value={editCode}
                        onChange={(e) => setEditCode(e.target.value)}
                        placeholder="مثال: 001 یا 002"
                        className="w-full border border-slate-300 rounded-xl px-3 py-1.5 text-xs font-mono text-left bg-white disabled:bg-slate-100 disabled:text-slate-500 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                        dir="ltr"
                      />
                      {!selectedTransfer && (
                        <p className="text-[10px] text-slate-400 mt-1">کد ۳ یا ۴ رقمی طرح ترنسفر (مانند 003 برای استخراج از کد محصول)</p>
                      )}
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">عنوان / نام طرح ترنسفر</label>
                      <input
                        type="text"
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        placeholder="مثال: ترنسفر گل ماندالا کد ۰۰۳"
                        className="w-full border border-slate-300 rounded-xl px-3 py-1.5 text-xs bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">توضیحات و یادداشت فنی طرح</label>
                      <textarea
                        rows={2}
                        value={editNotes}
                        onChange={(e) => setEditNotes(e.target.value)}
                        placeholder="توضیحات مربوط به دما، ابعاد شیت یا چاپ..."
                        className="w-full border border-slate-300 rounded-xl px-3 py-1.5 text-xs bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                      />
                    </div>
                  </div>
                </div>

                {/* Linked Products Section */}
                {selectedTransfer && selectedTransfer.products && selectedTransfer.products.length > 0 && (
                  <div className="border-t border-slate-200 pt-3">
                    <div className="flex justify-between items-center mb-2.5">
                      <h4 className="text-xs font-extrabold text-slate-800 flex items-center gap-1.5">
                        <Package size={14} className="text-purple-600" />
                        کالاهای متصل به کد ترنسفر {selectedTransfer.code}
                      </h4>
                      <span className="text-[10px] bg-purple-100 text-purple-700 font-bold px-2.5 py-0.5 rounded-full font-mono">
                        {formatPersianNumber(selectedTransfer.products.length)} کالا
                      </span>
                    </div>

                    <div className="max-h-48 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                      {selectedTransfer.products.map((prod) => {
                        const prodImg = prod.thumbnail || prod.image;
                        return (
                          <div 
                            key={prod.id} 
                            className="p-2.5 bg-slate-50 hover:bg-blue-50/40 border border-slate-100 hover:border-blue-200 rounded-xl flex items-center justify-between text-xs transition-all group/modalitem"
                          >
                            <div className="flex items-center gap-2.5 overflow-hidden min-w-0 flex-1">
                              {prodImg ? (
                                <div
                                  onClick={() => setLightboxData({
                                    url: prod.image || prod.thumbnail || '',
                                    title: prod.name,
                                    subtitle: `کد محصول: ${prod.code} • دسته‌بندی: ${prod.category || '-'}`
                                  })}
                                  className="relative group/modalthumb shrink-0 cursor-pointer"
                                  title="کلیک برای مشاهده تصویر بزرگ محصول (لایت‌باکس)"
                                >
                                  <SafeImage 
                                    src={prodImg} 
                                    alt={prod.name} 
                                    className="w-11 h-11 rounded-xl object-cover border border-slate-200 bg-white shadow-2xs group-hover/modalthumb:ring-2 group-hover/modalthumb:ring-blue-500 group-hover/modalthumb:scale-105 transition-all" 
                                  />
                                  <div className="absolute inset-0 bg-slate-950/40 opacity-0 group-hover/modalthumb:opacity-100 transition-opacity rounded-xl flex items-center justify-center text-white">
                                    <Eye size={15} />
                                  </div>
                                </div>
                              ) : (
                                <div className="w-11 h-11 rounded-xl bg-slate-200 text-slate-600 font-bold flex items-center justify-center text-xs shrink-0 border border-slate-200">
                                  {prod.name.charAt(0)}
                                </div>
                              )}
                              <div className="truncate min-w-0 flex-1">
                                <p className="font-bold text-slate-800 text-xs truncate" title={prod.name}>{prod.name}</p>
                                <div className="flex items-center gap-1.5 mt-0.5">
                                  <span className="text-[10px] bg-white border border-slate-200 px-1.5 py-0.2 rounded text-slate-700 font-mono dir-ltr font-semibold">
                                    {prod.code}
                                  </span>
                                  {prod.category && (
                                    <span className="text-[10px] text-slate-400 truncate">
                                      {prod.category}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>

                            <div className="text-left font-mono shrink-0 flex items-center gap-2 mr-2">
                              <span className="text-[11px] font-bold text-slate-700 bg-white px-2 py-1 rounded-lg border border-slate-200 font-sans shadow-2xs">
                                {formatPersianNumber(prod.currentStock)} {prod.unit || 'عدد'}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Modal Actions */}
              <div className="px-5 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between shrink-0 gap-2">
                <div>
                  {selectedTransfer && (
                    <button
                      type="button"
                      onClick={handleDeleteTransferImage}
                      className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-xl text-xs font-bold flex items-center gap-1 transition-colors cursor-pointer"
                    >
                      <Trash2 size={13} />
                      حذف طرح
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsEditModalOpen(false)}
                    className="px-4 py-1.5 border border-slate-300 rounded-xl text-slate-600 hover:bg-slate-100 text-xs font-bold transition-colors cursor-pointer"
                  >
                    انصراف
                  </button>
                  <button
                    type="submit"
                    disabled={isSaving}
                    className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all shadow-xs disabled:opacity-50 cursor-pointer"
                  >
                    {isSaving ? <RefreshCw size={13} className="animate-spin" /> : <Check size={13} />}
                    {selectedTransfer ? 'ذخیره تغییرات' : 'ثبت ترنسفر جدید'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modern Accessible Lightbox Modal */}
      {lightboxData && (
        <div 
          className="fixed inset-0 bg-slate-950/85 backdrop-blur-md flex items-center justify-center z-50 p-4 sm:p-6 animate-in fade-in duration-200"
          onClick={() => setLightboxData(null)}
        >
          <div 
            className="relative max-w-4xl w-full bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            {/* Lightbox Header */}
            <div className="px-5 py-3.5 bg-slate-950/90 border-b border-slate-800/80 flex items-center justify-between text-white">
              <div className="min-w-0 flex-1 pr-2">
                <h3 className="font-bold text-sm text-slate-100 truncate">
                  {lightboxData.title || 'پیش‌نمایش تصویر'}
                </h3>
                {lightboxData.subtitle && (
                  <p className="text-xs text-slate-400 font-mono mt-0.5 truncate">
                    {lightboxData.subtitle}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <a
                  href={lightboxData.url}
                  target="_blank"
                  rel="noreferrer"
                  download
                  className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white rounded-xl text-xs transition-colors cursor-pointer"
                  title="دانلود یا باز کردن تصویر در تب جدید"
                >
                  <Download size={16} />
                </a>
                <button
                  onClick={() => setLightboxData(null)}
                  className="p-2 bg-slate-800 hover:bg-rose-600 text-slate-200 hover:text-white rounded-xl transition-colors cursor-pointer"
                  title="بستن (ESC)"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* Image Display Area */}
            <div className="p-4 sm:p-6 flex items-center justify-center bg-slate-950/70 max-h-[75vh] overflow-hidden">
              <img 
                src={lightboxData.url} 
                alt={lightboxData.title || 'تصویر پیش‌نمایش'} 
                className="max-h-[70vh] w-auto max-w-full object-contain rounded-xl shadow-lg select-none"
              />
            </div>

            {/* Lightbox Footer Note */}
            <div className="px-5 py-2.5 bg-slate-950/90 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400">
              <span>برای بستن می‌توانید روی دکمه ضربدر، پس‌زمینه یا کلید Esc کلیک کنید</span>
              <span className="font-mono text-slate-500">کیفیت اصلی</span>
            </div>
          </div>
        </div>
      )}

      {/* V10-3.2: پیش‌نمایش چاپ کارت ترنسفر */}
      <DocPrintModal
        isOpen={printTarget !== null}
        onClose={() => setPrintTarget(null)}
        title="کارت کد ترنسفر"
        subtitle={printTarget?.title || `ترنسفر کد ${printTarget?.code || ''}`}
        meta={[
          { label: 'کد ترنسفر', value: printTarget?.code || '' },
          { label: 'عنوان', value: printTarget?.title || '-' },
          { label: 'تعداد محصولات متصل', value: formatPersianNumber(printTarget?.productCount ?? 0) }
        ]}
        footerNote={printTarget?.notes || ''}
      >
        {printTarget && (
          <div className="space-y-3">
            {printTarget.image && (
              <div className="flex justify-center py-2">
                <img src={printTarget.image} alt={`ترنسفر ${printTarget.code}`} className="max-h-56 object-contain rounded-lg border border-slate-200" />
              </div>
            )}
            <h4 className="text-xs font-bold text-slate-700">محصولات متصل به این ترنسفر:</h4>
            {(Array.isArray(printTarget.products) ? printTarget.products : []).length > 0 ? (
              <table className="w-full text-right border-collapse text-xs border border-slate-300">
                <thead>
                  <tr className="bg-slate-100 border-b border-slate-300 text-slate-800 font-bold">
                    <th className="p-2 border-l border-slate-300">#</th>
                    <th className="p-2 border-l border-slate-300">کد کالا</th>
                    <th className="p-2 border-l border-slate-300">نام محصول</th>
                    <th className="p-2 text-center">دسته‌بندی</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 font-mono">
                  {(Array.isArray(printTarget.products) ? printTarget.products : []).map((prod: any, idx: number) => (
                    <tr key={prod.id}>
                      <td className="p-2 border-l border-slate-200 text-slate-500">{formatPersianNumber(idx + 1)}</td>
                      <td className="p-2 border-l border-slate-200 font-bold">{prod.code}</td>
                      <td className="p-2 border-l border-slate-200 font-sans font-bold">{prod.name}</td>
                      <td className="p-2 text-center font-sans">{prod.category || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-xs text-slate-400">هیچ محصولی به این کد ترنسفر متصل نشده است.</p>
            )}
          </div>
        )}
      </DocPrintModal>
    </div>
  );
}
