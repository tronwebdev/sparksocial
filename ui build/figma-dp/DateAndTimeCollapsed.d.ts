import * as React from 'react';
export interface DateAndTimeCollapsedProps {
  className?: string;
  style?: React.CSSProperties;
  showDate?: boolean;
  showTime?: boolean;
  month?: string;
  state?: "default" | "selected";
  year?: string;
  time?: string;
}
export declare const DateAndTimeCollapsed: React.FC<DateAndTimeCollapsedProps>;
export default DateAndTimeCollapsed;
