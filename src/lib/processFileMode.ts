/**
 * v11 (phase 5.1, O16): files the server writes (its logs, uploaded images, attachments, the media library) are not
 * readable by other users of the machine: the logs hold user ids, addresses and error stacks. Group read stays for an
 * operator group; nothing outside the process reads these files directly (nginx only proxies). Imported right after
 * `processTimezone` in `server.ts`, before the logger creates its folder and files.
 */
export const SERVER_PROCESS_UMASK = 0o027;

process.umask(SERVER_PROCESS_UMASK);
