import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

// v10.0.263 (OBS-R2-54، TD-994): گذرواژه حساب نوبیتکس پرسنل در فرم و جزئیات پنهان است و فقط با دکمه «نمایش» دیده می‌شود؛
// پیش‌تر فرم آن را با type=text و جزئیات آن را آشکار نشان می‌داد

const MASK = '••••••••';

function RevealButton({ shown, onToggle }: { shown: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={shown ? 'پنهان کردن رمز' : 'نمایش رمز'}
      title={shown ? 'پنهان کردن رمز' : 'نمایش رمز'}
      className="p-1.5 text-slate-500 hover:text-slate-800 rounded-lg"
    >
      {shown ? <EyeOff size={14} /> : <Eye size={14} />}
    </button>
  );
}

export function NobitexPasswordInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [shown, setShown] = useState(false);
  return (
    <div>
      <label htmlFor="personnel_nobitex_password_field" className="block text-xs font-bold text-slate-700 mb-1">رمز عبور نوبیتکس</label>
      <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 rounded-xl focus-within:border-blue-500">
        <input
          id="personnel_nobitex_password_field"
          type={shown ? 'text' : 'password'}
          name="personnel_nobitex_password_field"
          autoComplete="new-password"
          data-lpignore="true"
          data-1p-ignore="true"
          placeholder="رمز عبور نوبیتکس پرسنل"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full px-3 py-2 bg-transparent text-xs font-bold text-slate-800 outline-none font-mono"
        />
        <RevealButton shown={shown} onToggle={() => setShown((s) => !s)} />
      </div>
    </div>
  );
}

export function NobitexPasswordValue({ value }: { value: string }) {
  const [shown, setShown] = useState(false);
  return (
    <div>
      <span className="text-[10px] text-slate-500 block">رمز عبور نوبیتکس:</span>
      <span className="flex items-center gap-1 mt-0.5">
        <span className={`font-bold font-mono text-slate-800 ${shown ? 'select-all' : ''}`} dir="ltr">
          {shown ? value : MASK}
        </span>
        <RevealButton shown={shown} onToggle={() => setShown((s) => !s)} />
      </span>
    </div>
  );
}
