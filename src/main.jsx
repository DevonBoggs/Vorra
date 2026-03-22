import React, { Component } from 'react';
import ReactDOM from 'react-dom/client';
import './styles/global.css';
import App from './App';
import { AppRouter } from './routes.jsx';

class RootErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null, info: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) {
    console.error('[Vorra] Root crash:', error, info);
    this.setState({ info });
  }
  render() {
    if (this.state.error) {
      return React.createElement('div', {style:{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',height:'100vh',background:'#060a11',color:'#8b9dc3',fontFamily:"'Outfit','Inter',sans-serif",padding:40,textAlign:'center'}},
        React.createElement('div', {style:{fontSize:48,marginBottom:16}}, '\u26A0\uFE0F' ),
        React.createElement('h1', {style:{fontSize:24,fontWeight:800,color:'#ff6b6b',marginBottom:12}}, 'Vorra Crashed'),
        React.createElement('p', {style:{color:'#8b9dc3',marginBottom:20,maxWidth:600}}, 'A rendering error occurred. Your data is safe in localStorage.'),
        React.createElement('pre', {style:{background:'#0d1117',padding:16,borderRadius:10,fontSize:12,color:'#ff6b6b',maxWidth:700,overflow:'auto',textAlign:'left',marginBottom:20,border:'1px solid #ff6b6b33',maxHeight:200}}, String(this.state.error) + (this.state.info?.componentStack?.slice(0,500)||'')),
        React.createElement('div', {style:{display:'flex',gap:12}},
          React.createElement('button', {onClick:()=>window.location.reload(), style:{padding:'10px 24px',borderRadius:10,border:'none',background:'#22d3a0',color:'#000',fontSize:14,fontWeight:700,cursor:'pointer'}}, 'Reload App'),
          React.createElement('button', {onClick:()=>{navigator.clipboard.writeText(String(this.state.error)+'\n'+(this.state.info?.componentStack||''))}, style:{padding:'10px 24px',borderRadius:10,border:'1px solid #555',background:'transparent',color:'#8b9dc3',fontSize:14,cursor:'pointer'}}, 'Copy Error')
        )
      );
    }
    return this.props.children;
  }
}

// Global unhandled rejection handler
window.addEventListener('unhandledrejection', (e) => {
  console.error('[Vorra] Unhandled rejection:', e.reason);
});

ReactDOM.createRoot(document.getElementById('root')).render(
  React.createElement(React.StrictMode, null,
    React.createElement(RootErrorBoundary, null,
      React.createElement(AppRouter, null,
        React.createElement(App)
      )
    )
  )
);
