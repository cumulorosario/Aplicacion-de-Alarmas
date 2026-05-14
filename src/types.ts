export type AlarmSeverity = 'CRITICAL' | 'MAJOR' | 'MINOR' | 'WARNING' | 'INDETERMINATE';
export type AlarmStatus = 'ACTIVE_UNACK' | 'ACTIVE_ACK' | 'CLEARED_UNACK' | 'CLEARED_ACK';

export interface Alarm {
  id: { id: string };
  createdTime: number;
  type: string;
  severity: AlarmSeverity;
  status: AlarmStatus;
  originatorName: string;
  details: any;
  acknowledged?: boolean;
  cleared?: boolean;
}

export interface Device {
  id: { id: string; entityType: 'DEVICE' };
  name: string;
  type: string;
  label?: string;
  online?: boolean;
  lastActivityTime?: number;
}

export interface TelemetryData {
  [key: string]: { ts: number; value: any }[];
}

export interface AuthResponse {
  token: string;
  refreshToken: string;
}

export interface DashboardStats {
  activeAlarms: number;
  criticalAlarms: number;
  devicesOnline: number;
  totalDevices: number;
}
