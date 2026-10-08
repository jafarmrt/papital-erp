import { Link } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import { reservationSourcePath } from '../../lib/inventory/reservedItemsExport';
import type { ReservedItemDetail } from '../../lib/inventory/reservedItemsReport';

/** v9.0.402 (TD-828): opens the reservation's source in a page that reads it from the address */
export function ReservationSourceLink({ entry }: { entry: Pick<ReservedItemDetail, 'sourceType' | 'sourceRef' | 'sourceId'> }) {
  const proforma = entry.sourceType === 'proforma';
  return (
    <Link
      to={reservationSourcePath(entry)}
      className={`inline-flex items-center gap-1 font-bold ${proforma ? 'text-purple-600 hover:text-purple-800' : 'text-cyan-600 hover:text-cyan-800'}`}
    >
      <span>{proforma ? 'مشاهده پیش‌فاکتور' : 'مشاهده کنترل موجودی پروژه'}</span>
      <ExternalLink size={12} />
    </Link>
  );
}
