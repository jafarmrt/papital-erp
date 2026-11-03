/** The service manager's probe: the app is up (it does not call the ERP) */
export function loader() {
  return new Response('ok', { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
}
