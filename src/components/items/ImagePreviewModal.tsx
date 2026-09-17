
interface ImagePreviewModalProps {
  imageUrl: string | null;
  onClose: () => void;
}

export function ImagePreviewModal({ imageUrl, onClose }: ImagePreviewModalProps) {
  if (!imageUrl) return null;

  return (
    <div 
      className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm z-50 flex items-center justify-center p-4" 
      onClick={onClose}
    >
      <div 
        className="relative bg-white p-2 rounded-xl shadow-2xl max-w-4xl max-h-[90vh] flex flex-col" 
        onClick={e => e.stopPropagation()}
      >
        <button 
          onClick={onClose}
          className="absolute -top-4 -right-4 w-8 h-8 bg-slate-800 text-white rounded-full flex items-center justify-center hover:bg-slate-700 shadow-lg border-2 border-white z-10"
        >
          ✕
        </button>
        <div className="overflow-auto rounded-lg">
          <img 
            src={imageUrl} 
            alt="نمای بزرگ تصویر" 
            className="max-w-full max-h-[85vh] object-contain rounded" 
          />
        </div>
      </div>
    </div>
  );
}

export default ImagePreviewModal;
