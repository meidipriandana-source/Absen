export interface Attendee {
  no: number;
  nip: string;
  name: string;
  instansi: string;
  jabatan: string;
  email: string;
  checkInTime: string;
  signatureUrl: string;
  sheetRowIndex?: number;
  isOfflineOnly?: boolean;
  signature?: string;
}

export interface DashboardStats {
  totalCount: number;
  byInstitution: { name: string; value: number }[];
  timeline: { time: string; count: number }[];
  hourly?: { hour: string; count: number }[];
  cumulative?: { time: string; total: number; countAtMinute?: number }[];
  dailyParticipation?: { date: string; label: string; count: number }[];
}
