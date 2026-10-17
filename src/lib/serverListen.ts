/**
 * v10.1.67 (Express 5): `app.listen` passes a listen error (a busy port, EADDRINUSE) to its callback instead of
 * throwing. A callback that ignores it leaves a process that logs "Server running" without listening, so the service
 * manager never restarts it; this callback logs the error and exits with 1, as the Express 4 process did.
 */
export interface ListenLogger {
  info(message: string): void;
  error(message: string): void;
}

export function listenCallback(
  port: number,
  logger: ListenLogger,
  exit: (code: number) => void = (code) => process.exit(code),
): (err?: Error) => void {
  return (err?: Error) => {
    if (err) {
      logger.error(`Server failed to listen on port ${port}: ${err.message}`);
      exit(1);
      return;
    }
    logger.info(`Server running on port ${port}`);
  };
}
