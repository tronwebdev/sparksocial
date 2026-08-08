// figma node: 1729:843 Date and time - Collapsed (2 variants)
const __venc = (v) => String(v).replace(/[%|=]/g, encodeURIComponent);
const __vkey = (p) => "state=" + __venc(p.state);

export function DateAndTimeCollapsed(_p = {}) {
  const props = { ..._p, showDate: _p.showDate ?? true, showTime: _p.showTime ?? true, month: _p.month ?? "Apr 1,", state: _p.state ?? "default", year: _p.year ?? "2025", time: _p.time ?? "9:41 AM" };
  const __body0 = () => (
    <div className={props.className} style={{
      width: "fit-content",
      height: 34,
      borderRadius: 6,
      display: "flex",
      flexDirection: "row",
      gap: 6,
      justifyContent: "flex-end",
      alignItems: "center",
      flexWrap: "nowrap",
      position: "relative",
      ...props.style,
    }}>
      {props.showDate && (
      <div style={{
        position: "relative",
        borderRadius: 100,
        backgroundColor: "rgba(118,118,128,0.12)",
        display: "flex",
        flexDirection: "row",
        gap: 5,
        padding: "6px 11px 6px 11px",
        justifyContent: "center",
        alignItems: "center",
        flexWrap: "nowrap",
        boxSizing: "border-box",
        flexShrink: 0,
        alignSelf: "stretch",
      }}>
        <span style={{
          position: "relative",
          fontFamily: "\"SF Pro\", -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif",
          fontWeight: 400,
          fontSize: 17,
          textAlign: "center",
          whiteSpace: "nowrap",
          lineHeight: "22px",
          letterSpacing: "-0.430px",
          color: "var(--labels-primary)",
          flexShrink: 0,
          alignSelf: "stretch",
        }}>{props.month}</span>
        <span style={{
          position: "relative",
          fontFamily: "\"SF Pro\", -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif",
          fontWeight: 400,
          fontSize: 17,
          textAlign: "center",
          whiteSpace: "nowrap",
          lineHeight: "22px",
          letterSpacing: "-0.430px",
          color: "var(--labels-primary)",
          flexShrink: 0,
          alignSelf: "stretch",
        }}>{props.year}</span>
      </div>
      )}
      {props.showTime && (
      <div style={{
        position: "relative",
        borderRadius: 100,
        backgroundColor: "rgba(118,118,128,0.12)",
        display: "flex",
        flexDirection: "row",
        gap: 10,
        padding: "6px 11px 6px 11px",
        alignItems: "flex-start",
        flexWrap: "nowrap",
        boxSizing: "border-box",
        flexShrink: 0,
        alignSelf: "stretch",
      }}>
        <span style={{
          position: "relative",
          fontFamily: "\"SF Pro\", -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif",
          fontWeight: 400,
          fontSize: 17,
          textAlign: "center",
          whiteSpace: "nowrap",
          lineHeight: "22px",
          letterSpacing: "-0.430px",
          color: "var(--labels-primary)",
          flexShrink: 0,
          alignSelf: "stretch",
        }}>{props.time}</span>
      </div>
      )}
    </div>
  );
  const __body1 = () => (
    <div className={props.className} style={{
      width: "fit-content",
      height: 34,
      borderRadius: 6,
      display: "flex",
      flexDirection: "row",
      gap: 6,
      justifyContent: "flex-end",
      alignItems: "center",
      flexWrap: "nowrap",
      position: "relative",
      ...props.style,
    }}>
      {props.showDate && (
      <div style={{
        position: "relative",
        borderRadius: 100,
        backgroundColor: "rgba(118,118,128,0.12)",
        display: "flex",
        flexDirection: "row",
        gap: 5,
        padding: "6px 11px 6px 11px",
        justifyContent: "center",
        alignItems: "center",
        flexWrap: "nowrap",
        boxSizing: "border-box",
        flexShrink: 0,
        alignSelf: "stretch",
      }}>
        <span style={{
          position: "relative",
          fontFamily: "\"SF Pro\", -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif",
          fontWeight: 400,
          fontSize: 17,
          textAlign: "center",
          whiteSpace: "nowrap",
          lineHeight: "22px",
          letterSpacing: "-0.430px",
          color: "var(--accents-blue)",
          flexShrink: 0,
          alignSelf: "stretch",
        }}>{props.month}</span>
        <span style={{
          position: "relative",
          fontFamily: "\"SF Pro\", -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif",
          fontWeight: 400,
          fontSize: 17,
          textAlign: "center",
          whiteSpace: "nowrap",
          lineHeight: "22px",
          letterSpacing: "-0.430px",
          color: "var(--accents-blue)",
          flexShrink: 0,
          alignSelf: "stretch",
        }}>{props.year}</span>
      </div>
      )}
      {props.showTime && (
      <div style={{
        position: "relative",
        borderRadius: 100,
        backgroundColor: "rgba(118,118,128,0.12)",
        display: "flex",
        flexDirection: "row",
        gap: 10,
        padding: "6px 11px 6px 11px",
        alignItems: "flex-start",
        flexWrap: "nowrap",
        boxSizing: "border-box",
        flexShrink: 0,
        alignSelf: "stretch",
      }}>
        <span style={{
          position: "relative",
          fontFamily: "\"SF Pro\", -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif",
          fontWeight: 400,
          fontSize: 17,
          textAlign: "center",
          whiteSpace: "nowrap",
          lineHeight: "22px",
          letterSpacing: "-0.430px",
          color: "var(--accents-blue)",
          flexShrink: 0,
          alignSelf: "stretch",
        }}>{props.time}</span>
      </div>
      )}
    </div>
  );
  const __impls = {
    // figma: State=Default
    "state=default": __body0,
    // figma: State=Selected
    "state=selected": __body1,
  };
  return (__impls[__vkey(props)] ?? __body0)();
}
export default DateAndTimeCollapsed;
