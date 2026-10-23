import React, { useState } from 'react';
import toast from 'react-hot-toast';
import type { ProjectInventoryControlItemResult } from '../../types';
import { toPersianDigits } from '../../utils';
import { directConversionRate } from '../../lib/projects/unitConversion';
import { roundToOneDecimal } from '../../components/project/projectInventoryUtils';

/** the material row whose unit is converted, and what it asks */
export interface ConversionTarget {
  secIdx: number;
  prodId?: string;
  itemId: string;
  gIdx?: number;
  itemName: string;
  itemCode?: string;
  originalQty: number;
  originalUnit: string;
  warehouseUnit: string;
}

export interface ConversionForm {
  targetUnit: string;
  mode: 'rate' | 'direct';
  rate: number;
  directConvertedQty: number;
  notes: string;
}

type ConversionFields = Pick<ProjectInventoryControlItemResult, 'convertedUnit' | 'conversionRate' | 'convertedQty'>;

interface UnitConversionOptions {
  /** a product's row of a section gets the conversion */
  updatePerItemFields: (secIdx: number, prodId: string, itemId: string, patch: ConversionFields) => void;
  /** a global row of a section gets the conversion */
  updateGlobalItemFields: (secIdx: number, gIdx: number, patch: ConversionFields) => void;
}

/**
 * The materials tab's «تبدیل واحد» window: a row's quantity in another unit, by a rate or a typed converted quantity
 * (v9.0.372 TD-820: the rate of a typed quantity is not rounded; the server converts the requirement with it). 10.3 (ARCH
 * review finding 3, part 11): moved out of `useProjectInventory` unchanged.
 */
export function useUnitConversion({ updatePerItemFields, updateGlobalItemFields }: UnitConversionOptions) {
  const [isUnitConversionModalOpen, setIsUnitConversionModalOpen] = useState(false);
  const [conversionTarget, setConversionTarget] = useState<ConversionTarget | null>(null);
  const [conversionForm, setConversionForm] = useState<ConversionForm>({ targetUnit: '', mode: 'rate', rate: 1, directConvertedQty: 1, notes: '' });

  const handleOpenUnitConversionModal = (
    secIdx: number,
    itemId: string,
    prodId: string | undefined,
    gIdx: number | undefined,
    itemName: string,
    itemCode: string | undefined,
    originalQty: number,
    originalUnit: string,
    warehouseUnit: string,
    convertedUnit?: string,
    conversionRate?: number,
    convertedQty?: number
  ) => {
    setConversionTarget({ secIdx, prodId, itemId, gIdx, itemName, itemCode, originalQty, originalUnit, warehouseUnit });
    setConversionForm({
      targetUnit: convertedUnit || warehouseUnit || 'ریسه',
      mode: 'rate',
      rate: conversionRate || 1,
      directConvertedQty: convertedQty || roundToOneDecimal(originalQty / (conversionRate || 1)),
      notes: ''
    });
    setIsUnitConversionModalOpen(true);
  };

  const handleApplyUnitConversion = (e: React.FormEvent) => {
    e.preventDefault();
    if (!conversionTarget) return;

    const { secIdx, prodId, itemId, gIdx, originalQty } = conversionTarget;
    const { targetUnit, mode, rate, directConvertedQty } = conversionForm;

    let finalConvertedQty = 0;
    let finalRate = rate;

    if (mode === 'rate') {
      finalRate = Math.max(0.0001, rate);
      finalConvertedQty = roundToOneDecimal(originalQty / finalRate);
    } else {
      finalConvertedQty = directConvertedQty;
      // v9.0.372 (TD-820): the rate is not rounded; the server converts the requirement with it
      finalRate = directConversionRate(originalQty, directConvertedQty);
    }

    const conversion = { convertedUnit: targetUnit, conversionRate: finalRate, convertedQty: finalConvertedQty };
    if (prodId) updatePerItemFields(secIdx, prodId, itemId, conversion);
    else if (gIdx !== undefined) updateGlobalItemFields(secIdx, gIdx, conversion);

    setIsUnitConversionModalOpen(false);
    toast.success(`ضریب تبدیل واحد ثبت شد: ${toPersianDigits(originalQty)} ${conversionTarget.originalUnit} ➔ ${toPersianDigits(finalConvertedQty)} ${targetUnit}`);
  };

  return {
    isUnitConversionModalOpen, setIsUnitConversionModalOpen, conversionTarget, conversionForm, setConversionForm,
    handleOpenUnitConversionModal, handleApplyUnitConversion,
  };
}
