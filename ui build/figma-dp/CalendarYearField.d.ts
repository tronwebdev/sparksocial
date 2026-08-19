import * as React from 'react';
export interface CalendarYearFieldProps {
  className?: string;
  style?: React.CSSProperties;
  value?: string;
  /** Swappable nested instance; defaults to the design's. */
  icon1?: React.ReactNode;
}
export declare const CalendarYearField: React.FC<CalendarYearFieldProps>;
export default CalendarYearField;
