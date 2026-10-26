import type { FormEvent, InvalidEvent } from 'react';

/**
 * v11 phase 6.3a (U25): props of a required text field whose empty-field bubble is Persian. The browser writes its own
 * bubble in the browser's language («Please fill out this field.» in an English browser); `onInvalid` replaces it with
 * «<label> را وارد کنید.» and any change of the value clears it, so the field is checked again on the next submit.
 * Review of #406: the clearing listens to React's change (capture phase, so the field's own `onChange` stays its own),
 * which also fires when a password manager fills the field without an `input` event; and an invalid event on a field
 * that is no longer empty clears the message too, so a filled field is never left refused.
 */
export function persianRequired(label: string) {
  return {
    required: true,
    onInvalid: (event: InvalidEvent<HTMLInputElement>) => {
      const field = event.currentTarget;
      field.setCustomValidity(field.validity.valueMissing ? `${label} را وارد کنید.` : '');
    },
    onChangeCapture: (event: FormEvent<HTMLInputElement>) => {
      event.currentTarget.setCustomValidity('');
    },
  };
}
