import http from 'http';
import net from 'net';
import type { AddressInfo } from 'net';

/**
 * v12 phase 8e: the fake SMS service and the fake mail server of the email tests, on this machine. The SMS service
 * answers every send as sent and keeps the bodies; the mail server speaks enough SMTP to take one message at a time and
 * keeps what it was sent.
 */
export interface Received { auth: string; from: string; to: string[]; data: string }

export async function fakeSmsServer() {
  const bodies: string[] = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk.toString('utf8'); });
    req.on('end', () => {
      bodies.push(body);
      res.setHeader('Content-Type', 'application/json');
      res.statusCode = 200;
      res.end(JSON.stringify({ status: 1, message: 'موفق', data: { messageId: bodies.length } }));
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { bodies, base: `http://127.0.0.1:${port}`, close: () => new Promise<void>(resolve => server.close(() => resolve())) };
}

/** A mail server that speaks just enough SMTP for one mail per connection, signing in with PLAIN */
export async function fakeMailServer() {
  const received: Received[] = [];
  const server = net.createServer((socket) => {
    let buffer = '';
    let inData = false;
    const current: Received = { auth: '', from: '', to: [], data: '' };
    socket.write('220 fake.mail ESMTP\r\n');
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      while (true) {
        if (inData) {
          const end = buffer.indexOf('\r\n.\r\n');
          if (end < 0) return;
          current.data = buffer.slice(0, end);
          buffer = buffer.slice(end + 5);
          inData = false;
          received.push({ ...current, to: [...current.to] });
          socket.write('250 2.0.0 queued\r\n');
          continue;
        }
        const nl = buffer.indexOf('\r\n');
        if (nl < 0) return;
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 2);
        const verb = line.split(' ')[0].toUpperCase();
        if (verb === 'EHLO' || verb === 'HELO') socket.write('250-fake.mail\r\n250-AUTH PLAIN\r\n250 8BITMIME\r\n');
        else if (verb === 'AUTH') {
          const plain = Buffer.from(line.split(' ')[2] ?? '', 'base64').toString('utf8');
          current.auth = plain;
          socket.write('235 2.7.0 ok\r\n');
        } else if (verb === 'MAIL') { current.from = line; socket.write('250 ok\r\n'); }
        else if (verb === 'RCPT') { current.to.push(line); socket.write('250 ok\r\n'); }
        else if (verb === 'DATA') { inData = true; socket.write('354 go\r\n'); }
        else if (verb === 'QUIT') { socket.end('221 bye\r\n'); return; }
        else if (verb === 'RSET' || verb === 'NOOP') socket.write('250 ok\r\n');
        else socket.write('502 no\r\n');
      }
    });
    socket.on('error', () => undefined);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as net.AddressInfo).port;
  return { received, port, close: () => new Promise<void>(resolve => server.close(() => resolve())) };
}

/** The text of a mail as the fake server got it: its body, with quoted-printable or base64 undone */
export function decodeMail(raw: string): string {
  const [headers, ...rest] = raw.split('\r\n\r\n');
  const body = rest.join('\r\n\r\n');
  if (/Content-Transfer-Encoding: base64/i.test(headers)) return Buffer.from(body.replace(/\s+/g, ''), 'base64').toString('utf8');
  if (/Content-Transfer-Encoding: quoted-printable/i.test(headers)) {
    const soft = body.replace(/=\r?\n/g, '');
    return Buffer.from(soft.replace(/=([0-9A-F]{2})/gi, (_m, h: string) => String.fromCharCode(parseInt(h, 16))), 'latin1').toString('utf8');
  }
  return body;
}

