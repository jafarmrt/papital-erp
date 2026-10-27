import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { User } from '../../types';

vi.mock('../../api', () => ({ fetchJson: vi.fn(() => Promise.resolve({})) }));

const { default: UserProfileModal } = await import('../../components/UserProfileModal');

// v11 phase 6.3b (6.3a review follow-up): the profile window fills its form when it opens; a new user object of the same
// person while it is open (a refreshed session) kept resetting the typed name.

afterEach(cleanup);

const OLD_NAME = 'کاربر آزمون';
const TYPED_NAME = 'نام تازه';
const person = (): User => ({ id: 1, username: 'u', full_name: OLD_NAME, role: 'manager' });
const noop = () => undefined;

describe('the profile window keeps what was typed', () => {
  it('keeps the typed name when the user object is renewed, and refills on the next opening', () => {
    const { rerender } = render(<UserProfileModal user={person()} isOpen onClose={noop} onUserUpdate={noop} roleName="r" />);
    const name = screen.getByDisplayValue(OLD_NAME) as HTMLInputElement;
    fireEvent.change(name, { target: { value: TYPED_NAME } });
    rerender(<UserProfileModal user={person()} isOpen onClose={noop} onUserUpdate={noop} roleName="r" />);
    expect((screen.getByDisplayValue(TYPED_NAME) as HTMLInputElement).value).toBe(TYPED_NAME);
    rerender(<UserProfileModal user={person()} isOpen={false} onClose={noop} onUserUpdate={noop} roleName="r" />);
    rerender(<UserProfileModal user={person()} isOpen onClose={noop} onUserUpdate={noop} roleName="r" />);
    expect(screen.getByDisplayValue(OLD_NAME)).toBeTruthy();
  });
});
