import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatTimestamp(ts: number) {
  return new Date(ts).toLocaleString();
}

export const SEVERITY_COLORS = {
  CRITICAL: 'bg-red-500 text-white',
  MAJOR: 'bg-orange-500 text-white',
  MINOR: 'bg-yellow-500 text-black',
  WARNING: 'bg-blue-500 text-white',
  INDETERMINATE: 'bg-gray-500 text-white',
};
