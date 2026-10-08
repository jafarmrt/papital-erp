import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { BankCardInput } from '../../components/common/BankCardInput';
import { ShebaInput } from '../../components/common/ShebaInput';

// v9.0.310 (TD-682، B16-18): Backspace روی جداکننده رقم قبلی را حذف می‌کند و مکان‌نما همان‌جا می‌ماند
afterEach(cleanup);

function Card() {
  const [value, setValue] = useState('6037991812345678');
  return <BankCardInput value={value} onChange={setValue} showBankBadge={false} />;
}
function Sheba() {
  const [value, setValue] = useState('IR820540102680020817909002');
  return <ShebaInput value={value} onChange={setValue} showBankBadge={false} />;
}

function backspaceAt(input: HTMLInputElement, caret: number) {
  input.focus();
  input.setSelectionRange(caret, caret);
  fireEvent.keyDown(input, { key: 'Backspace' });
}

describe('grouped digits caret after Backspace on a separator (TD-682)', () => {
  it('bank card: the caret stays where the digit was removed', async () => {
    render(<Card />);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.value).toBe('6037 - 9918 - 1234 - 5678');
    backspaceAt(input, 7);
    await waitFor(() => expect(input.value).toBe('6039 - 9181 - 2345 - 678'));
    await waitFor(() => expect(input.selectionStart).toBe(3));
  });

  it('Sheba: the caret stays where the digit was removed', async () => {
    render(<Sheba />);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.value).toBe('82 0540 1026 8002 0817 9090 02');
    backspaceAt(input, 8);
    await waitFor(() => expect(input.value).toBe('82 0541 0268 0020 8179 0900 2'));
    await waitFor(() => expect(input.selectionStart).toBe(6));
  });
});
