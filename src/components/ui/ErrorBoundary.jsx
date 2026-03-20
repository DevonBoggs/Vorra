import { Component } from "react";
import { getLogText } from "../../systems/debug.js";
import { dlog } from "../../systems/debug.js";
import { fs } from "../../styles/tokens.js";
import { APP_VERSION } from "../../systems/api.js";

class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null, info: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) {
    dlog('error', 'ui', `REACT CRASH: ${error.message}`, info?.componentStack?.slice(0, 500));
    this.setState({ info });
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{padding:40,background:"#060a11",color:"#e4eaf4",minHeight:"100vh",fontFamily:"'DM Sans',sans-serif"}}>
          <h1 style={{color:"#ef4444",marginBottom:16,fontFamily:"'Outfit',sans-serif"}}>Something crashed</h1>
          <p style={{color:"#8b9dc3",marginBottom:20}}>DevonSYNC v{APP_VERSION} — This is a React rendering error. Your data is safe in localStorage.</p>
          <div style={{background:"#131c30",border:"1px solid #1c2d4a",borderRadius:12,padding:20,marginBottom:20}}>
            <pre style={{color:"#ef4444",fontSize:fs(13),whiteSpace:"pre-wrap",wordBreak:"break-word",fontFamily:"'JetBrains Mono',monospace"}}>{this.state.error.message}</pre>
            {this.state.info?.componentStack && <pre style={{color:"#4a5e80",fontSize:fs(11),marginTop:12,whiteSpace:"pre-wrap",maxHeight:200,overflow:"auto"}}>{this.state.info.componentStack}</pre>}
          </div>
          <div style={{display:"flex",gap:12}}>
            <button onClick={()=>this.setState({error:null,info:null})} style={{background:"#22d3a0",color:"#060a11",border:"none",borderRadius:9,padding:"10px 20px",fontSize:fs(14),fontWeight:600,cursor:"pointer"}}>Try Again</button>
            <button onClick={()=>{navigator.clipboard.writeText(getLogText());}} style={{background:"#162035",color:"#8b9dc3",border:"1px solid #1c2d4a",borderRadius:9,padding:"10px 20px",fontSize:fs(14),cursor:"pointer"}}>Copy Debug Log</button>
            <button onClick={()=>{localStorage.removeItem("ds-v1");localStorage.removeItem("ds-favs");localStorage.removeItem("ds-custom-streams");location.reload()}} style={{background:"#ef444433",color:"#ef4444",border:"none",borderRadius:9,padding:"10px 20px",fontSize:fs(14),cursor:"pointer"}}>Reset All Data</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export { ErrorBoundary };
export default ErrorBoundary;
