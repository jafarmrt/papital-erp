/**
 * Utility to parse User-Agent string into readable device, OS, and browser information.
 */

export interface ParsedUserAgent {
  deviceType: 'desktop' | 'mobile' | 'tablet' | 'bot' | 'unknown';
  deviceLabel: string;
  browser: string;
  os: string;
  shortSummary: string;
}

export function parseUserAgent(uaString?: string | null): ParsedUserAgent {
  if (!uaString || typeof uaString !== 'string') {
    return {
      deviceType: 'unknown',
      deviceLabel: 'نامشخص',
      browser: 'نامشخص',
      os: 'نامشخص',
      shortSummary: 'دستگاه نامشخص'
    };
  }

  const ua = uaString.toLowerCase();

  // 1. Device Type
  let deviceType: ParsedUserAgent['deviceType'] = 'desktop';
  let deviceLabel = 'رایانه (Desktop)';

  if (/ipad|tablet|(android(?!.*mobile))/i.test(ua)) {
    deviceType = 'tablet';
    deviceLabel = 'تبلت (Tablet)';
  } else if (/mobile|iphone|ipod|android.*mobile|blackberry|phone|iemobile/i.test(ua)) {
    deviceType = 'mobile';
    deviceLabel = 'موبایل (Mobile)';
  } else if (/bot|crawler|spider|curl|wget/i.test(ua)) {
    deviceType = 'bot';
    deviceLabel = 'ربات سیستمی (Bot)';
  }

  // 2. Operating System
  let os = 'سایر / نامشخص';
  if (/windows nt 10.0/i.test(ua)) os = 'ویندوز 10/11';
  else if (/windows nt 6.3/i.test(ua)) os = 'ویندوز 8.1';
  else if (/windows nt 6.1/i.test(ua)) os = 'ویندوز 7';
  else if (/windows/i.test(ua)) os = 'ویندوز';
  else if (/android (\d+(\.\d+)?)/i.test(ua)) {
    const match = ua.match(/android (\d+(\.\d+)?)/i);
    os = match ? `اندروید ${match[1]}` : 'اندروید';
  } else if (/iphone os (\d+(_\d+)?)/i.test(ua)) {
    const match = ua.match(/iphone os (\d+(_\d+)?)/i);
    os = match ? `iOS ${match[1].replace('_', '.')}` : 'iOS';
  } else if (/ipad.*os (\d+(_\d+)?)/i.test(ua)) {
    const match = ua.match(/ipad.*os (\d+(_\d+)?)/i);
    os = match ? `iPadOS ${match[1].replace('_', '.')}` : 'iPadOS';
  } else if (/macintosh|mac os x/i.test(ua)) {
    os = 'مک‌اواس (macOS)';
  } else if (/linux/i.test(ua)) {
    os = 'لینوکس (Linux)';
  }

  // 3. Browser
  let browser = 'مرورگر استاندارد';
  if (/edg\/([0-9.]+)/i.test(ua)) {
    browser = 'Edge';
  } else if (/samsungbrowser\/([0-9.]+)/i.test(ua)) {
    browser = 'Samsung Internet';
  } else if (/chrome\/([0-9.]+)/i.test(ua) && !/edg/i.test(ua)) {
    browser = 'Chrome';
  } else if (/firefox\/([0-9.]+)/i.test(ua)) {
    browser = 'Firefox';
  } else if (/safari\/([0-9.]+)/i.test(ua) && !/chrome/i.test(ua)) {
    browser = 'Safari';
  } else if (/opera|opr\/([0-9.]+)/i.test(ua)) {
    browser = 'Opera';
  }

  const shortSummary = `${browser} روی ${os}`;

  return {
    deviceType,
    deviceLabel,
    browser,
    os,
    shortSummary
  };
}
