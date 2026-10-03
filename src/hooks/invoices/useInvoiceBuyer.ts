import { useEffect, useState } from 'react';
import type { Customer } from '../../types';
import { buyerFieldsOf, type BuyerFields, type BuyerSource } from '../../lib/invoices/invoiceForm';

/**
 * صفحه صدور فاکتور: فیلدهای خریدار (طرف حساب) — منتقل‌شده از CreateInvoicePage.
 * نگاشت مشتری → شهر/تلفن/نشانی خریدار یک بار در buyerFieldsOf نوشته شده و هم در انتخاب مشتری و هم در
 * تطبیق نام خریدار (پیش‌نویس، CRM، ویرایش) به کار می‌رود.
 */
export function useInvoiceBuyer(customersList: Customer[]) {
  const [buyerName, setBuyerName] = useState('');
  const [buyerCity, setBuyerCity] = useState('');
  const [buyerPhone, setBuyerPhone] = useState('');
  const [buyerAddress, setBuyerAddress] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');

  const setBuyer = (fields: BuyerFields) => {
    setBuyerName(fields.buyerName);
    setBuyerCity(fields.buyerCity);
    setBuyerPhone(fields.buyerPhone);
    setBuyerAddress(fields.buyerAddress);
  };

  // تکمیل فیلدهای خالی خریدار از پرونده مشتری هم‌نام
  useEffect(() => {
    if (buyerName && customersList.length > 0) {
      const match = customersList.find(c => c.name.trim().toLowerCase() === buyerName.trim().toLowerCase() || String(c.id) === String(selectedCustomerId));
      if (match) {
        if (!selectedCustomerId) {
          setSelectedCustomerId(match.id.toString());
        }
        const fields = buyerFieldsOf(match);
        if (!buyerCity) setBuyerCity(fields.buyerCity);
        if (!buyerPhone) setBuyerPhone(fields.buyerPhone);
        if (!buyerAddress) setBuyerAddress(fields.buyerAddress);
      }
    } else if (!buyerName && selectedCustomerId) {
      setSelectedCustomerId('');
    }
  }, [buyerName, customersList, selectedCustomerId, buyerCity, buyerPhone, buyerAddress]);

  const handleCustomerSelect = (val: string, rawC?: BuyerSource) => {
    setSelectedCustomerId(val);
    if (!val) {
      setBuyer({ buyerName: '', buyerCity: '', buyerPhone: '', buyerAddress: '' });
      return;
    }
    const customer = rawC || customersList.find(c => String(c.id) === String(val));
    if (customer) setBuyer(buyerFieldsOf(customer));
  };

  return {
    buyerName, setBuyerName,
    buyerCity, setBuyerCity,
    buyerPhone, setBuyerPhone,
    buyerAddress, setBuyerAddress,
    selectedCustomerId, setSelectedCustomerId,
    setBuyer,
    handleCustomerSelect,
  };
}

export type InvoiceBuyerState = ReturnType<typeof useInvoiceBuyer>;
