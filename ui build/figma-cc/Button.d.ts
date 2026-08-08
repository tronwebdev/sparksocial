import * as React from 'react';
export interface ButtonProps {
  className?: string;
  style?: React.CSSProperties;
  property1?: "default";
  /** Text content; defaults to "Create Campaign". */
  text1?: string;
}
export declare const Button: React.FC<ButtonProps>;
export default Button;
