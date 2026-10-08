/**
 * v9.0.442 (TD-732): the outbox tries an event this many times before it moves it to the dead-letter queue; the server
 * worker and the outbox list ("attempt N of 5") read the same number.
 */
export const OUTBOX_MAX_ATTEMPTS = 5;
