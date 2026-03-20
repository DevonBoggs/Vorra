import { useTheme, fs } from "../../styles/tokens.js";

const Btn=({children,onClick,v="primary",small,disabled,style:s})=>{
  const T = useTheme();
  const V={primary:{background:`linear-gradient(135deg,${T.accent},${T.accent}dd)`,color:"#060e09",boxShadow:`0 2px 8px ${T.accentM}`},secondary:{background:T.input,color:T.text,border:`1px solid ${T.border}`},danger:{background:T.redD,color:T.red,border:`1px solid ${T.red}33`},ghost:{background:"transparent",color:T.soft,border:`1px solid ${T.border}`},ai:{background:`linear-gradient(135deg,${T.purple},${T.blue})`,color:"#fff",boxShadow:`0 2px 12px ${T.purple}44`}};
  return (<button className="sf-btn" disabled={disabled} onClick={onClick} style={{...V[v],borderRadius:10,cursor:disabled?"not-allowed":"pointer",padding:small?"6px 14px":"10px 20px",fontSize:small?fs(12):fs(13),fontFamily:"'Outfit',sans-serif",fontWeight:600,display:"inline-flex",alignItems:"center",gap:6,transition:"all .2s",opacity:disabled?.45:1,whiteSpace:"nowrap",minHeight:small?30:36,letterSpacing:"0.2px",...s}}>{children}</button>)
};

export { Btn };
export default Btn;
