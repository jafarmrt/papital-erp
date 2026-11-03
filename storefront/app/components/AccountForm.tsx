import type { ReactNode } from 'react';
import { Link } from 'react-router';

/**
 * v11 phase 8.4b: the frame and fields of the sign-in, sign-up and set-password pages. Built for the phone first: one
 * column, inputs and buttons at least 48px tall, the keyboard each field needs (`inputMode`, `autoComplete`), and the
 * SMS code field marked `one-time-code` so the phone offers the code from the message.
 */
export function AccountShell({ title, intro, children }: { title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-md px-4 pt-8 pb-16 lg:pt-12">
      <nav aria-label="مسیر" className="text-sm text-muted-foreground">
        <Link to="/" className="hover:text-foreground">خانه</Link>
      </nav>
      <h1 className="mt-3 text-2xl font-extrabold text-balance lg:text-3xl">{title}</h1>
      <div className="tile-rule mt-4 w-24" aria-hidden />
      {intro && <div className="mt-4 text-base leading-8 text-muted-foreground">{intro}</div>}
      <div className="mt-6 space-y-5">{children}</div>
    </div>
  );
}

export function FormError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-control border border-destructive/40 bg-card px-4 py-3 text-sm leading-7 text-destructive">
      {message}
    </p>
  );
}

export function FormNote({ children }: { children: ReactNode }) {
  return <p role="status" className="rounded-control border border-border bg-card px-4 py-3 text-sm leading-7 text-muted-foreground">{children}</p>;
}

const inputClass = 'block min-h-12 w-full rounded-control border border-border bg-card px-4 text-lg text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-ring';

export function Field(props: {
  label: string;
  name: string;
  type?: 'text' | 'tel' | 'password';
  autoComplete: string;
  inputMode?: 'text' | 'tel' | 'numeric';
  defaultValue?: string;
  hint?: string;
  dir?: 'ltr' | 'rtl';
  maxLength?: number;
  required?: boolean;
  autoFocus?: boolean;
}) {
  const id = `field-${props.name}`;
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-base font-bold">{props.label}</label>
      <input
        id={id} name={props.name} type={props.type ?? 'text'} autoComplete={props.autoComplete} inputMode={props.inputMode}
        defaultValue={props.defaultValue} dir={props.dir} maxLength={props.maxLength} required={props.required ?? true}
        autoFocus={props.autoFocus} aria-describedby={props.hint ? `${id}-hint` : undefined}
        className={`${inputClass} ${props.dir === 'ltr' ? 'text-left' : ''}`}
      />
      {props.hint && <p id={`${id}-hint`} className="text-sm leading-6 text-muted-foreground">{props.hint}</p>}
    </div>
  );
}

export function PhoneField({ defaultValue, autoFocus }: { defaultValue?: string; autoFocus?: boolean }) {
  return (
    <Field label="شمارهٔ همراه" name="phone" type="tel" inputMode="tel" autoComplete="tel" dir="ltr" maxLength={20}
      defaultValue={defaultValue} autoFocus={autoFocus} hint="مانند ۰۹۱۲۱۲۳۴۵۶۷" />
  );
}

export function CodeField() {
  return (
    <Field label="کد پیامک‌شده" name="code" inputMode="numeric" autoComplete="one-time-code" dir="ltr" maxLength={12} autoFocus
      hint="کد شش‌رقمی سه دقیقه اعتبار دارد." />
  );
}

export function SubmitButton({ children, intent, busy, secondary }: { children: ReactNode; intent?: string; busy?: boolean; secondary?: boolean }) {
  return (
    <button
      type="submit" name={intent ? 'intent' : undefined} value={intent} disabled={busy}
      className={secondary
        ? 'inline-flex min-h-12 w-full items-center justify-center rounded-control border border-border bg-card px-6 text-base font-bold hover:border-brand disabled:opacity-60'
        : 'inline-flex min-h-12 w-full items-center justify-center rounded-control bg-primary px-6 text-lg font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-60'}
    >
      {children}
    </button>
  );
}
