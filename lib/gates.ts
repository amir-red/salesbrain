export interface Gate {
  number: number;
  name: string;
  slaDays: number;
  isBoard: boolean;
  requiredFields?: string[];
}

export const GATES: Gate[] = [
  { number: 1, name: 'Lead Qualification', slaDays: 3, isBoard: false },
  {
    number: 2,
    name: 'Demand Analysis',
    slaDays: 10,
    isBoard: false,
    requiredFields: [
      'economic_size',
      'solution_fit',
      'client_capability',
      'our_capability',
      'payment_terms',
      'sales_cycle',
      'pilot_or_full',
    ],
  },
  { number: 3, name: 'Review Board 1', slaDays: 5, isBoard: true },
  { number: 4, name: 'Offer Strategy', slaDays: 14, isBoard: false },
  { number: 5, name: 'Review Board 2', slaDays: 5, isBoard: true },
  { number: 6, name: 'Offer Presentation', slaDays: 7, isBoard: false },
  { number: 7, name: 'Negotiation', slaDays: 21, isBoard: false },
  { number: 8, name: 'Close', slaDays: 3, isBoard: false },
  { number: 9, name: 'Project Handover', slaDays: 5, isBoard: false },
];

export function getGate(number: number): Gate | undefined {
  return GATES.find((g) => g.number === number);
}

export function getMissingFields(gate: number, fields: Record<string, unknown>): string[] {
  const g = getGate(gate);
  if (!g?.requiredFields) return [];
  return g.requiredFields.filter((f) => {
    const val = fields[f];
    return val === undefined || val === null || val === '';
  });
}

export type SLAStatus = 'ok' | 'warning' | 'breached';

export function getSLAStatus(gate: number, gateEnteredAt: Date): { status: SLAStatus; daysInGate: number; slaDays: number } {
  const g = getGate(gate);
  if (!g) return { status: 'ok', daysInGate: 0, slaDays: 0 };

  const now = new Date();
  const msInDay = 86400000;
  const daysInGate = Math.floor((now.getTime() - gateEnteredAt.getTime()) / msInDay);
  const slaDays = g.slaDays;

  let status: SLAStatus = 'ok';
  if (daysInGate >= slaDays) {
    status = 'breached';
  } else if (daysInGate >= slaDays * 0.75) {
    status = 'warning';
  }

  return { status, daysInGate, slaDays };
}
