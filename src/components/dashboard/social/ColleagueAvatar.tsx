/** v10.2 package 9: a colleague's picture, else the first letter of the name, on the group dashboard cards */
export function ColleagueAvatar({ name, avatarUrl, size = 36 }: { name: string; avatarUrl: string; size?: number }) {
  const initial = name.trim().charAt(0) || '؟';
  return (
    <span
      className="rounded-full bg-slate-100 text-slate-600 flex items-center justify-center overflow-hidden shrink-0 font-bold text-sm"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {avatarUrl ? <img src={avatarUrl} alt="" className="w-full h-full object-cover" /> : initial}
    </span>
  );
}
