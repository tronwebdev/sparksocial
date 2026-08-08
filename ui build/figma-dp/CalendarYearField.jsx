import { ChevronDown } from './ChevronDown.jsx';

// figma node: 1729:722 Calendar Year Field
export function CalendarYearField(_p = {}) {
  const props = { ..._p, value: _p.value ?? "2025" };
  return (
    <div className={props.className} style={{
      width: 240,
      display: "flex",
      flexDirection: "column",
      gap: "calc(var(--space-200) * 1px)",
      alignItems: "flex-start",
      flexWrap: "nowrap",
      position: "relative",
      ...props.style,
    }}>
      <div style={{
        position: "relative",
        borderRadius: 8,
        backgroundColor: "var(--background-default-default)",
        borderTop: "1px solid var(--border-default-default)",
        borderRight: "1px solid var(--border-default-default)",
        borderBottom: "1px solid var(--border-default-default)",
        borderLeft: "1px solid var(--border-default-default)",
        display: "flex",
        flexDirection: "row",
        gap: "calc(var(--space-200) * 1px)",
        padding: "6px 6px 6px 6px",
        alignItems: "center",
        flexWrap: "nowrap",
        boxSizing: "border-box",
        paddingLeft: "calc(var(--space-150) * 1px)",
        paddingTop: "calc(var(--space-150) * 1px)",
        paddingRight: "calc(var(--space-150) * 1px)",
        paddingBottom: "calc(var(--space-150) * 1px)",
        flexShrink: 0,
        alignSelf: "stretch",
      }}>
        <span style={{
          position: "relative",
          fontFamily: "Inter, -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif",
          fontWeight: 400,
          fontSize: 16,
          lineHeight: 1,
          color: "var(--text-default-default)",
          flexGrow: 1,
        }}>{props.value}</span>
        <div style={{
            position: "relative",
            width: 16,
            height: 16,
            flexShrink: 0,
          }}>{props.icon1 ?? <ChevronDown />}</div>
      </div>
    </div>
  );
}
export default CalendarYearField;
