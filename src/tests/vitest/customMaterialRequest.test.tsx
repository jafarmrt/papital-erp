import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import type { FormEvent } from 'react';
import type { ProductionProject } from '../../types';
import { createPendingMaterialSchema } from '../../routes/pendingMaterials.schemas';
import { EMPTY_CUSTOM_MATERIAL_FORM, pendingMaterialRequestOf } from '../../lib/pendingMaterials/customMaterialRequest';

const fetchJson = vi.fn();
const held = new Set<string>();
vi.mock('../../api', () => ({ fetchJson: (...args: unknown[]) => fetchJson(...args), isAbortError: () => false }));
vi.mock('../../contexts/AuthContext', () => ({ useHasPermission: (key: string) => held.has(key) }));
vi.mock('react-hot-toast', () => { const toast = { error: vi.fn(), success: vi.fn() }; return { default: toast, toast }; });

import { useProjectInventory } from '../../hooks/useProjectInventory';
import { AddMaterialModal } from '../../components/project/AddMaterialModal';

afterEach(() => { cleanup(); fetchJson.mockReset(); held.clear(); });

const project = { id: 42, title: 'پروژه آزمون', inventory_control: { sections: [] } } as unknown as ProductionProject;
const submitEvent = { preventDefault: () => undefined } as unknown as FormEvent;

// v9.0.398 (TD-826، یافته B07-10، تصمیم ت۵ «الف»): «ماده سفارشی» کنترل پروژه درخواست به صف بررسی انبار می‌فرستد و کالا نمی‌سازد.
// پیش‌تر فرم مستقیم `POST /api/items` می‌زد، با موجودی اولیه، و صف و تأیید انباردار را دور می‌زد.
describe('project custom material request (TD-826)', () => {
  it('sends a pending-material request the route schema accepts, never an item', async () => {
    const posts: Array<{ url: string; body: Record<string, unknown> }> = [];
    fetchJson.mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === 'POST') { posts.push({ url, body: JSON.parse(String(init.body)) }); return Promise.resolve({ data: { id: 9 } }); }
      return Promise.resolve([]);
    });
    const { result } = renderHook(() => useProjectInventory(project, []));
    await waitFor(() => expect(fetchJson).toHaveBeenCalled());
    act(() => {
      result.current.handleOpenAddMaterialModal(0);
      result.current.setMaterialModalTab('custom');
      result.current.setCustomMaterialForm({ ...EMPTY_CUSTOM_MATERIAL_FORM, name: ' سنگ سفارشی ', category: 'سنگ', itemCode: 'STN123', weightedAverageCost: 5000 });
    });
    await act(async () => { await result.current.handleAddCustomMaterial(submitEvent); });

    expect(posts).toHaveLength(1);
    expect(posts[0].url).toBe('/api/pending-materials');
    expect(posts[0].body).toMatchObject({ name: 'سنگ سفارشی', code: 'STN123', category: 'سنگ', projectId: 42, weightedAverageCost: 5000 });
    expect(posts[0].body).not.toHaveProperty('current_stock');
    expect(createPendingMaterialSchema.safeParse({ body: posts[0].body }).success).toBe(true);
    expect(result.current.materialModalTab).toBe('warehouse');
  });

  it('builds the request body from the form without stock', () => {
    const body = pendingMaterialRequestOf({ ...EMPTY_CUSTOM_MATERIAL_FORM, name: 'مهره', category: 'مهره' }, undefined);
    expect(body.projectId).toBeNull();
    expect(Object.keys(body)).not.toContain('stockQty');
    expect(createPendingMaterialSchema.safeParse({ body }).success).toBe(true);
  });
});

const modalProps = () => ({
  isOpen: true, onClose: vi.fn(), changingItemTarget: null, materialModalTab: 'custom' as const, setMaterialModalTab: vi.fn(),
  warehouseItems: [], filteredWarehouseItems: [], warehouseSearchQuery: '', setWarehouseSearchQuery: vi.fn(),
  currentModalSection: undefined, handleSelectWarehouseItem: vi.fn(), customMaterialForm: EMPTY_CUSTOM_MATERIAL_FORM,
  setCustomMaterialForm: vi.fn(), allCategories: [], codePrefix: '', handleCategoryChangeForCustom: vi.fn(), handleAddCustomMaterial: vi.fn(),
});

describe('custom material tab by permission (TD-826)', () => {
  it('offers the request only to holders of pending_materials.create and never asks for opening stock', () => {
    render(<AddMaterialModal {...modalProps()} />);
    expect(screen.queryByText('درخواست ماده اولیه جدید')).toBeNull();
    expect(screen.queryByText('ارسال درخواست به انباردار')).toBeNull();
    cleanup();

    held.add('pending_materials.create');
    render(<AddMaterialModal {...modalProps()} />);
    expect(screen.getByText('درخواست ماده اولیه جدید')).toBeTruthy();
    expect(screen.getByText('ارسال درخواست به انباردار')).toBeTruthy();
    expect(screen.queryByText(/موجودی اولیه/)).toBeNull();
  });
});
