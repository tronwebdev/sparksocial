// figma node: 655:320 Button (1 variants)
const __venc = (v) => String(v).replace(/[%|=]/g, encodeURIComponent);
const __vkey = (p) => "property1=" + __venc(p.property1);

export function Button2(_p = {}) {
  const props = { ..._p, property1: _p.property1 ?? "default" };
  const __body0 = () => (
    <div className={props.className} style={{
      width: 192,
      height: 48,
      position: "relative",
      color: "rgb(12,12,12)",
      ...props.style,
    }}>
      <div style={{
        position: "absolute",
        left: 0,
        top: 0,
        transform: "matrix(-1,0,0,1,192,0)",
        transformOrigin: "0 0",
        width: 192,
        height: 48,
        borderRadius: 9.81969165802002,
        backgroundColor: "rgb(255,255,255)",
        boxShadow: "inset 0 0 0 1px rgb(131,131,131)",
      }} />
      <span style={{
        position: "absolute",
        left: 39.854,
        top: 14,
        width: 132,
        height: 20,
        fontFamily: "Onest, -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif",
        fontWeight: 600,
        fontSize: 16,
        whiteSpace: "nowrap",
        lineHeight: "100%",
        color: "rgb(12,12,12)",
      }}>{props.text1 ?? "Create Campaign"}</span>
      <svg width={13.854} height={13.814} viewBox="0 0 13.854 13.814" fill="none" style={{
        position: "absolute",
        left: 20,
        top: 17,
        width: 13.854,
        height: 13.814,
      }}>
        <path d={"M 5.423 5.383 L 5.423 0 L 8.471 0 L 8.471 5.383 L 13.854 5.383 L 13.854 8.471 L 8.471 8.471 L 8.471 13.814 L 5.423 13.814 L 5.423 8.471 L 0 8.471 L 0 5.383 L 5.423 5.383 Z"} fill="currentColor" fillRule="nonzero" />
      </svg>
    </div>
  );
  const __impls = {
    // figma: Property 1=Default
    "property1=default": __body0,
  };
  return (__impls[__vkey(props)] ?? __body0)();
}
export default Button2;
