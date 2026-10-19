/**
 * TD-1323 (OBS-R2-86): the live bus keeps only its newest events in memory, and the «گذرگاه رویدادهای زنده» tab reads
 * that whole buffer. Every recorded event stays readable page by page in the outbox list.
 */
export const LIVE_EVENT_BUFFER_SIZE = 200;
