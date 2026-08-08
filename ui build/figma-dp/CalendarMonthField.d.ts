import * as React from 'react';
export interface CalendarMonthFieldProps {
  className?: string;
  style?: React.CSSProperties;
  value?: string;
  open?: boolean;
  hasLabel?: boolean;
  label?: string;
  /** Text content; defaults to "January". */
  text1?: string;
  /** Text content; defaults to "February". */
  text2?: string;
  /** Text content; defaults to "March". */
  text3?: string;
  /** Text content; defaults to "April". */
  text4?: string;
  /** Swappable nested instance; defaults to the design's. */
  icon1?: React.ReactNode;
}
export declare const CalendarMonthField: React.FC<CalendarMonthFieldProps>;
export default CalendarMonthField;
