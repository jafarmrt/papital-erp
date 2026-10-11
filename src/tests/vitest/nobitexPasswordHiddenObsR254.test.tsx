import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PersonnelDetailModal } from '../../components/personnel/PersonnelDetailModal';
import { PersonnelFormModal } from '../../components/personnel/PersonnelFormModal';
import type { PersonnelFormData } from '../../hooks/usePersonnel';
import type { Personnel } from '../../types';

// v10.0.264 (OBS-R2-54, TD-994): the personnel Nobitex password is hidden in the form and the detail view
// and appears only after the reveal button; before, the form used type=text and the detail printed it

const SECRET = 'Nobitex-Secret-42';
const REVEAL = 'نمایش رمز';

afterEach(cleanup);

describe('nobitex password hidden (OBS-R2-54)', () => {
  it('detail view masks the password until the reveal button is pressed', () => {
    const personnel = { id: 7, firstName: 'علی', lastName: 'رضایی', fullName: 'علی رضایی', nobitexPassword: SECRET } as unknown as Personnel;
    render(<PersonnelDetailModal isOpen onClose={vi.fn()} personnel={personnel} onEdit={vi.fn()} />);
    expect(screen.queryByText(SECRET)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: REVEAL }));
    expect(screen.getByText(SECRET)).toBeTruthy();
  });

  it('form field is a password input until the reveal button is pressed', () => {
    // every unknown field reads as an empty string, so the form renders without the hook's initial data
    const formData = new Proxy({ nobitexPassword: SECRET } as Record<string, unknown>, {
      get: (target, key) => (typeof key === 'string' && !(key in target) ? '' : target[key as string]),
    }) as unknown as PersonnelFormData;
    const { container } = render(
      <PersonnelFormModal isOpen onClose={vi.fn()} onSubmit={vi.fn()} editingId={null} formData={formData}
        setFormData={vi.fn()} usersList={[]} isSaving={false} />,
    );
    const field = container.querySelector('input[name="personnel_nobitex_password_field"]') as HTMLInputElement;
    expect(field.type).toBe('password');
    expect(field.value).toBe(SECRET);
    fireEvent.click(screen.getByRole('button', { name: REVEAL }));
    expect(field.type).toBe('text');
  });
});
