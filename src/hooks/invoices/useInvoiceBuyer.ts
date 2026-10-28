import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchJson } from '../../api';
import type { Customer } from '../../types';
import { buyerFieldsOf, listFromResponse, type BuyerFields, type BuyerSource } from '../../lib/invoices/invoiceForm';
import { QUERY_KEYS } from '../../lib/queryKeys';
import { PICK_LIST_URLS } from '../../lib/permissions/pickLists';
import { isCutPickList } from '../../lib/permissions/pickListCap';
import { useMissingPickRows, withPickRows } from '../queries/usePickListRows';

/** v11 phase 6.1ch (C13): how many of the server's matches for a buyer's name are read to find the party of that very name */
const BUYER_NAME_MATCHES = 50;
const NO_CUSTOMERS: Customer[] = [];

function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * v11 phase 6.1ch (C13): the parties the buyer fields match against: the pick list, and when it was cut at the cap, the
 * chosen party read by id and the parties the server finds for the buyer's name (a draft keeps only the name)
 */
function useBuyerCandidates(customersList: Customer[], buyerName: string, selectedCustomerId: string): Customer[] {
  const listCut = isCutPickList(customersList);
  const name = buyerName.trim();
  const listed = name !== '' && customersList.some(c => sameName(c.name, name));
  const byName = useQuery<Customer[]>({
    queryKey: QUERY_KEYS.customers.options({ buyerName: name.toLowerCase() }),
    queryFn: async ({ signal }) => listFromResponse<Customer>(await fetchJson<unknown>(
      `${PICK_LIST_URLS.customers}?${new URLSearchParams({ search: name, limit: String(BUYER_NAME_MATCHES) }).toString()}`, { signal },
    )),
    enabled: listCut && name !== '' && !listed && !selectedCustomerId,
    staleTime: 60 * 1000,
  });
  const nameRows = listCut ? byName.data : undefined;
  const withNames = useMemo(() => withPickRows(customersList, nameRows ?? NO_CUSTOMERS), [customersList, nameRows]);
  // the party chosen from the name's matches is already held, so only a party chosen elsewhere is read by id
  const byId = useMissingPickRows<Customer>('customers', withNames, [selectedCustomerId], customersList.length > 0);
  return useMemo(() => withPickRows(withNames, byId.rows), [withNames, byId.rows]);
}

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

  const candidates = useBuyerCandidates(customersList, buyerName, selectedCustomerId);

  // تکمیل فیلدهای خالی خریدار از پرونده مشتری هم‌نام
  useEffect(() => {
    if (buyerName && candidates.length > 0) {
      const match = candidates.find(c => sameName(c.name, buyerName) || String(c.id) === String(selectedCustomerId));
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
  }, [buyerName, candidates, selectedCustomerId, buyerCity, buyerPhone, buyerAddress]);

  const handleCustomerSelect = (val: string, rawC?: BuyerSource) => {
    setSelectedCustomerId(val);
    if (!val) {
      setBuyer({ buyerName: '', buyerCity: '', buyerPhone: '', buyerAddress: '' });
      return;
    }
    const customer = rawC || candidates.find(c => String(c.id) === String(val));
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
