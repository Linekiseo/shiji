import { useEffect, useRef, useState, type PropsWithChildren, type InputHTMLAttributes, type TextareaHTMLAttributes, type Ref } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';

const dismissKeyboard = () => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); };
export const useKeyboard = () => ({ hide: dismissKeyboard });
export function useKeyboardInsets() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    let fullHeight = window.innerHeight;
    const update = () => {
      const height = window.visualViewport?.height ?? window.innerHeight;
      fullHeight = Math.max(fullHeight, window.innerHeight);
      const open = fullHeight - height > 120;
      setVisible(open);
      document.documentElement.style.setProperty('--viewport-height', `${height}px`);
    };
    window.visualViewport?.addEventListener('resize', update);
    window.addEventListener('resize', update); update();
    return () => { window.visualViewport?.removeEventListener('resize', update); window.removeEventListener('resize', update); };
  }, []);
  return { bottomInset: 0, isKeyboardVisible: visible, keyboardHeight: 0 };
}
export function KeyboardInput(props: InputHTMLAttributes<HTMLInputElement> & { ref?: Ref<HTMLInputElement> }) { return <input {...props}/>; }
export function KeyboardTextarea(props: TextareaHTMLAttributes<HTMLTextAreaElement> & { ref?: Ref<HTMLTextAreaElement> }) { return <textarea {...props}/>; }

export function MobileScroll({ className='', children }: PropsWithChildren<{className?:string}>) {
  return <div className={`mobile-page ${className}`}><div className="mobile-scroll"><div className="mobile-scroll-content">{children}</div></div></div>;
}
export function Carousel({className='',contentClassName='',ariaLabel,children}:PropsWithChildren<{className?:string;contentClassName?:string;ariaLabel?:string}>) {
  return <div className={`mobile-carousel ${className}`} aria-label={ariaLabel}><div className={`mobile-carousel-content ${contentClassName}`}>{children}</div></div>;
}

// Android Back closes the foremost transient surface before navigating a page.
const backHandlers: (()=>boolean)[] = [];
export function useAndroidBack(handler:()=>boolean) {
  const latest=useRef(handler); latest.current=handler;
  useEffect(()=>{ const proxy=()=>latest.current(); backHandlers.push(proxy); return()=>{const i=backHandlers.indexOf(proxy);if(i>=0)backHandlers.splice(i,1);}; },[]);
}
export async function configureAndroidBack() {
  if (!Capacitor.isNativePlatform()) return;
  await App.addListener('backButton',()=>{
    if(document.activeElement?.matches('input,textarea')){dismissKeyboard();return;}
    for(let i=backHandlers.length-1;i>=0;i--)if(backHandlers[i]())return;
    void App.minimizeApp();
  });
}

export function BottomSheet({open,onOpenChange,title,description,snap=.72,children}:PropsWithChildren<{open:boolean;onOpenChange:(open:boolean)=>void;title:string;description?:string;snap?:number}>) {
  useEffect(()=>{if(open)dismissKeyboard();},[open]);
  useAndroidBack(()=>{if(!open)return false;onOpenChange(false);return true;});
  const start=useRef(0);
  return <Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Portal>
    <Dialog.Overlay className="sheet-overlay"/>
    <Dialog.Content className="bottom-sheet" style={{maxHeight:`${snap*100}dvh`}} aria-describedby={description?undefined:undefined} onOpenAutoFocus={event=>event.preventDefault()}>
      <div className="sheet-handle-zone" onPointerDown={e=>{start.current=e.clientY;e.currentTarget.setPointerCapture(e.pointerId);}} onPointerUp={e=>{if(e.clientY-start.current>70)onOpenChange(false);}}><div className="sheet-handle"/></div>
      <div className="sheet-header"><Dialog.Title className="sheet-title">{title}</Dialog.Title>{description&&<Dialog.Description className="sheet-description">{description}</Dialog.Description>}</div>
      <div className="sheet-content">{children}</div>
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>;
}
