import { useState, useRef, useEffect, KeyboardEvent, ChangeEvent } from 'react';
import { AtSign, UserCheck } from 'lucide-react';

export interface MentionUser {
  id: number;
  fullName?: string;
  full_name?: string;
  username: string;
  role?: string;
}

interface MentionTextareaProps {
  value: string;
  onChange: (value: string) => void;
  users: MentionUser[];
  currentUser?: any;
  mentions?: number[];
  onMentionsChange?: (mentions: number[]) => void;
  placeholder?: string;
  rows?: number;
  className?: string;
  required?: boolean;
  disabled?: boolean;
  id?: string;
  name?: string;
  hintText?: string;
}

export function getUserDisplayName(u: MentionUser): string {
  if (!u) return '';
  return (u.fullName || u.full_name || u.username || '').trim();
}

export function MentionTextarea({
  value,
  onChange,
  users = [],
  currentUser,
  mentions = [],
  onMentionsChange,
  placeholder,
  rows = 3,
  className = '',
  required = false,
  disabled = false,
  id,
  name,
  hintText = 'برای منشن همکاران، کلید @ را تایپ کنید.'
}: MentionTextareaProps) {
  const [showPopover, setShowPopover] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [atPosition, setAtPosition] = useState<number>(-1);
  const [cursorPos, setCursorPos] = useState<number>(0);
  const [selectedIndex, setSelectedIndex] = useState<number>(0);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Sync mentions array with @mentions present in text
  useEffect(() => {
    if (!onMentionsChange || !users.length) return;
    const detectedIds = new Set<number>(mentions);
    let changed = false;

    users.forEach((u) => {
      const name = getUserDisplayName(u);
      const uname = u.username;
      const isMentioned =
        (name && value.includes(`@${name}`)) ||
        (uname && value.includes(`@${uname}`));

      if (isMentioned && !detectedIds.has(u.id)) {
        detectedIds.add(u.id);
        changed = true;
      }
    });

    if (changed) {
      onMentionsChange(Array.from(detectedIds));
    }
  }, [value, users]);

  // Filter users based on query
  const filteredUsers = users.filter((u) => {
    const name = getUserDisplayName(u);
    const uname = u.username || '';
    const isSelf =
      currentUser &&
      ((currentUser.id && u.id === currentUser.id) ||
        (currentUser.username && u.username === currentUser.username));
    if (isSelf) return false;

    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    return name.toLowerCase().includes(q) || uname.toLowerCase().includes(q);
  });

  // Check if cursor is after @
  const handleCheckMentionTrigger = (textVal: string, selStart: number) => {
    setCursorPos(selStart);
    const textBefore = textVal.slice(0, selStart);
    const lastAt = textBefore.lastIndexOf('@');

    if (lastAt !== -1) {
      const charBeforeAt = lastAt > 0 ? textBefore[lastAt - 1] : ' ';
      const textAfterAt = textBefore.slice(lastAt + 1);

      // Trigger if @ is preceded by space, newline, or at start of text, and no newlines after @
      if ((/\s|^/.test(charBeforeAt)) && !textAfterAt.includes('\n') && textAfterAt.length <= 30) {
        setSearchQuery(textAfterAt);
        setAtPosition(lastAt);
        setShowPopover(true);
        setSelectedIndex(0);
        return;
      }
    }
    setShowPopover(false);
  };

  const handleInputChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const newVal = e.target.value;
    const selStart = e.target.selectionStart;
    onChange(newVal);
    handleCheckMentionTrigger(newVal, selStart);
  };

  const handleSelectionOrCursor = () => {
    if (textareaRef.current) {
      const selStart = textareaRef.current.selectionStart;
      handleCheckMentionTrigger(value, selStart);
    }
  };

  const insertMention = (u: MentionUser) => {
    if (atPosition === -1) return;
    const displayName = getUserDisplayName(u);
    const beforeAt = value.slice(0, atPosition);
    const afterCursor = value.slice(cursorPos);
    const insertedTag = `@${displayName} `;
    const newText = beforeAt + insertedTag + afterCursor;

    onChange(newText);

    // Update mentions ID array
    if (onMentionsChange && !mentions.includes(u.id)) {
      onMentionsChange([...mentions, u.id]);
    }

    setShowPopover(false);

    // Reposition cursor in textarea
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        const newPos = atPosition + insertedTag.length;
        textareaRef.current.setSelectionRange(newPos, newPos);
      }
    }, 10);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!showPopover || filteredUsers.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % filteredUsers.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + filteredUsers.length) % filteredUsers.length);
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      const targetUser = filteredUsers[selectedIndex];
      if (targetUser) {
        insertMention(targetUser);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setShowPopover(false);
    }
  };

  return (
    <div className="relative w-full">
      <textarea
        ref={textareaRef}
        id={id}
        name={name}
        value={value}
        onChange={handleInputChange}
        onClick={handleSelectionOrCursor}
        onKeyUp={handleSelectionOrCursor}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        rows={rows}
        required={required}
        disabled={disabled}
        className={className}
      />

      {hintText && (
        <div className="flex items-center justify-between mt-1 text-[10px] text-slate-400 px-1">
          <span className="flex items-center gap-1">
            <AtSign size={11} className="text-blue-500" />
            {hintText}
          </span>
          {mentions.length > 0 && (
            <span className="font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-200">
              {mentions.length} منشن فعال
            </span>
          )}
        </div>
      )}

      {/* Popover list of colleagues when typing @ */}
      {showPopover && filteredUsers.length > 0 && (
        <div
          ref={popoverRef}
          className="absolute z-50 right-0 left-0 bottom-full mb-1 bg-white border border-slate-200 rounded-xl shadow-2xl overflow-hidden max-h-52 overflow-y-auto custom-scrollbar animate-in fade-in zoom-in-95"
        >
          <div className="px-3 py-1.5 bg-slate-900 text-white text-[10px] font-bold flex items-center justify-between">
            <span className="flex items-center gap-1">
              <AtSign size={12} className="text-amber-400" />
              منشن همکاران (کلید Enter یا کلیک جهت درج):
            </span>
            <span className="text-[9px] text-slate-300 font-normal">
              {filteredUsers.length} همکار یافت شد
            </span>
          </div>

          <div className="p-1 space-y-0.5">
            {filteredUsers.map((u, idx) => {
              const displayName = getUserDisplayName(u);
              const isHighlighted = idx === selectedIndex;
              const isAlreadyMentioned = mentions.includes(u.id);

              return (
                <button
                  key={u.id}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault(); // prevent textarea blur
                    insertMention(u);
                  }}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={`w-full px-3 py-2 rounded-lg text-xs flex items-center justify-between transition-colors text-right cursor-pointer ${
                    isHighlighted
                      ? 'bg-blue-600 text-white font-bold'
                      : 'hover:bg-slate-100 text-slate-800'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <div
                      className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${
                        isHighlighted
                          ? 'bg-white/20 text-white'
                          : 'bg-blue-100 text-blue-800'
                      }`}
                    >
                      {displayName.charAt(0)}
                    </div>
                    <div>
                      <span className="block text-xs">{displayName}</span>
                      {u.username && u.username !== displayName && (
                        <span
                          className={`block text-[10px] ${
                            isHighlighted ? 'text-blue-100' : 'text-slate-400'
                          }`}
                        >
                          @{u.username}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5">
                    {u.role && (
                      <span
                        className={`text-[9px] px-1.5 py-0.5 rounded font-semibold ${
                          isHighlighted
                            ? 'bg-white/20 text-white'
                            : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {u.role}
                      </span>
                    )}
                    {isAlreadyMentioned && (
                      <UserCheck
                        size={14}
                        className={isHighlighted ? 'text-emerald-300' : 'text-emerald-600'}
                      />
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default MentionTextarea;
