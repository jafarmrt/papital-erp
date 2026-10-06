import { describe, expect, it } from 'vitest';
import { usersLinkedToOtherPersonnel } from '../../lib/personnel/personnelUserLinks';

describe('usersLinkedToOtherPersonnel (TD-435)', () => {
  const list = [
    { id: 1, userId: 10, fullName: 'زهرا احمدی' },
    { id: 2, userId: null, fullName: 'بی کاربر' },
    { id: 3, userId: '11', fullName: 'علی رضایی' },
  ];

  it('names the personnel each user is linked to', () => {
    const linked = usersLinkedToOtherPersonnel(list, null);
    expect([...linked.entries()]).toEqual([[10, 'زهرا احمدی'], [11, 'علی رضایی']]);
  });

  it('leaves the user of the personnel being edited selectable', () => {
    const linked = usersLinkedToOtherPersonnel(list, 1);
    expect(linked.has(10)).toBe(false);
    expect(linked.get(11)).toBe('علی رضایی');
  });
});
