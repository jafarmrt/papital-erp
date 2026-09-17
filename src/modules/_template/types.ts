/**
 * 📦 Module Template TypeScript Definitions & DTOs
 */

export type TemplateStatus = 'draft' | 'active' | 'archived';

export interface TemplateEntity {
  id: number;
  code: string;
  title: string;
  status: TemplateStatus;
  amount: number;
  quantity: number;
  metadata?: Record<string, unknown> | null;
  notes?: string | null;
  version: number;
  isDeleted: number;
  createdBy?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTemplateDTO {
  code?: string;
  title: string;
  status?: TemplateStatus;
  amount?: number;
  quantity?: number;
  metadata?: Record<string, unknown>;
  notes?: string;
}

export interface UpdateTemplateDTO {
  title?: string;
  status?: TemplateStatus;
  amount?: number;
  quantity?: number;
  metadata?: Record<string, unknown>;
  notes?: string;
  version?: number;
}

export interface TemplateFilterQueryDTO {
  page?: number;
  limit?: number;
  search?: string;
  status?: TemplateStatus;
  sortBy?: 'createdAt' | 'title' | 'amount';
  sortOrder?: 'asc' | 'desc';
}

export interface PaginatedTemplateResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
