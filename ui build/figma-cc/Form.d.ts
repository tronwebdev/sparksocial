import * as React from 'react';
export interface FormProps {
  className?: string;
  style?: React.CSSProperties;
  property1?: "default";
  /** Text content; defaults to "https://". */
  text1?: string;
  /** Text content; defaults to "Enable CTA URL". */
  text2?: string;
  /** Text content; defaults to "Campaign Offer Details". */
  text3?: string;
  /** Text content; defaults to "Brand Colors:". */
  text4?: string;
  /** Swappable nested instance; defaults to the design's. */
  icon1?: React.ReactNode;
}
export declare const Form: React.FC<FormProps>;
export default Form;
