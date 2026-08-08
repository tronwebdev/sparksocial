import { CalendarMonthField } from './CalendarMonthField.jsx';
import { CalendarYearField } from './CalendarYearField.jsx';

// figma node: 1729:741 Calendar Select Group
export function CalendarSelectGroup(_p = {}) {
  const props = _p;
  return (
    <div className={props.className} style={{
      width: 184,
      display: "flex",
      flexDirection: "row",
      gap: "calc(var(--space-200) * 1px)",
      alignItems: "flex-start",
      flexWrap: "nowrap",
      isolation: "isolate",
      position: "relative",
      ...props.style,
    }}>
      <CalendarMonthField
        style={{
          position: "relative",
          zIndex: 2,
          flexGrow: 1,
          alignSelf: "stretch",
          width: "auto",
          height: "auto",
        }}
        value={"Sep"}
      />
      <CalendarYearField style={{
          position: "relative",
          zIndex: 1,
          flexGrow: 1,
          alignSelf: "stretch",
          width: "auto",
          height: "auto",
        }} />
    </div>
  );
}
export default CalendarSelectGroup;
