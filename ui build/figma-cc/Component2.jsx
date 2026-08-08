// figma node: 462:164 Component 2 (2 variants)
const __venc = (v) => String(v).replace(/[%|=]/g, encodeURIComponent);
const __vkey = (p) => "property1=" + __venc(p.property1);

export function Component2(_p = {}) {
  const props = { ..._p, property1: _p.property1 ?? "group 1000016158" };
  const __body0 = () => (
    <div className={props.className} style={{
      width: 45,
      height: 24.324,
      position: "relative",
      ...props.style,
    }}>
      <div style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: 45,
        height: 24.324,
        borderRadius: 121.62162017822266,
        backgroundColor: "rgba(131,131,131,0.3)",
        boxShadow: "0 0 0 0.608px rgb(255,255,255)",
      }} />
      <div style={{
        position: "absolute",
        left: 3,
        top: 2.436,
        width: 19.459,
        height: 19.459,
        borderRadius: 97.29730224609375,
        backgroundColor: "rgb(255,255,255)",
      }} />
    </div>
  );
  const __body1 = () => (
    <div className={props.className} style={{
      width: 45,
      height: 24.324,
      position: "relative",
      ...props.style,
    }}>
      <div style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: 45,
        height: 24.324,
        borderRadius: 121.62162017822266,
        backgroundColor: "rgb(62,195,50)",
        boxShadow: "0 0 0 0.608px rgb(255,255,255)",
      }} />
      <div style={{
        position: "absolute",
        left: 23.108,
        top: 2.435,
        width: 19.459,
        height: 19.459,
        borderRadius: 97.29730224609375,
        backgroundColor: "rgb(255,255,255)",
      }} />
    </div>
  );
  const __impls = {
    // figma: Property 1=Group 1000016158
    "property1=group 1000016158": __body0,
    // figma: Property 1=Group 1000016160
    "property1=group 1000016160": __body1,
  };
  return (__impls[__vkey(props)] ?? __body0)();
}
export default Component2;
