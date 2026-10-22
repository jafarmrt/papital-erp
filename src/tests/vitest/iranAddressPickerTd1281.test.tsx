/**
 * The customer form picks province and city from the list of Iran's 31 provinces (v10.1.33, TD-1281, Vibe Farsi).
 */
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { IRAN_PROVINCES, IRAN_PROVINCE_NAMES, citiesOf, cityChoices } from '../../lib/customers/iranDivisions';
import { IranAddressFields } from '../../components/customers/IranAddressFields';

const ISFAHAN = 'اصفهان';
const KASHAN = 'کاشان';
const TEHRAN = 'تهران';
const SHAHRIAR = 'شهریار';
const LEGACY_CITY = 'روستای قدیمی';
const PROVINCE_LABEL = 'استان';
const CITY_LABEL = 'شهر';
const PICK_PROVINCE_FIRST = 'اول استان را انتخاب کنید';
const ARABIC_KASHAN = 'كاشان';

function Harness({ initial }: { initial: { province: string; city: string } }) {
  const [value, setValue] = React.useState(initial);
  return (
    <div>
      <IranAddressFields id="party" province={value.province} city={value.city} onChange={setValue} />
      <output data-testid="value">{`${value.province}|${value.city}`}</output>
    </div>
  );
}

function pick(label: string, option: string, typed?: string) {
  fireEvent.click(screen.getByLabelText(label));
  if (typed) fireEvent.change(screen.getByRole('combobox'), { target: { value: typed } });
  const list = screen.getByRole('listbox');
  fireEvent.click(within(list).getByText(option));
}

describe('iran_address_picker_td_1281', () => {
  afterEach(cleanup);

  it('lists the 31 provinces, each with its capital first and its own cities', () => {
    expect(IRAN_PROVINCE_NAMES).toHaveLength(31);
    expect(new Set(IRAN_PROVINCE_NAMES).size).toBe(31);
    for (const province of IRAN_PROVINCES) {
      expect(province.cities[0]).toBe(province.capital);
      expect(province.cities.length).toBeGreaterThan(1);
    }
    expect(citiesOf(ISFAHAN)).toContain(KASHAN);
    expect(citiesOf('')).toEqual([]);
  });

  it('keeps a stored city that is not in the list so an older party is not cleared', () => {
    expect(cityChoices(ISFAHAN, LEGACY_CITY)[0]).toBe(LEGACY_CITY);
    expect(cityChoices(ISFAHAN, KASHAN)).toEqual(citiesOf(ISFAHAN));
  });

  it('enables the city only after a province and lists that province\'s cities', () => {
    render(<Harness initial={{ province: '', city: '' }} />);
    const city = screen.getByLabelText(CITY_LABEL) as HTMLButtonElement;
    expect(city.disabled).toBe(true);
    expect(city.textContent).toContain(PICK_PROVINCE_FIRST);

    pick(PROVINCE_LABEL, ISFAHAN);
    expect((screen.getByLabelText(CITY_LABEL) as HTMLButtonElement).disabled).toBe(false);
    pick(CITY_LABEL, KASHAN, ARABIC_KASHAN);
    expect(screen.getByTestId('value').textContent).toBe(`${ISFAHAN}|${KASHAN}`);
  });

  it('clears the city when the province changes', () => {
    render(<Harness initial={{ province: TEHRAN, city: SHAHRIAR }} />);
    pick(PROVINCE_LABEL, ISFAHAN);
    expect(screen.getByTestId('value').textContent).toBe(`${ISFAHAN}|`);
  });
});
