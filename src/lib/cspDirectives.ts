/**
 * Content-Security-Policy directives of the app (helmet), v9.0.127 (TD-597, owner decision t3 «الف»).
 *
 * In production the app may be framed only by itself, plus the origins listed in `FRAME_ANCESTORS`
 * (comma separated; for the AI Studio preview deployments that also need `EXPOSE_TOKEN_IN_BODY`), and the
 * browser may connect only to itself plus `EXTERNAL_API_ORIGINS`. The session cookie is `SameSite=None`,
 * so a page allowed to frame the app carries the user's session (clickjacking); before this, any page on
 * `*.run.app` or `*.googleusercontent.com` could frame it and `connect-src` allowed every HTTPS origin.
 * Outside production the Google preview hosts and the Vite dev server connections stay allowed.
 */
export type CspDirectives = Record<string, string[]>;

const PREVIEW_FRAME_ANCESTORS = [
  'https://*.google.com',
  'https://*.run.app',
  'https://*.googleusercontent.com',
  'https://*.aistudio.google.com',
];

function originList(value: string | undefined): string[] {
  return (value ?? '').split(',').map(s => s.trim()).filter(Boolean);
}

export function buildCspDirectives(env: NodeJS.ProcessEnv = process.env): CspDirectives {
  const production = env.NODE_ENV === 'production';
  const externalApi = originList(env.EXTERNAL_API_ORIGINS);
  return {
    defaultSrc: ["'self'"],
    // Vite dev server and dynamic inline scripts only outside production
    scriptSrc: ["'self'", ...(production ? [] : ["'unsafe-inline'", "'unsafe-eval'"])],
    styleSrc: ["'self'", "'unsafe-inline'"], // Tailwind / inline style tags
    imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
    connectSrc: ["'self'", ...(production ? [] : ['https:', 'wss:', 'ws:']), ...externalApi],
    fontSrc: ["'self'", 'data:', 'https:'],
    objectSrc: ["'none'"],
    baseUri: ["'self'"],
    formAction: ["'self'"],
    frameAncestors: ["'self'", ...(production ? [] : PREVIEW_FRAME_ANCESTORS), ...originList(env.FRAME_ANCESTORS)],
  };
}
