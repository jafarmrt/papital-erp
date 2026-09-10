import React from 'react';
import { ProcurementDesk } from '../components/procurement/ProcurementDesk';
import { User } from '../types';

interface ProcurementPageProps {
  user?: User | null;
}

export default function ProcurementPage({ user }: ProcurementPageProps) {
  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
      <ProcurementDesk currentUser={user} />
    </div>
  );
}
