// figma node: 1729:693 Chevron down
export function ChevronDown(_p = {}) {
  const props = _p;
  return (
    <div className={props.className} style={{
      width: 16,
      height: 16,
      overflow: "hidden",
      position: "relative",
      color: "var(--icon-default-default)",
      ...props.style,
    }}>
      <svg width={8} height={4} viewBox="0 0 8 4" fill="none" style={{
        position: "absolute",
        left: 4,
        top: 6,
        width: 8,
        height: 4,
      }}>
        <path d={"M 0 0 L 4 4 L 8 0 Z"} fill="currentColor" fillRule="evenodd" />
      </svg>
    </div>
  );
}
export default ChevronDown;
