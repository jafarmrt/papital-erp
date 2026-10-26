import type { FormEvent, InvalidEvent } from 'react';

/**
 * v11 phase 6.3a (U25): props of a required text field whose empty-field bubble is Persian. The browser writes its own
 * bubble in the browser's language («Please fill out this field.» in an English browser); `onInvalid` replaces it with
 * «<label> را وارد کنید.» and the next keystroke clears it, so the field is checked again on the next submit.
 */
export function persianRequired(label: string) {
  return {
    required: true,
    onInvalid: (event: InvalidEvent<HTMLInputElement>) => {
      const field = event.currentTarget;
      if (field.validity.valueMissing) field.setCustomValidity(`${label} را وارد کنید.`);
    },
    onInput: (event: FormEvent<HTMLInputElement>) => {
      event.currentTarget.setCustomValidity('');
    },
  };
}
