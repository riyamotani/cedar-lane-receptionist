export type VehicleSize = 'sedan' | 'suv' | 'truck_van';
export const VEHICLE_SIZES: VehicleSize[] = ['sedan', 'suv', 'truck_van'];

export interface SizeOption {
  minutes: number; // how long the job occupies a bay
  price: number; // whole dollars
}

export interface Service {
  id: string;
  name: string;
  // Duration and price per vehicle size: bigger vehicles take longer, so they hold a bay longer.
  // null = quote only (handed off to a human, not bookable).
  options: Record<VehicleSize, SizeOption> | null;
  description: string;
}

export const SHOP = {
  name: 'Cedar Lane Auto Detailing',
  timezone: 'America/Los_Angeles',
  bays: 2,
  slotMinutes: 30,
  bufferMinutes: 0,
  minNoticeMinutes: 60,
  bookingHorizonDays: 60,
  lateGraceMinutes: 15,
  callbackWithinBusinessHours: 2,
};

// Keys are Luxon weekdays: 1 = Monday ... 7 = Sunday. null = closed all day.
export const HOURS: Record<number, { open: string; close: string } | null> = {
  1: { open: '08:00', close: '18:00' },
  2: { open: '08:00', close: '18:00' },
  3: { open: '08:00', close: '18:00' },
  4: { open: '08:00', close: '18:00' },
  5: { open: '08:00', close: '18:00' },
  6: { open: '08:00', close: '18:00' },
  7: null,
};

// Shop-local dates (YYYY-MM-DD) the shop is closed regardless of weekday.
export const CLOSED_DATES = ['2026-11-26', '2026-12-25', '2027-01-01'];

export const SERVICES: Service[] = [
  {
    id: 'exterior_wash_wax',
    name: 'Exterior Wash & Wax',
    options: {
      sedan: { minutes: 60, price: 60 },
      suv: { minutes: 60, price: 75 },
      truck_van: { minutes: 90, price: 90 },
    },
    description: 'Hand wash, wheels and tires, spray wax, windows.',
  },
  {
    id: 'interior_detail_wash',
    name: 'Interior Detail & Wash',
    options: {
      sedan: { minutes: 90, price: 150 },
      suv: { minutes: 120, price: 175 },
      truck_van: { minutes: 120, price: 200 },
    },
    description: 'Vacuum, shampoo carpets and seats, wipe down all surfaces, plus an exterior wash.',
  },
  {
    id: 'full_detail',
    name: 'Full Detail',
    options: {
      sedan: { minutes: 180, price: 250 },
      suv: { minutes: 210, price: 290 },
      truck_van: { minutes: 240, price: 330 },
    },
    description: 'Complete interior detail plus exterior clay bar, polish and wax.',
  },
  {
    id: 'ceramic_coating',
    name: 'Ceramic Coating',
    options: null,
    description:
      'Paint correction and multi-year ceramic protection. A full-day job, priced by quote after inspection.',
  },
];

export const NOT_SERVICED = ['boats', 'RVs', 'motorcycles', 'semi-trucks'];

export const PREP_INSTRUCTIONS = [
  'Remove personal items and valuables from the car.',
  'Take out child seats if you want the seats underneath cleaned.',
  'Arrive with a reasonably clean exterior for ceramic coating (no thick mud).',
];

export function findService(id: string): Service | undefined {
  return SERVICES.find((s) => s.id === id);
}
