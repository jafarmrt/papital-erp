export interface UnifiedExcelModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  typeFilter?: 'product' | 'raw_material' | '';
  title?: string;
}

export interface PreviewRow {
  index: number; // 0-based
  raw: Record<string, any>;
  code: string;
  name: string;
  category: string;
  type: string;
  expectedPrefix: string;
  hasPrefixMismatch: boolean;
  isDuplicateInBatch: boolean;
  isDuplicateInDb: boolean;
  /** v10.0.1 (TD-1010): سلولی که سرور ردیف را برایش رد می‌کند */
  hasCellError: boolean;
  issues: string[];
}

export interface ImportResult {
  createdCount: number;
  updatedCount: number;
  pricesCount: number;
  errors: Array<{ row: number; message: string }>;
}
