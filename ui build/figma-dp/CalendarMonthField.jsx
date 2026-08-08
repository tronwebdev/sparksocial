import { ChevronDown } from './ChevronDown.jsx';

// figma node: 1729:701 Calendar Month Field
export function CalendarMonthField(_p = {}) {
  const props = { ..._p, value: _p.value ?? "September", open: _p.open ?? false, hasLabel: _p.hasLabel ?? false, label: _p.label ?? "Label" };
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
      {props.hasLabel && (
      <span style={{
        position: "relative",
        fontFamily: "Inter, -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif",
        fontWeight: 400,
        fontSize: 16,
        lineHeight: 1.399999976158142,
        color: "var(--text-default-default)",
        flexShrink: 0,
        alignSelf: "stretch",
      }}>{props.label}</span>
      )}
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
        {props.open && (
        <div style={{
          position: "absolute",
          left: 8,
          top: 8,
          borderRadius: 8,
          backgroundColor: "var(--background-default-default)",
          boxShadow: "inset 0 0 0 1px var(--border-default-default), 0px 1px 4px 0px rgba(12,12,13,0.1), 0px 1px 4px 0px rgba(12,12,13,0.05)",
          display: "flex",
          flexDirection: "column",
          gap: "calc(var(--space-200) * 1px)",
          padding: "8px 8px 8px 8px",
          alignItems: "center",
          flexWrap: "nowrap",
          boxSizing: "border-box",
          paddingLeft: "calc(var(--space-200) * 1px)",
          paddingTop: "calc(var(--space-200) * 1px)",
          paddingRight: "calc(var(--space-200) * 1px)",
          paddingBottom: "calc(var(--space-200) * 1px)",
        }}>
          <span style={{
            position: "relative",
            fontFamily: "Inter, -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif",
            fontWeight: 400,
            fontSize: 16,
            whiteSpace: "nowrap",
            lineHeight: 1.399999976158142,
            color: "var(--text-default-default)",
            flexShrink: 0,
          }}>{props.text1 ?? "January"}</span>
          <span style={{
            position: "relative",
            fontFamily: "Inter, -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif",
            fontWeight: 400,
            fontSize: 16,
            whiteSpace: "nowrap",
            lineHeight: 1.399999976158142,
            color: "var(--text-default-default)",
            flexShrink: 0,
          }}>{props.text2 ?? "February"}</span>
          <span style={{
            position: "relative",
            fontFamily: "Inter, -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif",
            fontWeight: 400,
            fontSize: 16,
            whiteSpace: "nowrap",
            lineHeight: 1.399999976158142,
            color: "var(--text-default-default)",
            flexShrink: 0,
          }}>{props.text3 ?? "March"}</span>
          <span style={{
            position: "relative",
            fontFamily: "Inter, -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif",
            fontWeight: 400,
            fontSize: 16,
            whiteSpace: "nowrap",
            lineHeight: 1.399999976158142,
            color: "var(--text-default-default)",
            flexShrink: 0,
          }}>{props.text4 ?? "April"}</span>
          <span style={{
            position: "relative",
            fontFamily: "Inter, -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif",
            fontWeight: 400,
            fontSize: 16,
            whiteSpace: "nowrap",
            lineHeight: 1.399999976158142,
            color: "var(--text-default-default)",
            flexShrink: 0,
          }}>May</span>
          <span style={{
            position: "relative",
            fontFamily: "Inter, -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif",
            fontWeight: 400,
            fontSize: 16,
            whiteSpace: "nowrap",
            lineHeight: 1.399999976158142,
            color: "var(--text-default-default)",
            flexShrink: 0,
          }}>June</span>
          <span style={{
            position: "relative",
            fontFamily: "Inter, -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif",
            fontWeight: 400,
            fontSize: 16,
            whiteSpace: "nowrap",
            lineHeight: 1.399999976158142,
            color: "var(--text-default-default)",
            flexShrink: 0,
          }}>July</span>
          <span style={{
            position: "relative",
            fontFamily: "Inter, -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif",
            fontWeight: 400,
            fontSize: 16,
            whiteSpace: "nowrap",
            lineHeight: 1.399999976158142,
            color: "var(--text-default-default)",
            flexShrink: 0,
          }}>August</span>
          <span style={{
            position: "relative",
            fontFamily: "Inter, -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif",
            fontWeight: 400,
            fontSize: 16,
            whiteSpace: "nowrap",
            lineHeight: 1.399999976158142,
            color: "var(--text-default-default)",
            flexShrink: 0,
          }}>September</span>
          <span style={{
            position: "relative",
            fontFamily: "Inter, -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif",
            fontWeight: 400,
            fontSize: 16,
            whiteSpace: "nowrap",
            lineHeight: 1.399999976158142,
            color: "var(--text-default-default)",
            flexShrink: 0,
          }}>October</span>
          <span style={{
            position: "relative",
            fontFamily: "Inter, -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif",
            fontWeight: 400,
            fontSize: 16,
            whiteSpace: "nowrap",
            lineHeight: 1.399999976158142,
            color: "var(--text-default-default)",
            flexShrink: 0,
          }}>November</span>
          <span style={{
            position: "relative",
            fontFamily: "Inter, -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif",
            fontWeight: 400,
            fontSize: 16,
            whiteSpace: "nowrap",
            lineHeight: 1.399999976158142,
            color: "var(--text-default-default)",
            flexShrink: 0,
          }}>December</span>
        </div>
        )}
      </div>
    </div>
  );
}
export default CalendarMonthField;
