import { useTheme, fs } from "../../styles/tokens.js";

const Label = ({children}) => {
  const T = useTheme();
  return <label style={{fontSize:fs(11),color:T.soft,marginBottom:4,display:"block",fontWeight:600,letterSpacing:.3}}>{children}</label>;
};

export { Label };
export default Label;
