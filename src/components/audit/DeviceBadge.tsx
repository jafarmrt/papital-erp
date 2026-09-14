import React from 'react';
import { Laptop, Smartphone, Tablet, Bot, HelpCircle } from 'lucide-react';
import { parseUserAgent } from '../../utils/userAgentParser';

interface DeviceBadgeProps {
  userAgent?: string | null;
  ipAddress?: string | null;
}

export const DeviceBadge: React.FC<DeviceBadgeProps> = ({ userAgent, ipAddress }) => {
  const parsed = parseUserAgent(userAgent);

  const getDeviceIcon = () => {
    switch (parsed.deviceType) {
      case 'desktop':
        return <Laptop className="w-3.5 h-3.5 text-indigo-600 shrink-0" />;
      case 'mobile':
        return <Smartphone className="w-3.5 h-3.5 text-emerald-600 shrink-0" />;
      case 'tablet':
        return <Tablet className="w-3.5 h-3.5 text-amber-600 shrink-0" />;
      case 'bot':
        return <Bot className="w-3.5 h-3.5 text-rose-600 shrink-0" />;
      default:
        return <HelpCircle className="w-3.5 h-3.5 text-slate-400 shrink-0" />;
    }
  };

  return (
    <div
      className="inline-flex items-center gap-1.5 px-2 py-1 bg-slate-100/90 hover:bg-slate-200/90 border border-slate-200 rounded-lg text-2xs transition-colors group cursor-default"
      title={`${parsed.deviceLabel} • ${parsed.os} • ${parsed.browser} (IP: ${ipAddress || 'نامشخص'})`}
    >
      {getDeviceIcon()}
      <span className="font-medium text-slate-700 font-sans hidden sm:inline">
        {parsed.deviceLabel.split(' ')[0]}
      </span>
      <span className="text-slate-400 text-3xs font-mono border-r border-slate-300 pr-1.5 mr-0.5">
        {parsed.browser}
      </span>
    </div>
  );
};
