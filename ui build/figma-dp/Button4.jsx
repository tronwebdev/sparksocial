// figma node: 1627:427 Button (1 variants)
const __venc = (v) => String(v).replace(/[%|=]/g, encodeURIComponent);
const __vkey = (p) => "property1=" + __venc(p.property1);

export function Button4(_p = {}) {
  const props = { ..._p, property1: _p.property1 ?? "default" };
  const __body0 = () => (
    <div className={props.className} style={{
      width: 218,
      height: 47,
      position: "relative",
      color: "rgb(131,131,131)",
      ...props.style,
    }}>
      <div style={{
        position: "absolute",
        left: 0,
        top: 0,
        transform: "matrix(-1,0,0,1,218,0)",
        transformOrigin: "0 0",
        width: 218,
        height: 47,
        borderRadius: 7.427953720092773,
        backgroundColor: "rgb(255,255,255)",
        boxShadow: "inset 0 0 0 0.573px rgba(0,0,0,0.2)",
      }} />
      <span style={{
        position: "absolute",
        left: 0,
        top: 0,
        transform: "matrix(1,-0.001,0.001,1,39,13.146)",
        transformOrigin: "0 0",
        width: 104,
        height: 20,
        fontFamily: "Onest, -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif",
        fontWeight: 500,
        fontSize: 16,
        whiteSpace: "nowrap",
        lineHeight: "100%",
        color: "rgba(0,0,0,0.6)",
      }}>{props.text1 ?? "Quick Actions"}</span>
      <div className="fig-asset-afc1743a39520bf8-11d5c2e7" style={{
        position: "absolute",
        left: 9,
        top: 11,
        width: 27,
        height: 27,
      }} />
      <svg width={7.501} height={15.001} viewBox="0 0 7.501 15.001" fill="none" style={{
        position: "absolute",
        left: 0,
        top: 0,
        transform: "matrix(0,1,-1,0,202.001,20)",
        transformOrigin: "0 0",
        width: 7.501,
        height: 15.001,
        borderRadius: 0.7895365953445435,
      }}>
        <path d={"M 0.698 -0.698 C 0.312 -1.083 -0.312 -1.083 -0.698 -0.698 C -1.083 -0.312 -1.083 0.312 -0.698 0.698 L 0 0 L 0.698 -0.698 Z M -0.698 14.303 C -1.083 14.689 -1.083 15.314 -0.698 15.699 C -0.312 16.084 0.312 16.084 0.698 15.699 L 0 15.001 L -0.698 14.303 Z M 0 0 L -0.698 0.698 L 6.244 7.64 L 6.942 6.942 L 7.64 6.244 L 0.698 -0.698 L 0 0 Z M 6.942 8.059 L 6.244 7.361 L -0.698 14.303 L 0 15.001 L 0.698 15.699 L 7.64 8.757 L 6.942 8.059 Z M 6.942 6.942 L 6.244 7.64 C 6.167 7.563 6.167 7.438 6.244 7.361 L 6.942 8.059 L 7.64 8.757 C 8.334 8.063 8.334 6.938 7.64 6.244 L 6.942 6.942 Z"} fill="currentColor" fillRule="nonzero" />
      </svg>
    </div>
  );
  const __impls = {
    // figma: Property 1=Default
    "property1=default": __body0,
  };
  return (__impls[__vkey(props)] ?? __body0)();
}
export default Button4;
