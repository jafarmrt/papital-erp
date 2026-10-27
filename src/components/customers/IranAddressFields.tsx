import React from 'react';
import { SearchableSelect } from '../SearchableSelect';
import { IRAN_PROVINCE_NAMES, cityChoices } from '../../lib/customers/iranDivisions';

interface IranAddressFieldsProps {
  /** پیشوند شناسه دو فیلد؛ برچسب‌ها با `${id}-province` و `${id}-city` به آن‌ها اشاره می‌کنند. */
  id: string;
  province: string;
  city: string;
  onChange: (next: { province: string; city: string }) => void;
}

const PROVINCE_OPTIONS = IRAN_PROVINCE_NAMES.map(name => ({ value: name, label: name }));

/**
 * v10.1.33 (TD-1281، الگوی `address-picker` وایب فارسی): استان و شهر از فهرست ۳۱ استان. فهرست شهر دنبال
 * استان می‌آید، با عوض شدن استان شهر پاک می‌شود و تا استانی انتخاب نشده شهر غیرفعال است. شهر ذخیره‌شده‌ای
 * که در فهرست نیست در فهرست می‌ماند تا ویرایش طرف حساب قدیمی آن را پاک نکند.
 */
export function IranAddressFields({ id, province, city, onChange }: IranAddressFieldsProps) {
  const cityOptions = React.useMemo(
    () => cityChoices(province, city).map(name => ({ value: name, label: name })),
    [province, city]
  );

  return (
    <>
      <div>
        <label htmlFor={`${id}-province`} className="block text-[11px] font-medium mb-1 text-slate-600">استان</label>
        <SearchableSelect
          id={`${id}-province`}
          options={PROVINCE_OPTIONS}
          value={province}
          onChange={next => { if (next !== province) onChange({ province: next, city: '' }); }}
          placeholder="انتخاب استان"
          valueLabel={province}
          maxResults={IRAN_PROVINCE_NAMES.length}
        />
      </div>
      <div>
        <label htmlFor={`${id}-city`} className="block text-[11px] font-medium mb-1 text-slate-600">شهر</label>
        <SearchableSelect
          id={`${id}-city`}
          options={cityOptions}
          value={city}
          onChange={next => onChange({ province, city: next })}
          placeholder={province ? `شهرهای ${province}` : 'اول استان را انتخاب کنید'}
          disabled={!province}
          maxResults={cityOptions.length || 1}
        />
      </div>
    </>
  );
}
