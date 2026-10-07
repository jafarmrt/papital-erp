/**
 * v9.0.223 (TD-534, B02-19): the mention list shows the Persian name of each colleague's role from
 * `/users/list-simple`, which no longer sends the role code. Before, it showed the raw code (for example cfo_accountant).
 */
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MentionTextarea, type MentionUser } from '../../components/MentionTextarea';

const colleagues: MentionUser[] = [
  { id: 7, username: 'sara', full_name: 'سارا احمدی', role_name: 'حسابدار ارشد' },
  { id: 8, username: 'reza', full_name: 'رضا کریمی', role_name: '' },
];

function Harness() {
  const [value, setValue] = useState('');
  return <MentionTextarea value={value} onChange={setValue} users={colleagues} placeholder="متن" />;
}

afterEach(cleanup);

describe('mention list role label (TD-534)', () => {
  it('shows the role name and never a role code', () => {
    render(<Harness />);
    const box = screen.getByPlaceholderText('متن');
    fireEvent.change(box, { target: { value: '@' } });
    expect(screen.getByText('سارا احمدی')).toBeTruthy();
    expect(screen.getByText('حسابدار ارشد')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/accountant|admin/);
  });
});
