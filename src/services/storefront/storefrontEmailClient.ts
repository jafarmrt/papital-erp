import dns from 'node:dns/promises';
import net from 'node:net';
import nodemailer from 'nodemailer';
import { isPrivateOrReservedIp, withDnsTimeout } from '../../lib/ssrfGuard.js';
import type { EmailSecurity } from '../../lib/storefront/storefrontEmailRules.js';

/**
 * v12 phase 8e (owner's decision 7): the one client of the site's mail server (SMTP, through `nodemailer`).
 *
 * - The server is the one in the settings; its name is resolved here and every address checked as the SSRF guard checks
 *   a web address (AGENTS.md §5.7): an inside, loopback or reserved address is refused. The connection then goes to the
 *   checked address itself, with the name kept for the certificate, so a name that answers otherwise a moment later
 *   (DNS rebinding) never takes it inside. Only the database tests send to a server on this machine
 *   (`ERP_EMAIL_TEST_SMTP` = `127.0.0.1:<port>`, read only while `NODE_ENV` is test).
 * - The password never enters a log, an error or an answer; a failure is reduced to its kind, in Persian.
 * - Every send has its timeouts; a mail is plain text with a fixed subject, never an amount or another person's name.
 */
export const EMAIL_TEST_SMTP_ENV = 'ERP_EMAIL_TEST_SMTP';
const TIMEOUT_MS = 10_000;

export interface EmailServer {
  host: string;
  port: number;
  security: EmailSecurity;
  username: string;
  password: string;
  fromAddress: string;
  fromName: string;
}

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export type EmailSendResult = { ok: true } | { ok: false; error: string };

const UNSAFE = 'نشانی سرور ایمیل داخلی یا رزروشده است و برای امنیت پذیرفته نمی‌شود.';

/** The address to connect to, checked; a test server on this machine only in the database tests */
async function checkedAddress(host: string, port: number, env: NodeJS.ProcessEnv = process.env): Promise<{ address: string } | { error: string }> {
  if (env.NODE_ENV === 'test' && env[EMAIL_TEST_SMTP_ENV] === `${host}:${port}` && host === '127.0.0.1') return { address: host };
  if (net.isIP(host)) return isPrivateOrReservedIp(host) ? { error: UNSAFE } : { address: host };
  let found: Array<{ address: string }> = [];
  try {
    found = await withDnsTimeout(dns.lookup(host, { all: true }));
  } catch {
    found = [];
  }
  if (found.length === 0) return { error: 'نام سرور ایمیل پیدا نشد؛ آن را بررسی کنید.' };
  if (found.some(a => isPrivateOrReservedIp(a.address))) return { error: UNSAFE };
  return { address: found[0].address };
}

/** A Persian sentence for a failure, never the server's own words (they may carry its address or a user name) */
function failureOf(err: unknown): string {
  const code = String((err as { code?: unknown })?.code ?? '');
  if (code === 'EAUTH') return 'سرور ایمیل نام کاربری یا رمز را نپذیرفت.';
  if (code === 'ETIMEDOUT' || code === 'ESOCKET' && /timeout/i.test(String((err as Error)?.message ?? ''))) return 'سرور ایمیل در زمان پاسخ نداد.';
  if (code === 'ECONNECTION' || code === 'ECONNREFUSED' || code === 'ESOCKET' || code === 'EDNS') return 'به سرور ایمیل وصل نشد؛ نام، درگاه و رمزگذاری را بررسی کنید.';
  if (code === 'ETLS') return 'رمزگذاری با سرور ایمیل برقرار نشد؛ نوع رمزگذاری را بررسی کنید.';
  if (code === 'EENVELOPE') return 'سرور ایمیل نشانی فرستنده یا گیرنده را نپذیرفت.';
  if (code === 'EMESSAGE') return 'سرور ایمیل نامه را نپذیرفت.';
  return 'فرستادن ایمیل نشد.';
}

export async function sendEmail(server: EmailServer, message: EmailMessage): Promise<EmailSendResult> {
  const checked = await checkedAddress(server.host, server.port);
  if ('error' in checked) return { ok: false, error: checked.error };
  const address = checked.address;
  const transport = nodemailer.createTransport({
    host: address,
    port: server.port,
    secure: server.security === 'tls',
    requireTLS: server.security === 'starttls',
    ignoreTLS: server.security === 'none',
    tls: { servername: net.isIP(server.host) ? undefined : server.host },
    auth: server.username ? { user: server.username, pass: server.password } : undefined,
    connectionTimeout: TIMEOUT_MS,
    greetingTimeout: TIMEOUT_MS,
    socketTimeout: TIMEOUT_MS,
    logger: false,
    debug: false,
  });
  try {
    await transport.sendMail({
      from: server.fromName ? { name: server.fromName, address: server.fromAddress } : server.fromAddress,
      to: message.to, subject: message.subject, text: message.text,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: failureOf(err) };
  } finally {
    transport.close();
  }
}
