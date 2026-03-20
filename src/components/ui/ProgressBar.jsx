import { useTheme } from "../../styles/tokens.js";

const ProgressBar = ({value, max, color, h = 7}) => {
  const T = useTheme();
  const c = color || T.accent;
  return (
    <div style={{background:T.input,borderRadius:h,height:h,width:"100%",overflow:"hidden"}}>
      <div style={{height:"100%",width:`${Math.min((value/max)*100,100)}%`,background:c,borderRadius:h,transition:"width .5s ease"}}/>
    </div>
  );
};

export { ProgressBar };
export default ProgressBar;
