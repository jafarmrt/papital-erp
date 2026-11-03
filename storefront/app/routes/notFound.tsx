export function loader() {
  throw new Response('پیدا نشد', { status: 404 });
}

export default function NotFound() {
  return null;
}
