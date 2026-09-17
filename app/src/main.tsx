import { createRoot } from 'react-dom/client';
import { useEffect, useState, Component, type ReactNode } from 'react';
import WorkApp from './WorkApp';
import { initializeStorage } from './storage';
import { configureAndroidBack } from './mobile';
import './base.css';
import './app.css';
import './native.css';

class ErrorBoundary extends Component<{children:ReactNode},{failed:boolean}> {
  state={failed:false};
  static getDerivedStateFromError(){return {failed:true};}
  render(){return this.state.failed?<div className="boot"><h1>拾迹</h1><p>界面暂时未能打开。已保存的记录仍在本机。</p><button onClick={()=>location.reload()}>重新打开</button></div>:this.props.children;}
}
function Root(){
  const [ready,setReady]=useState(false),[error,setError]=useState('');
  useEffect(()=>{initializeStorage().then(()=>setReady(true)).catch(()=>setError('无法读取本地记录，请重新打开。原始数据不会被覆盖。'));void configureAndroidBack();},[]);
  useEffect(()=>{const fail=(event:Event)=>setError((event as CustomEvent<string>).detail);window.addEventListener('shiji-storage-error',fail);return()=>window.removeEventListener('shiji-storage-error',fail);},[]);
  if(!ready)return <div className="boot"><img src="/icon.svg" alt=""/><h1>拾迹</h1><p>{error||'记录工作，留住进展'}</p>{error&&<button onClick={()=>location.reload()}>重新打开</button>}</div>;
  return <ErrorBoundary><WorkApp/>{error&&<div className="storage-error" role="alert">{error}<button onClick={()=>location.reload()}>重新打开</button></div>}</ErrorBoundary>;
}
createRoot(document.getElementById('root')!).render(<Root/>);
