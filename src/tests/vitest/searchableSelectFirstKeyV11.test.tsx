import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SearchableSelect } from '../../components/SearchableSelect';
import { typedLetterOf } from '../../hooks/usePickListKeys';

// v11 phase 6.3b (U23, evaluation finding F23): typing right after opening the customer picker turned «پارسیان» into
// «ارسیانپ». A letter typed on the picker's button opens it with that letter in the search, and the search box takes the
// focus in the same commit, with the caret after the letter.

afterEach(cleanup);

const OPTIONS = [{ value: '1', label: 'پارسیان' }, { value: '2', label: 'نگین' }];

describe('the first letter typed on the picker', () => {
  it('opens the list with that letter in the search, focused, caret at the end', () => {
    render(<SearchableSelect options={OPTIONS} value="" onChange={() => undefined} />);
    const button = screen.getByRole('button');
    button.focus();
    fireEvent.keyDown(button, { key: 'پ' });
    const search = screen.getByRole('combobox') as HTMLInputElement;
    expect(search.value).toBe('پ');
    expect(document.activeElement).toBe(search);
    expect(search.selectionStart).toBe(1);
    expect(screen.getByRole('option', { name: 'پارسیان' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'نگین' })).toBeNull();
  });

  it('adds to the search when the list is open but the button still has the focus', () => {
    render(<SearchableSelect options={OPTIONS} value="" onChange={() => undefined} />);
    const button = screen.getByRole('button');
    fireEvent.click(button);
    button.focus();
    fireEvent.keyDown(button, { key: 'ن' });
    fireEvent.keyDown(button, { key: 'گ' });
    expect((screen.getByRole('combobox') as HTMLInputElement).value).toBe('نگ');
  });

  it('focuses the search box when the list opens with a click', () => {
    render(<SearchableSelect options={OPTIONS} value="" onChange={() => undefined} />);
    fireEvent.click(screen.getByRole('button'));
    expect(document.activeElement).toBe(screen.getByRole('combobox'));
  });

  it('counts only a key that types a letter', () => {
    expect(typedLetterOf({ key: 'پ' })).toBe('پ');
    expect(typedLetterOf({ key: '7' })).toBe('7');
    expect(typedLetterOf({ key: ' ' })).toBe('');
    expect(typedLetterOf({ key: 'Enter' })).toBe('');
    expect(typedLetterOf({ key: 'ArrowDown' })).toBe('');
    expect(typedLetterOf({ key: 'v', ctrlKey: true })).toBe('');
    expect(typedLetterOf({ key: 'c', metaKey: true })).toBe('');
  });
});
