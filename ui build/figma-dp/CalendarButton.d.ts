import * as React from 'react';
export interface CalendarButtonProps {
  className?: string;
  style?: React.CSSProperties;
  number?: string;
  state?: "default" | "hover" | "active" | "disabled" | "range" | "range disabled" | "hidden";
}
export declare const CalendarButton: React.FC<CalendarButtonProps>;
export default CalendarButton;
