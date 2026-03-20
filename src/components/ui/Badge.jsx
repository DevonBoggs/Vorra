import { fs } from "../../styles/tokens.js";

const Badge = ({color, bg, children, style: s}) => (
  <span style={{fontSize:fs(10),padding:"3px 9px",borderRadius:5,fontWeight:600,background:bg,color,letterSpacing:.3,...s}}>{children}</span>
);

export { Badge };
export default Badge;
