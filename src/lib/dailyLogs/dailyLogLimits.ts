/**
 * v9.0.246 (TD-644, finding B13-19): length caps of a daily work log, shared by the request schemas and the form
 * (`maxLength`), so a log can no longer carry megabytes of text into every list, statistics and summary response.
 */
export const DAILY_LOG_TITLE_MAX = 200;
export const DAILY_LOG_CONTENT_MAX = 20_000;
export const DAILY_LOG_TAGS_MAX = 20;
export const DAILY_LOG_TAG_MAX = 50;
export const DAILY_LOG_PROJECT_NAME_MAX = 200;
export const DAILY_LOG_MANAGER_NOTES_MAX = 20_000;
