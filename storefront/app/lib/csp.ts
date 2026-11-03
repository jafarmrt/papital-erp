import type { AnalyticsConfig } from '../components/Analytics';

/**
 * The security policy of every page (phase 8.3b): everything comes from this site; the inline scripts are React Router's
 * hydration data, the JSON-LD and, in phase 8.5, the setup of the statistics service. With a statistics service on, only
 * that service's addresses join (Google's published list for GA4; the owner's Matomo server). `server.mjs` sends the same
 * base policy with the static files.
 */
const GA4_SCRIPT = ['https://www.googletagmanager.com'];
const GA4_CONNECT = ['https://*.google-analytics.com', 'https://*.analytics.google.com', 'https://*.googletagmanager.com'];
const GA4_IMAGES = ['https://*.google-analytics.com', 'https://*.googletagmanager.com'];

export function contentSecurityPolicy(analytics: AnalyticsConfig | null): string {
  const script = ["'self'", "'unsafe-inline'"];
  const connect = ["'self'"];
  const img = ["'self'", 'data:'];
  if (analytics?.provider === 'ga4') {
    script.push(...GA4_SCRIPT);
    connect.push(...GA4_CONNECT);
    img.push(...GA4_IMAGES);
  } else if (analytics?.provider === 'matomo') {
    const origin = new URL(analytics.url).origin;
    script.push(origin);
    connect.push(origin);
    img.push(origin);
  }
  return [
    "default-src 'self'",
    `img-src ${img.join(' ')}`,
    `script-src ${script.join(' ')}`,
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    `connect-src ${connect.join(' ')}`,
    "frame-ancestors 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ');
}
