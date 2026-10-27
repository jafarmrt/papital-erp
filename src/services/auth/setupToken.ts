/** The built-in setup token, accepted only by the test environment */
export const TEST_SETUP_TOKEN = 'papital_erp_setup_token_2026';
export const MIN_SETUP_TOKEN_LENGTH = 16;

/**
 * v11 phase 6.2 (X18): the token `POST /setup` checks, or null when setup is refused with
 * `SETUP_TOKEN_NOT_CONFIGURED_MESSAGE`. Any environment but `test` (production, a manual run, a staging server) needs
 * `ERP_SETUP_TOKEN` of 16 characters or more that is not the public built-in one; before, only production refused it,
 * so a server started without `NODE_ENV=production` could be set up by the first visitor who knew the built-in token.
 */
export function setupTokenOf(configured: string | undefined, nodeEnv: string | undefined): string | null {
  const token = (configured ?? '').trim();
  if (token && token !== TEST_SETUP_TOKEN && token.length >= MIN_SETUP_TOKEN_LENGTH) return token;
  return nodeEnv === 'test' ? (token || TEST_SETUP_TOKEN) : null;
}
