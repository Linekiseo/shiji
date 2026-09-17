import { useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type Ref } from "react";
import { readSlot, persistSlot, flushStorage, portableBackup } from "./storage";
import { download, chooseNativeImages, isAndroid } from "./native";
import { localDay, localTimestamp } from "./dates";
import { isValidBackup } from "./backup";
import {
  ArrowLeft, ArrowUp, ArrowCounterClockwise, ArrowsOutSimple, CalendarBlank, CaretDown, CaretLeft,
  CaretRight, CaretUp, Check, CheckCircle, CheckSquare, Circle, ClockCounterClockwise, Play,
  DotsThreeVertical, DownloadSimple, FileText, FunnelSimple, ListBullets,
  MagnifyingGlass, NotePencil, PencilSimple, Plus, Square, TagSimple, Trash, UploadSimple, X,
  Camera, Microphone, Stop, Pause, ImageSquare, ListChecks, Paperclip, CaretDoubleDown, PenNib, Minus, FolderSimple, Briefcase, UsersThree, Code, BookOpen,
  Lightbulb, ChartBar, ChatCircle, Globe, House, Wrench, Flag, Heart, SquaresFour, Palette
} from "@phosphor-icons/react";
import { BottomSheet, Carousel, KeyboardInput, KeyboardTextarea, MobileScroll, useKeyboard, useKeyboardInsets, useAndroidBack } from "./mobile";

type Status = "todo" | "doing" | "done";
type EventKind = "created" | "progress" | "status" | "done" | "reopened" | "edited";
type ActivityType = "created" | "done" | "status" | "progress";
type Attachment = { id: string; kind: "photo" | "audio"; src: string; name: string; seconds?: number; width?: number; height?: number; source?: "upload" | "camera" | "microphone" };
type PhotoGallery = { photos: Attachment[]; index: number; title: string; at: string };
type AudioCaptureHandle = { finish: () => Promise<Attachment|null> };
type Subtask = { id: string; title: string; status: Status; createdAt: string };
type Entry = { id: string; at: string; recordedAt?: string; originalText?: string; fromStatus?: Status; text: string; kind: EventKind; status: Status; subtaskId?: string; childAction?: "created" | "status" | "progress"; childStatus?: Status; childFromStatus?: Status; childChanges?: {id:string;before:Status}[]; attachments?: Attachment[] };
type Work = { id: string; title: string; description: string; status: Status; tag: string; createdAt: string; entries: Entry[]; subtasks?: Subtask[]; deleted?: boolean; cancelled?: boolean };
type RecordMode = "text" | "image" | "audio" | "photo";
type RecordScope = { kind: "all" | "main" | "children"; childId?: string };
type RecorderPosition = { x:number; y:number };
type Page = { name: "home" | "todo" | "timeline" | "detail" | "editor" | "search" | "data" | "trash" | "cancelled"; id?: string; mode?: "new" | "edit" | "progress" };
type Draft = { text: string; title: string; date: string; time: string; status: Status; tag: string };
type Filter = { status: string; tag: string; date: string };
type Sheet = "none" | "filter" | "sort" | "menu" | "item-menu" | "status" | "tag" | "date" | "progress" | "delete" | "export" | "record-child";
let TODAY = localDay();
const LABEL: Record<Status, string> = { todo: "未开始", doing: "进行中", done: "已完成" };
const KIND: Record<EventKind, string> = { created: "新增事项", progress: "记录进展", status: "状态变更", done: "完成事项", reopened: "继续处理", edited: "编辑事项" };
const ACTIVITY: ActivityType[] = ["created","done","status","progress"];
const ACTIVITY_LABEL: Record<ActivityType,string> = {created:"新增事项",done:"完成事项",status:"状态变更",progress:"记录进展"};
const ACTIVITY_SHORT: Record<ActivityType,string> = {created:"新增",done:"完成",status:"状态",progress:"进展"};
const ACTIVITY_UNIT: Record<ActivityType,string> = {created:"项",done:"次",status:"次",progress:"条"};
const activityType = (e: Entry): ActivityType => e.kind === "done" ? "done" : e.kind === "created" ? "created" : e.kind === "status" || e.kind === "reopened" ? "status" : "progress";
const activityCounts = (events: Entry[]): Record<ActivityType,number> => events.reduce((counts,e)=>({...counts,[activityType(e)]:counts[activityType(e)]+1}), {created:0,done:0,status:0,progress:0});
const activityDescription = (events:Entry[]) => {const counts=activityCounts(events);return ACTIVITY.map(t=>ACTIVITY_LABEL[t]+" "+counts[t]+" "+ACTIVITY_UNIT[t]).join("，");};
const TAGS = ["未分类", "资料", "协作", "设计", "其他"];
const EMPTY_FILTER: Filter = { status: "all", tag: "all", date: "all" };
const mkId = () => crypto.randomUUID();
const dateObj = (d: string) => new Date(d + "T12:00:00");
const dayKey = (d: Date) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const addDays = (d: string, n: number) => { const x = dateObj(d); x.setDate(x.getDate() + n); return dayKey(x); };
const monthStart = (d: string) => d.slice(0, 7) + "-01";
const weekStart = (d: string) => addDays(d, -((dateObj(d).getDay() + 6) % 7));
const stamp = (d: string, t = "13:30") => localTimestamp(new Date(d + "T" + t));
const clock = () => new Date().toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit" });
const newDraft = (): Draft => ({ text: "", title: "", date: TODAY, time: clock(), status: "todo", tag: "未分类" });
const sortedEntries = (w: Work) => [...w.entries].reverse().sort((a, b) => b.at.localeCompare(a.at));
const recordMatchesScope = (entry: Entry, scope: RecordScope): boolean => scope.kind === "all" || (scope.kind === "main" ? !entry.subtaskId : !!entry.subtaskId && (!scope.childId || entry.subtaskId === scope.childId));
const lastEntry = (w: Work) => sortedEntries(w)[0];
const completedToday = (w: Work) => w.status === "done" && w.entries.some(e => e.kind === "done" && e.at.slice(0, 10) === TODAY);
const updateKind = (before: Status, after: Status): EventKind => before === after ? "progress" : after === "done" ? "done" : before === "done" ? "reopened" : "status";
const statusIcon = (status: Status, size = 16) => status === "done" ? <CheckCircle size={size} weight="fill"/> : status === "doing" ? <Play size={size} weight="fill"/> : <Circle size={size}/>;
const recordLabel = (e: Entry) => e.subtaskId ? e.childAction === "created" ? "新增子任务" : e.childAction === "status" ? e.childStatus === "done" ? "完成子任务" : "子任务状态" : "子任务进展" : KIND[e.kind];
const childProgress = (w: Work) => {const children=w.subtasks??[];return {total:children.length,done:children.filter(c=>c.status==="done").length};};
const resumeStatus = (w: Work): Status => sortedEntries(w).find(e=>e.kind==="done")?.fromStatus ?? "doing";
function dateLabel(d: string) {
  if (d === TODAY) return "今天";
  if (d === addDays(TODAY, -1)) return "昨天";
  const x = dateObj(d);
  return (x.getMonth() + 1) + " 月 " + x.getDate() + " 日";
}
const shortDate = (d: string) => (dateObj(d).getMonth() + 1) + "月" + dateObj(d).getDate() + "日";
const timeLabel = (at: string) => dateLabel(at.slice(0, 10)) + " " + at.slice(11, 16);
function IconButton({ label, onClick, children, className = "" }: { label: string; onClick: () => void; children: ReactNode; className?: string }) {
  return <button type="button" className={"icon-button " + className} aria-label={label} onClick={onClick}>{children}</button>;
}
function Empty({ title, text, action, onAction }: { title: string; text: string; action?: string; onAction?: () => void }) {
  return <div className="empty-state"><FileText size={38} weight="light" /><h3>{title}</h3><p>{text}</p>{action && <button className="text-button" onClick={onAction}>{action}</button>}</div>;
}
function Calendar({ selected, onSelect, future = true }: { selected: string; onSelect: (d: string) => void; future?: boolean }) {
  const [month, setMonth] = useState(monthStart(selected));
  const start = dateObj(month);
  const shift = (n: number) => { const d = dateObj(month); d.setMonth(d.getMonth() + n); setMonth(dayKey(d)); };
  const leading = (start.getDay() + 6) % 7;
  const days = new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate();
  return <div className="calendar"><div className="calendar-top"><IconButton label="上个月" onClick={() => shift(-1)}><CaretLeft size={19} /></IconButton><strong>{start.getFullYear()} 年 {start.getMonth() + 1} 月</strong><IconButton label="下个月" onClick={() => shift(1)}><CaretRight size={19} /></IconButton></div><div className="calendar-grid">{["一","二","三","四","五","六","日"].map(d => <span className="weekday" key={d}>{d}</span>)}{Array.from({ length: leading }, (_, i) => <span key={"blank-" + i} />)}{Array.from({ length: days }, (_, i) => { const d = month.slice(0, 8) + String(i + 1).padStart(2, "0"); return <button key={d} className={(d === selected ? "selected " : "") + (d === TODAY ? "today" : "")} disabled={!future && d > TODAY} onClick={() => onSelect(d)} aria-label={"选择日期 " + d}>{i + 1}</button>; })}</div></div>;
}
function RecentRecords({work,history,onDetail,onViewPhotos}: {work:Work;history:Entry[];onDetail:()=>void;onViewPhotos?:(photos:Attachment[],index:number,trigger:HTMLButtonElement,entry:Entry)=>void}) {
  const [edge,setEdge] = useState({start:true,end:history.length<3});
  const viewportRef = useRef<HTMLDivElement>(null);
  const hasMedia=!!onViewPhotos&&history.some(e=>!!e.attachments?.length);
  const scrollable = history.length>2||hasMedia;
  useLayoutEffect(()=>{const el=viewportRef.current?.querySelector<HTMLElement>(".mobile-scroll");if(el){el.scrollTop=0;setEdge({start:true,end:el.scrollHeight<=el.clientHeight+5});}},[history[0]?.id]);
  return <section className="entry-history" id={"recent-"+work.id} aria-label={work.title+"的最近记录"}>
    <div className="entry-history-header"><span>从新到旧 · {history.length} 条</span><button onClick={onDetail} aria-label={"查看完整记录 "+work.title}>完整记录<CaretRight size={12}/></button></div>
    <div ref={viewportRef} className={"entry-history-viewport"+(scrollable?" scrollable":"")+(!edge.start?" has-earlier":"")+(!edge.end?" has-more":"")} style={{height:hasMedia?244:Math.min(244,history.length*94+10)}}
      onPointerDown={e=>e.stopPropagation()} onPointerMove={e=>e.stopPropagation()} onPointerUp={e=>e.stopPropagation()} onPointerCancel={e=>e.stopPropagation()}
      onScrollCapture={e=>{const el=e.target as HTMLElement;if(el.classList.contains("mobile-scroll"))setEdge({start:el.scrollTop<4,end:el.scrollTop+el.clientHeight>=el.scrollHeight-5});}}>
      <MobileScroll className="entry-history-scroll"><div className="entry-history-items">{history.map((e,index)=>{
        const after=e.childStatus??e.status;
        const before = e.subtaskId ? e.childFromStatus??history.slice(index+1).find(x=>x.subtaskId===e.subtaskId)?.childStatus : e.fromStatus ?? history[index+1]?.status;
        const changed = before && before!==after;
        const transitionOnly=before&&e.text===LABEL[before]+" → "+LABEL[after];
        return <div className={"entry-history-row "+activityType(e)} key={e.id}>
          <span className="entry-history-symbol" aria-label={"当时状态："+LABEL[e.childStatus??e.status]} title={"当时状态："+LABEL[e.childStatus??e.status]}><span className={"work-status-dot "+(e.childStatus??e.status)}/></span>
          <div><div className="entry-history-meta"><time>{timeLabel(e.at)}</time><span>{recordLabel(e)}</span></div>
            {e.subtaskId&&e.subtaskId!==work.id&&<span className="record-child-label">{work.subtasks?.find(c=>c.id===e.subtaskId)?.title}</span>}
            {!transitionOnly&&<RecordText text={e.text}/>}
            {!!e.attachments?.length&&(onViewPhotos?<Attachments attachments={e.attachments} onView={(photos,index,trigger)=>onViewPhotos(photos,index,trigger,e)}/>:<span className="record-attachment-count"><Paperclip size={13}/>{e.attachments.length} 个附件</span>)}
            {changed&&<div className="entry-history-state"><span className={"history-state-label "+before}>{LABEL[before!]}</span><span className="history-state-arrow">→</span><span className={"history-state-label "+after}>{LABEL[after]}</span></div>}

          </div>
        </div>;
      })}</div></MobileScroll>
    </div>
    {scrollable&&<div className="entry-history-scroll-hint">{edge.end?"已到最早一条记录":<><CaretUp size={11}/>在这里上滑，查看更早记录</>}</div>}
  </section>;
}
function RecordText({text}: {text:string}) {
  const [expanded,setExpanded]=useState(false);
  const long=text.length>180||text.split("\n").length>5;
  return <div className="record-text"><p className={long&&!expanded?"record-text-clamped":""}>{text}</p>{long&&<button className="record-text-expand" onClick={()=>setExpanded(v=>!v)}>{expanded?"收起记录":"展开记录"}{expanded?<CaretUp size={12}/>:<CaretDown size={12}/>}</button>}</div>;
}
function DetailRecordFeed({work,entries,limit,onScope,onEdit,onPhotos}: {
  work:Work;entries:Entry[];limit:number;onScope:(scope:RecordScope)=>void;onEdit:(entry:Entry)=>void;
  onPhotos:(photos:Attachment[],index:number,trigger:HTMLButtonElement,entry:Entry,title:string)=>void;
}) {
  const days = new Map<string,Entry[]>();
  entries.slice(0,limit).forEach(entry=>{
    const date=entry.at.slice(0,10);
    const group=days.get(date);
    if(group)group.push(entry);else days.set(date,[entry]);
  });
  return <div className="detail-record-feed">{[...days].map(([date,records])=>{
    const total=entries.filter(entry=>entry.at.startsWith(date)).length;
    const relative=date===TODAY||date===addDays(TODAY,-1);
    return <section className="record-day" key={date} aria-label={dateLabel(date)+"的进展记录"}>
      <div className="record-day-heading"><h4>{dateLabel(date)}</h4><span>{relative?shortDate(date)+" · ":date.slice(0,4)!==TODAY.slice(0,4)?date.slice(0,4)+" 年 · ":""}周{"日一二三四五六"[dateObj(date).getDay()]}</span><small>{records.length<total?records.length+" / ":""}{total} 条</small></div>
      <div className="record-day-list">{records.map(entry=>{
        const child=entry.subtaskId?work.subtasks?.find(task=>task.id===entry.subtaskId):undefined;
        const after=entry.childStatus??entry.status;
        const before=entry.subtaskId?entry.childFromStatus:entry.fromStatus;
        const changed=!!before&&before!==after;
        const transitionOnly=changed&&entry.text===LABEL[before!]+" → "+LABEL[after];
        const created=entry.subtaskId?entry.childAction==="created":entry.kind==="created";
        const mediaOnly=!!entry.attachments?.length&&(entry.text==="录音记录"||entry.text==="图片记录");
        return <article className="detail-record" key={entry.id} aria-label={timeLabel(entry.at)+" · "+(child?.title??"主任务")}>
          <div className="record-time-column"><time dateTime={entry.at}>{entry.at.slice(11,16)}</time><span className="record-timeline-mark" aria-hidden="true"/></div>
          <div className="detail-record-body">
            <div className="record-attribution">{entry.subtaskId?<button onClick={()=>onScope({kind:"children",childId:entry.subtaskId})} aria-label={"只看子任务记录："+(child?.title??"子任务")}><ListChecks size={14}/><span>{child?.title??"子任务"}</span><CaretRight size={12}/></button>:<span className="record-main-label">主任务</span>}{!entry.subtaskId&&entry.kind!=="created"&&<button className="record-edit" aria-label={"更正记录 "+entry.id} onClick={()=>onEdit(entry)}><PencilSimple size={15}/></button>}</div>
            {!transitionOnly&&!mediaOnly&&!(created&&entry.text==="建立工作记录")&&<RecordText text={entry.text}/>}
            {(changed||created)&&<div className="record-state-change">{created?<span>新增{entry.subtaskId?"子任务":"任务"}</span>:<><span>{LABEL[before!]}</span><span aria-hidden="true">→</span></>}<span className={"record-state-current "+after}>{after==="done"?<Check size={12} weight="bold"/>:<span className={"work-status-dot "+after}/>} {LABEL[after]}</span></div>}
            {!!entry.childChanges?.length&&<span className="record-linked-change">同时完成 {entry.childChanges.length} 个子任务</span>}
            {!!entry.attachments?.length&&<Attachments attachments={entry.attachments} onView={(photos,index,trigger)=>onPhotos(photos,index,trigger,entry,child?.title??work.title)}/>}
          </div>
        </article>;
      })}</div>
    </section>;
  })}</div>;
}
function PhotoPreview({photo,remaining=0,onOpen}: {photo:Attachment;remaining?:number;onOpen:(trigger:HTMLButtonElement)=>void}) {
  const [long,setLong]=useState(!!photo.width&&!!photo.height&&photo.height/photo.width>2);
  return <button className={"attachment-photo"+(long?" long-photo":"")} onClick={e=>onOpen(e.currentTarget)} aria-label={"查看图片 "+photo.name+(remaining?"，还有 "+remaining+" 张":"")}>
    <img src={photo.src} alt={photo.name} draggable={false} loading="lazy" onLoad={e=>setLong(e.currentTarget.naturalHeight/e.currentTarget.naturalWidth>2)}/>
    {remaining?<span className="photo-overflow">+{remaining}</span>:long?<span className="photo-format">长图</span>:null}
    <span className="photo-open-icon" aria-hidden="true"><ArrowsOutSimple size={14}/></span>
  </button>;
}
let playingAudio:HTMLAudioElement|null=null;
const audioTime=(seconds:number)=>{const value=Math.max(0,Math.floor(Number.isFinite(seconds)?seconds:0));return String(Math.floor(value/60)).padStart(2,"0")+":"+String(value%60).padStart(2,"0");};
function AudioPlayer({attachment,draft=false}: {attachment:Attachment;draft?:boolean}) {
  const audio=useRef<HTMLAudioElement>(null);
  const keyboard=useKeyboard();
  const [playing,setPlaying]=useState(false),[position,setPosition]=useState(0),[duration,setDuration]=useState(attachment.seconds??0),[error,setError]=useState("");
  useEffect(()=>{const player=audio.current;return()=>{player?.pause();if(playingAudio===player)playingAudio=null;};},[]);
  const readDuration=()=>{const value=audio.current?.duration;if(value&&Number.isFinite(value))setDuration(value);};
  const toggle=async()=>{keyboard.hide();const player=audio.current;if(!player)return;if(!player.paused){player.pause();return;}setError("");if(player.ended)player.currentTime=0;try{await player.play();}catch{setError("未能播放，点按重试");}};
  return <div className={"work-audio-player"+(playing?" playing":"")} role="group" aria-label={(draft?"回听":"")+attachment.name}>
    <audio ref={audio} src={attachment.src} preload="metadata" onLoadedMetadata={readDuration} onDurationChange={readDuration} onTimeUpdate={e=>setPosition(e.currentTarget.currentTime)} onPlay={e=>{if(playingAudio&&playingAudio!==e.currentTarget)playingAudio.pause();playingAudio=e.currentTarget;setPlaying(true);}} onPause={()=>setPlaying(false)} onEnded={()=>{setPlaying(false);readDuration();}} onError={()=>{setError("录音暂时无法播放");setPlaying(false);}}/>
    <button className="audio-play-toggle" aria-label={(playing?"暂停":"播放")+attachment.name} onClick={()=>void toggle()}>{playing?<Pause size={19} weight="fill"/>:<Play size={19} weight="fill"/>}</button>
    <div className="audio-play-content"><div className="audio-play-meta"><span>{error||attachment.name}</span><output aria-label="录音时长">{audioTime(position)}<span> / {audioTime(duration)}</span></output></div>
      <input className="audio-seek" type="range" min={0} max={duration||1} step={0.1} value={Math.min(position,duration||1)} disabled={!duration||!!error} aria-label={"播放进度 "+attachment.name} aria-valuetext={audioTime(position)+"，共 "+audioTime(duration)} data-scroll-drag="ignore" style={{"--audio-progress":(duration?Math.min(100,position/duration*100):0)+"%"} as CSSProperties} onChange={e=>{const next=Number(e.target.value);if(audio.current){audio.current.currentTime=next;setPosition(next);}}}/>
    </div>
  </div>;
}
function Attachments({attachments,onView}: {attachments:Attachment[];onView:(photos:Attachment[],index:number,trigger:HTMLButtonElement)=>void}) {
  const photos=attachments.filter(a=>a.kind==="photo");
  return <div className="record-attachments">{!!photos.length&&<><div className="attachment-summary"><ImageSquare size={14}/><span>{photos.length} 张图片</span></div><div className={"attachment-grid "+(photos.length===1?"single":photos.length===2?"pair":"multiple")}>
    {photos.slice(0,6).map((photo,index)=><PhotoPreview key={photo.id} photo={photo} remaining={index===5?photos.length-6:0} onOpen={trigger=>onView(photos,index,trigger)}/>)}</div></>}
    {attachments.filter(a=>a.kind==="audio").map(a=><div className="audio-attachment" key={a.id}><AudioPlayer attachment={a}/></div>)}
  </div>;
}
function PhotoViewer({gallery,onClose}: {gallery:PhotoGallery;onClose:()=>void}) {
  const [index,setIndex]=useState(gallery.index),[zoom,setZoom]=useState(1),[mode,setMode]=useState<"fit"|"width">("fit");
  const [natural,setNatural]=useState({width:0,height:0}),[viewport,setViewport]=useState({width:0,height:0});
  const stage=useRef<HTMLDivElement>(null),closeButton=useRef<HTMLButtonElement>(null),strip=useRef<HTMLDivElement>(null);
  const drag=useRef<{id:number;x:number;y:number;left:number;top:number;ratio:number}|null>(null);
  const photo=gallery.photos[index],long=natural.height>natural.width*2;
  const fit=natural.width?Math.min(viewport.width/natural.width,viewport.height/natural.height):0;
  const scale=(mode==="width"&&natural.width?viewport.width/natural.width:fit)*zoom;
  const width=Math.round(natural.width*scale),height=Math.round(natural.height*scale);
  useLayoutEffect(()=>{const el=stage.current;if(!el)return;const measure=()=>setViewport({width:el.clientWidth,height:el.clientHeight});measure();const observer=new ResizeObserver(measure);observer.observe(el);closeButton.current?.focus();return()=>observer.disconnect();},[]);
  useEffect(()=>{const dismiss=(event:KeyboardEvent)=>{if(event.key==="Escape"){event.preventDefault();onClose();}};window.addEventListener("keydown",dismiss);return()=>window.removeEventListener("keydown",dismiss);},[onClose]);
  useLayoutEffect(()=>{const el=stage.current;if(el){el.scrollTop=0;el.scrollLeft=0;}},[photo.id,mode]);
  const selectPhoto=(next:number)=>{
    if(next<0||next>=gallery.photos.length||next===index)return;
    setIndex(next);setNatural({width:0,height:0});setZoom(1);setMode("fit");
    requestAnimationFrame(()=>{const rail=strip.current?.querySelector<HTMLElement>(".mobile-carousel");const selected=strip.current?.querySelector<HTMLElement>('[aria-pressed="true"]');selected?.focus({preventScroll:true});if(rail&&selected)rail.scrollTo({left:selected.offsetLeft-rail.clientWidth/2+selected.offsetWidth/2,behavior:"smooth"});});
  };
  const changeZoom=(next:number)=>{const el=stage.current;if(!el)return;const factor=next/zoom;const x=(el.scrollLeft+el.clientWidth/2)*factor-el.clientWidth/2,y=(el.scrollTop+el.clientHeight/2)*factor-el.clientHeight/2;setZoom(next);requestAnimationFrame(()=>{el.scrollTo({left:x,top:y});el.focus({preventScroll:true});});};
  return <section className="photo-viewer" role="dialog" aria-modal="true" aria-label="图片查看" onKeyDown={e=>{
    if(e.key==="ArrowLeft"){e.preventDefault();selectPhoto(index-1);}
    if(e.key==="ArrowRight"){e.preventDefault();selectPhoto(index+1);}
    if(e.key==="Tab"){const controls=Array.from(e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),[tabindex="0"]'));const at=controls.indexOf(document.activeElement as HTMLElement);if(e.shiftKey&&at<=0){e.preventDefault();controls.at(-1)?.focus();}else if(!e.shiftKey&&at===controls.length-1){e.preventDefault();controls[0]?.focus();}}
  }}>
    <header className="photo-viewer-toolbar"><button ref={closeButton} aria-label="关闭图片" onClick={onClose}><ArrowLeft size={22}/></button><div><strong>{gallery.title}</strong><span>{timeLabel(gallery.at)}</span></div><span className="photo-page-count" aria-live="polite">{index+1}<span> / {gallery.photos.length}</span></span></header>
    <div ref={stage} className="photo-stage" tabIndex={0} aria-label={long?"长图阅读区域，可上下拖动":"图片阅读区域，放大后可拖动"}
      onDoubleClick={()=>changeZoom(zoom===1?2:1)}
      onPointerDown={e=>{if(e.button!==0)return;const el=e.currentTarget;drag.current={id:e.pointerId,x:e.clientX,y:e.clientY,left:el.scrollLeft,top:el.scrollTop,ratio:el.clientWidth/el.getBoundingClientRect().width};el.setPointerCapture(e.pointerId);}}
      onPointerMove={e=>{const d=drag.current;if(!d||d.id!==e.pointerId)return;e.currentTarget.scrollLeft=d.left-(e.clientX-d.x)*d.ratio;e.currentTarget.scrollTop=d.top-(e.clientY-d.y)*d.ratio;}}
      onPointerUp={()=>{drag.current=null;}} onPointerCancel={()=>{drag.current=null;}}>
      <div className="photo-canvas" style={{width:Math.max(viewport.width,width),height:Math.max(viewport.height,height)}}><img key={photo.id} src={photo.src} alt={photo.name} draggable={false} style={{width:width||"100%",height:height||"auto",opacity:natural.width?1:0}} onLoad={e=>{const image=e.currentTarget;setNatural({width:image.naturalWidth,height:image.naturalHeight});setMode(image.naturalHeight/image.naturalWidth>2?"width":"fit");}}/></div>
    </div>
    <div className={"photo-viewer-controls"+(gallery.photos.length===1?" single-photo-controls":"")}>{gallery.photos.length>1&&<button aria-label="上一张图片" disabled={index===0} onClick={()=>selectPhoto(index-1)}><CaretLeft size={20}/></button>}<div className="photo-zoom"><button aria-label="缩小图片" disabled={zoom===1} onClick={()=>changeZoom(Math.max(1,zoom-.5))}><Minus size={18}/></button><button className="photo-fit" onClick={()=>{setMode(mode==="fit"?"width":"fit");setZoom(1);}}>{mode==="width"?"适应全图":"按宽度查看"}</button><button aria-label="放大图片" disabled={zoom===3} onClick={()=>changeZoom(Math.min(3,zoom+.5))}><Plus size={18}/></button></div>{gallery.photos.length>1&&<button aria-label="下一张图片" disabled={index===gallery.photos.length-1} onClick={()=>selectPhoto(index+1)}><CaretRight size={20}/></button>}</div>
    {gallery.photos.length>1&&<div ref={strip} className="photo-strip"><Carousel ariaLabel="本条记录的图片" className="photo-strip-carousel" contentClassName="photo-strip-track">{gallery.photos.map((item,i)=><button key={item.id} aria-label={"查看第 "+(i+1)+" 张图片"} aria-pressed={index===i} onClick={()=>selectPhoto(i)}><img src={item.src} alt="" draggable={false}/></button>)}</Carousel></div>}
  </section>;
}
function captureError(error:unknown,device:string) {
  const name=error instanceof DOMException?error.name:"";
  return name==="NotAllowedError"?device+"权限未开启":name==="NotFoundError"?"未检测到可用"+device:name==="NotReadableError"?device+"暂时无法使用":"暂时无法开启"+device;
}
function AudioCapture({control,onCapture,onRecordingChange}: {control:Ref<AudioCaptureHandle>;onCapture:(a:Attachment)=>void;onRecordingChange:(active:boolean)=>void}) {
  const [phase,setPhase]=useState<"idle"|"requesting"|"recording"|"processing">("idle");
  const [seconds,setSeconds]=useState(0),[error,setError]=useState("");
  const recorder=useRef<MediaRecorder|null>(null),stream=useRef<MediaStream|null>(null);
  const started=useRef(0),generation=useRef(0),mounted=useRef(true);
  const completion=useRef<Promise<Attachment|null>|null>(null),resolveCompletion=useRef<((attachment:Attachment|null)=>void)|null>(null);
  const finish=(attachment:Attachment|null=null)=>{recorder.current=null;stream.current=null;resolveCompletion.current?.(attachment);resolveCompletion.current=null;completion.current=null;if(mounted.current){setPhase("idle");onRecordingChange(false);}};
  const stop=()=>{const pending=completion.current;if(recorder.current?.state==="recording"){setPhase("processing");recorder.current.stop();}else if(phase==="requesting"){generation.current++;finish();}return pending??Promise.resolve(null);};
  useImperativeHandle(control,()=>({finish:stop}));
  useEffect(()=>{const pause=()=>{if(document.hidden&&recorder.current?.state==="recording")void stop();};document.addEventListener("visibilitychange",pause);return()=>document.removeEventListener("visibilitychange",pause);},[phase]);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;generation.current++;onRecordingChange(false);if(recorder.current?.state==="recording")recorder.current.stop();stream.current?.getTracks().forEach(t=>t.stop());resolveCompletion.current?.(null);};},[]);
  useEffect(()=>{if(phase!=="recording")return;const timer=window.setInterval(()=>setSeconds(Math.floor((Date.now()-started.current)/1000)),250);return()=>clearInterval(timer);},[phase]);
  const start=async()=>{
    const request=++generation.current;setError("");setSeconds(0);setPhase("requesting");onRecordingChange(true);playingAudio?.pause();
    completion.current=new Promise(resolve=>{resolveCompletion.current=resolve;});
    try {
      if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==="undefined")throw new Error("unsupported");
      const input=await navigator.mediaDevices.getUserMedia({audio:true});
      if(!mounted.current||request!==generation.current){input.getTracks().forEach(t=>t.stop());return;}
      stream.current=input;
      const mime=["audio/webm;codecs=opus","audio/mp4","audio/ogg;codecs=opus"].find(type=>MediaRecorder.isTypeSupported(type));
      const rec=new MediaRecorder(input,mime?{mimeType:mime}:undefined);recorder.current=rec;
      const chunks:BlobPart[]=[];rec.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
      rec.onerror=()=>{input.getTracks().forEach(t=>t.stop());if(mounted.current&&request===generation.current){generation.current++;setError("录音中断，请重新录制");finish();}};
      rec.onstop=()=>{
        input.getTracks().forEach(t=>t.stop());
        if(!mounted.current||request!==generation.current)return;
        const duration=Math.max(.1,(Date.now()-started.current)/1000);
        const blob=new Blob(chunks,{type:rec.mimeType||"audio/webm"});
        if(!blob.size){setError("没有录到声音文件，请重试");finish();return;}
        const file=new FileReader();
        file.onload=()=>{if(mounted.current&&request===generation.current){const attachment:Attachment={id:mkId(),kind:"audio",src:String(file.result),name:"录音 "+clock(),seconds:duration,source:"microphone"};onCapture(attachment);finish(attachment);}};
        file.onerror=()=>{if(mounted.current&&request===generation.current){setError("录音文件未能保存，请重试");finish();}};
        file.readAsDataURL(blob);
      };
      started.current=Date.now();setSeconds(0);rec.start(250);setPhase("recording");
    }catch(reason){if(mounted.current&&request===generation.current){stream.current?.getTracks().forEach(t=>t.stop());setError(captureError(reason,"麦克风"));finish();}}
  };
  return <div className={"audio-capture "+(phase==="recording"?"recording":"")} data-capture-state={phase}><span className="audio-timer">{audioTime(seconds)}</span><button className="audio-record-button" disabled={phase==="processing"} aria-label={phase==="recording"?"结束录音":phase==="requesting"?"取消开启录音":"开始录音"} onClick={()=>{if(phase==="recording"||phase==="requesting")void stop();else void start();}}>{phase==="recording"?<Stop size={25} weight="fill"/>:phase==="requesting"?<X size={25}/>:<Microphone size={27}/>}</button><span role={error?"alert":undefined}>{error||(phase==="requesting"?"正在开启麦克风":phase==="processing"?"正在保存录音":phase==="recording"?"正在录音 · 点击结束":"点击开始录音")}</span></div>;
}
function CameraCapture({onCapture,onNativeCamera}: {onCapture:(a:Attachment)=>void;onNativeCamera:()=>void}) {
  const [phase,setPhase]=useState<"starting"|"ready"|"captured"|"error">("starting"),[error,setError]=useState("");
  const video=useRef<HTMLVideoElement>(null),stream=useRef<MediaStream|null>(null),generation=useRef(0);
  const stop=()=>{stream.current?.getTracks().forEach(t=>t.stop());stream.current=null;};
  const start=async()=>{
    const request=++generation.current;setPhase("starting");setError("");
    try {
      if(!navigator.mediaDevices?.getUserMedia)throw new Error("unsupported");
      const input=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:"environment"},width:{ideal:1280},height:{ideal:960}},audio:false});
      if(request!==generation.current){input.getTracks().forEach(t=>t.stop());return;}
      stream.current=input;
      if(!video.current){stop();return;}video.current.srcObject=input;await video.current.play();
    }catch(reason){if(request===generation.current){stop();setError(captureError(reason,"相机"));setPhase("error");}}
  };
  useEffect(()=>{void start();return()=>{generation.current++;stop();};},[]);
  const takePhoto=()=>{
    const preview=video.current;if(!preview?.videoWidth||!preview.videoHeight)return;
    const canvas=document.createElement("canvas");canvas.width=preview.videoWidth;canvas.height=preview.videoHeight;
    const context=canvas.getContext("2d");if(!context)return;
    context.drawImage(preview,0,0);const src=canvas.toDataURL("image/jpeg",.9);stop();setPhase("captured");
    onCapture({id:mkId(),kind:"photo",src,name:"拍照 "+clock()+".jpg",source:"camera"});
  };
  return <div className={"camera-capture "+phase} data-capture-state={phase}>{phase==="captured"?<button className="capture-again" onClick={()=>void start()}><Camera size={19}/>继续拍照</button>:phase==="error"?<div className="camera-unavailable"><Camera size={30}/><span role="alert">{error}</span><div><button onClick={()=>void start()}>重试</button><button onClick={onNativeCamera}>使用系统相机</button></div></div>:<><div className="camera-view"><video ref={video} aria-label="相机取景" autoPlay playsInline muted onLoadedData={()=>setPhase("ready")}/>{phase==="starting"&&<span>正在开启相机</span>}</div><div className="camera-actions"><button className="camera-shutter" aria-label="拍摄照片" disabled={phase!=="ready"} onClick={takePhoto}><Camera size={24}/></button></div></>}</div>;
}
function FloatingRecorder({bottom,position,onPosition,onChoose}: {bottom:number;position:RecorderPosition|null;onPosition:(point:RecorderPosition)=>void;onChoose:(mode:RecordMode)=>void}) {
  const keyboard=useKeyboard();
  const [open,setOpen]=useState(false),[moving,setMoving]=useState(false),[hover,setHover]=useState<RecordMode|null>(null);
  const [view,setView]=useState({width:427,height:904}),[dragPosition,setDragPosition]=useState<RecorderPosition|null>(()=>readSlot("recorderPosition",null));
  const root=useRef<HTMLDivElement>(null),tapTimer=useRef<number|undefined>(undefined),lastTap=useRef<{at:number;x:number;y:number}|null>(null);
  const gesture=useRef<{x:number;y:number;moved:boolean;move:boolean;origin:RecorderPosition;next?:RecorderPosition}|null>(null);
  const clearTap=()=>{window.clearTimeout(tapTimer.current);tapTimer.current=undefined;};
  // The draggable circle must stay above the navigation, including its safe area.
  const clamp=(point:RecorderPosition)=>({x:Math.max(34,Math.min(view.width-34,point.x)),y:Math.max(100,Math.min(view.height-bottom-28,point.y))});
  const point=clamp(dragPosition??position??{x:view.width-48,y:view.height-bottom-28});
  useLayoutEffect(()=>{const element=root.current;if(!element)return;const resize=()=>setView({width:element.clientWidth,height:element.clientHeight});resize();const observer=new ResizeObserver(resize);observer.observe(element);return()=>observer.disconnect();},[]);
  useEffect(()=>()=>clearTap(),[]);
  const choose=(mode:RecordMode)=>{clearTap();lastTap.current=null;setOpen(false);setHover(null);setMoving(false);onChoose(mode);};
  const armMove=()=>{clearTap();lastTap.current=null;setOpen(false);setHover(null);setMoving(true);};
  const choices:[RecordMode,string,ReactNode][]=[["text","文字",<NotePencil size={19}/>],["image","图片",<ImageSquare size={19}/>],["photo","拍照",<Camera size={19}/>],["audio","录音",<Microphone size={19}/>]];
  const hit=(x:number,y:number):RecordMode|null=>{const scale=(root.current?.getBoundingClientRect().width??view.width)/view.width;const options=root.current?.querySelectorAll<HTMLButtonElement>("[data-record-mode]")??[];let nearest:RecordMode|null=null,distance=33*scale;options.forEach(el=>{const r=el.getBoundingClientRect(),d=Math.hypot(x-(r.left+r.width/2),y-(r.top+r.height/2));if(d<distance){nearest=el.dataset.recordMode as RecordMode;distance=d;}});return nearest;};
  const horizontal=point.x>view.width/2?-1:1,vertical=point.y>view.height/2?-1:1;
  return <div className={"floating-recorder "+(open?"open ":"")+(moving?"moving":"")} ref={root} style={{"--record-x":point.x+"px","--record-y":point.y+"px"} as CSSProperties}>
    {open&&<><button className="record-palette-backdrop" aria-label="关闭记录方式" onClick={()=>{clearTap();setOpen(false);setHover(null);}}/><div className="record-palette" aria-label="记录方式">{choices.map(([mode,label,icon],i)=>{const angle=i*Math.PI/6;return <button key={mode} data-record-mode={mode} style={{left:horizontal*Math.cos(angle)*92,top:vertical*Math.sin(angle)*92}} className={"record-mode "+mode+(hover===mode?" selected":"")} aria-label={mode==="image"?"上传图片记录":label+"记录"} onClick={()=>choose(mode)}>{icon}<span>{label}</span></button>;})}</div></>}
    {moving&&<span className="record-move-hint" role="status">拖动调整位置</span>}
    <div className="record-fab"><button className="record-fab-main" aria-label={moving?"移动记录按钮":"记录，轻点输入，拖动选择方式，双击移动"} aria-expanded={open} onDoubleClick={e=>{e.preventDefault();armMove();}} onKeyDown={e=>{if(e.key==="Escape"){clearTap();setOpen(false);setMoving(false);setHover(null);}else if(e.key==="F2"){e.preventDefault();armMove();}else if(moving&&e.key.startsWith("Arrow")){e.preventDefault();onPosition(clamp({x:point.x+(e.key==="ArrowLeft"?-12:e.key==="ArrowRight"?12:0),y:point.y+(e.key==="ArrowUp"?-12:e.key==="ArrowDown"?12:0)}));}else if(moving&&e.key==="Enter"){e.preventDefault();setMoving(false);}else if(e.key==="ArrowUp"){e.preventDefault();clearTap();keyboard.hide();setOpen(true);}}} onPointerDown={e=>{if(e.button!==0)return;keyboard.hide();e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);const second=lastTap.current&&Date.now()-lastTap.current.at<320&&Math.hypot(e.clientX-lastTap.current.x,e.clientY-lastTap.current.y)<22;clearTap();const move=moving||Boolean(second);if(move)armMove();else setOpen(true);gesture.current={x:e.clientX,y:e.clientY,moved:false,move,origin:point};}} onPointerMove={e=>{const current=gesture.current;if(!current)return;const distance=Math.hypot(e.clientX-current.x,e.clientY-current.y);if(distance>8)current.moved=true;if(current.move){const scale=(root.current?.getBoundingClientRect().width??view.width)/view.width;current.next=clamp({x:current.origin.x+(e.clientX-current.x)/scale,y:current.origin.y+(e.clientY-current.y)/scale});setDragPosition(current.next);}else setHover(hit(e.clientX,e.clientY));}} onPointerUp={e=>{const current=gesture.current;gesture.current=null;if(!current)return;if(current.move){if(current.moved){onPosition(current.next??current.origin);setDragPosition(null);setMoving(false);}return;}if(current.moved){lastTap.current=null;const target=hit(e.clientX,e.clientY);setOpen(false);setHover(null);if(target)choose(target);}else{lastTap.current={at:Date.now(),x:e.clientX,y:e.clientY};tapTimer.current=window.setTimeout(()=>choose("text"),320);}}} onPointerCancel={()=>{gesture.current=null;clearTap();setDragPosition(null);setMoving(false);setOpen(false);setHover(null);}} onClick={e=>{if(e.detail===0&&!moving)choose("text");}}><PenNib size={30} weight="duotone" aria-hidden="true"/></button></div>
  </div>;
}
const CATEGORY_ICONS = [
  {key:"folder",label:"文件夹",Icon:FolderSimple},{key:"briefcase",label:"公文包",Icon:Briefcase},
  {key:"team",label:"团队",Icon:UsersThree},{key:"palette",label:"画笔",Icon:Palette},
  {key:"code",label:"代码",Icon:Code},{key:"calendar",label:"日历",Icon:CalendarBlank},
  {key:"book",label:"书本",Icon:BookOpen},{key:"idea",label:"灵感",Icon:Lightbulb},
  {key:"chart",label:"图表",Icon:ChartBar},{key:"chat",label:"消息",Icon:ChatCircle},
  {key:"camera",label:"相机",Icon:Camera},{key:"globe",label:"地球",Icon:Globe},
  {key:"house",label:"房屋",Icon:House},{key:"tools",label:"工具",Icon:Wrench},
  {key:"flag",label:"旗帜",Icon:Flag},{key:"heart",label:"爱心",Icon:Heart},
] as const;
type CategoryIconKey = typeof CATEGORY_ICONS[number]["key"];
type WorkCategory = {id:string;name:string;icon:CategoryIconKey;color:string};
const CATEGORY_COLORS = [{name:"湖蓝",value:"#4278cc"},{name:"鸢尾",value:"#8470bd"},{name:"琥珀",value:"#b77c36"},{name:"青绿",value:"#298778"},{name:"珊瑚",value:"#c46d71"},{name:"石墨",value:"#647a90"}];
const INITIAL_CATEGORIES:WorkCategory[] = [
  {id:"documents",name:"资料",icon:"folder",color:"#4278cc"},
  {id:"teamwork",name:"协作",icon:"team",color:"#8470bd"},
  {id:"design",name:"设计",icon:"palette",color:"#b77c36"},
  {id:"other",name:"其他",icon:"briefcase",color:"#298778"},
  {id:"uncategorized",name:"未分类",icon:"folder",color:"#647a90"},
];
function CategoryGlyph({category,size=19}:{category:WorkCategory;size?:number}) {
  const Icon=CATEGORY_ICONS.find(option=>option.key===category.icon)?.Icon??FolderSimple;
  return <Icon size={size} weight="duotone" aria-hidden="true"/>;
}
type RecordClassification = {name:string;control:ReactNode;picker:ReactNode;saved:()=>void};
function RecordCategoryControl({open,work,defaultName,hasDraft,disabled,categories,onResume,children}:{
  open:boolean;work?:Work;defaultName:string;hasDraft:boolean;disabled:boolean;categories:WorkCategory[];onResume:()=>void;children:(selection:RecordClassification)=>ReactNode;
}) {
  const keyboard=useKeyboard();
  const [selection,setSelection]=useState<{id:string;manual:boolean}|null>(()=>readSlot("draftCategory",null));
  const [choosing,setChoosing]=useState(false);
  useEffect(()=>{void persistSlot("draftCategory",selection);},[selection]);
  const wasOpen=useRef(false);
  const fallback=categories.find(category=>category.id==="uncategorized")!;
  const contextCategory=categories.find(category=>category.name===defaultName)??fallback;
  // A saved draft owns its category; an empty, untouched composer follows its entry point.
  useLayoutEffect(()=>{
    const entering=open&&!wasOpen.current;wasOpen.current=open;
    if(!open){if(choosing)setChoosing(false);return;}
    if(entering&&!work&&!hasDraft&&!selection?.manual)setSelection({id:contextCategory.id,manual:false});
  },[open,work,hasDraft,contextCategory.id,selection?.manual,choosing]);
  const selected=work?categories.find(category=>category.name===work.tag)??fallback:categories.find(category=>category.id===selection?.id)??contextCategory;
  const closePicker=()=>{setChoosing(false);onResume();};
  const label=<><small>分类</small><CategoryGlyph category={selected} size={16}/><span>{selected.name}</span>{!work&&(choosing?<CaretUp size={11}/>:<CaretDown size={11}/>)}</>;
  const control=work?<span className="composer-category inherited" style={{"--category-color":selected.color} as CSSProperties} aria-label={"沿用主任务分类："+selected.name} title={"沿用主任务分类："+selected.name}>{label}</span>:<button className="composer-category" style={{"--category-color":selected.color} as CSSProperties} aria-label={"选择分类，当前"+selected.name} title={selected.name} aria-expanded={choosing} aria-controls="record-category-picker" disabled={disabled} onClick={()=>{keyboard.hide();if(choosing)closePicker();else setChoosing(true);}}>{label}</button>;
  const picker=choosing&&!work?<section className="composer-category-picker" id="record-category-picker" aria-label="任务分类选项" onKeyDown={event=>{if(event.key==="Escape"){event.stopPropagation();closePicker();}}}><div className="composer-category-picker-heading"><span>任务分类</span><button aria-label="收起分类选择" onClick={closePicker}><X size={15}/></button></div><div className="composer-category-viewport" style={{height:Math.min(168,Math.ceil(categories.length/2)*48+8)}}><MobileScroll className="composer-category-scroll"><div className="composer-category-grid">{categories.map(category=><button key={category.id} aria-label={"使用分类 "+category.name} aria-pressed={selected.id===category.id} style={{"--category-color":category.color} as CSSProperties} onClick={()=>{setSelection({id:category.id,manual:true});closePicker();}}><CategoryGlyph category={category} size={18}/><span>{category.name}</span>{selected.id===category.id&&<Check size={14} weight="bold"/>}</button>)}</div></MobileScroll></div></section>:null;
  return <>{children({name:selected.name,control,picker,saved:()=>{if(!work)setSelection(null);setChoosing(false);}})}</>;
}
type CategoryTools = {categories:WorkCategory[];isOpen:boolean;manage:()=>void;assign:(id:string)=>void;merge:(values:unknown)=>void;restore:(values:WorkCategory[])=>void};
function CategoryWorkspace({items,onRename,onAssign,onNotify,children}:{items:Work[];onRename:(before:string,after:string)=>void;onAssign:(id:string,name:string)=>void;onNotify:(text:string)=>void;children:(tools:CategoryTools)=>ReactNode}) {
  const keyboard=useKeyboard();
  const categoryPanelRef=useRef<HTMLDivElement>(null);
  const [definitions,setDefinitions]=useState<WorkCategory[]>(()=>readSlot("categories", INITIAL_CATEGORIES));
  useEffect(()=>{void persistSlot("categories",definitions);},[definitions]);
  const [panel,setPanel]=useState<"manage"|"edit"|"assign"|null>(null);
  const [target,setTarget]=useState<string|null>(null);
  useLayoutEffect(()=>{const screen=categoryPanelRef.current?.closest<HTMLElement>(".device-screen");if(screen)screen.scrollTop=0;},[panel]);
  const [editing,setEditing]=useState<WorkCategory|null>(null);
  const [name,setName]=useState("");
  const [icon,setIcon]=useState<CategoryIconKey>("folder");
  const [color,setColor]=useState(CATEGORY_COLORS[0].value);
  // Old backups can contain arbitrary category names. Keep them editable too.
  const categories=[...definitions];
  items.forEach(work=>{if(!categories.some(category=>category.name===work.tag))categories.push({id:"legacy-"+encodeURIComponent(work.tag),name:work.tag,icon:"folder",color:"#647a90"});});
  const selectedWork=items.find(work=>work.id===target);
  const cleanName=name.trim();
  const duplicate=categories.some(category=>category.id!==editing?.id&&category.name.toLocaleLowerCase()===cleanName.toLocaleLowerCase());
  const close=()=>{keyboard.hide();setPanel(null);};
  const manage=()=>{keyboard.hide();setTarget(null);setPanel("manage");};
  const edit=(category?:WorkCategory)=>{keyboard.hide();setEditing(category??null);setName(category?.name??"");setIcon(category?.icon??"folder");setColor(category?.color??CATEGORY_COLORS[definitions.length%CATEGORY_COLORS.length].value);setPanel("edit");};
  const save=()=>{
    if(!cleanName||duplicate)return;
    const next:WorkCategory={id:editing?.id??mkId(),name:editing?.id==="uncategorized"?"未分类":cleanName,icon,color};
    setDefinitions(categories.some(category=>category.id===next.id)?categories.map(category=>category.id===next.id?next:category):[...categories,next]);
    if(editing&&editing.name!==next.name)onRename(editing.name,next.name);
    keyboard.hide();setPanel(target?"assign":"manage");onNotify(editing?"分类已更新":"分类已创建");
  };
  const merge=(values:unknown)=>{
    if(!Array.isArray(values))return;
    const next=[...categories];
    values.forEach(value=>{
      if(!value||typeof value.name!=="string"||!value.name.trim()||value.name.length>24||!CATEGORY_ICONS.some(option=>option.key===value.icon)||typeof value.color!=="string"||!/^#[a-f0-9]{6}$/i.test(value.color))return;
      const existing=next.findIndex(category=>category.name===value.name);
      const category:WorkCategory={id:existing>=0?next[existing].id:mkId(),name:value.name,icon:value.icon,color:value.color};
      if(existing>=0)next[existing]=category;else next.push(category);
    });
    setDefinitions(next);
  };
  const preview:WorkCategory={id:editing?.id??"preview",name:cleanName||"新分类",icon,color};
  const activeItems=items.filter(work=>!work.deleted&&!work.cancelled);
  const defaultCategory=categories.find(category=>category.id==="uncategorized");
  const renderCategory=(category:WorkCategory,compact=false)=>{
    const works=activeItems.filter(work=>work.tag===category.name);
    const pending=works.filter(work=>work.status!=="done").length;
    const selected=panel==="assign"&&selectedWork?.tag===category.name;
    return <button key={category.id} className={compact?"category-default-row":"category-directory-card"} style={{"--category-color":category.color} as CSSProperties} aria-label={panel==="assign"?"移到"+category.name:"编辑分类 "+category.name} aria-pressed={panel==="assign"?selected:undefined} title={category.name} onClick={()=>{if(panel==="assign"&&target){onAssign(target,category.name);close();}else edit(category);}}>
      <span className="category-directory-icon"><CategoryGlyph category={category} size={compact?21:27}/></span>
      <span className="category-directory-name">{category.name}{compact&&<small>默认归属</small>}</span>
      <span className="category-directory-count">{!compact&&<span><b>{pending}</b> 待办</span>}<small>{works.length} 项</small></span>
      <span className={"category-directory-action"+(selected?" selected":"")}>{selected?<Check size={14} weight="bold"/>:panel==="assign"?<Circle size={17}/>:<PencilSimple size={compact?15:14}/>}</span>
    </button>;
  };
  return <>{children({categories,isOpen:panel!==null,manage,assign:id=>{keyboard.hide();setTarget(id);setPanel("assign");},merge,restore:setDefinitions})}
    <BottomSheet open={panel!==null} onOpenChange={open=>{if(!open)close();}} title={panel==="edit"?(editing?"编辑分类":"新建分类"):panel==="assign"?"移动到分类":"我的分类"} description={panel==="assign"?selectedWork?.title:undefined} snap={panel==="edit"?.8:.74}>
      <IconButton label="关闭分类面板" className="sheet-close" onClick={close}><X size={21}/></IconButton>
      <div className={"category-sheet-viewport category-panel-"+panel} ref={categoryPanelRef} onFocusCapture={()=>{const screen=categoryPanelRef.current?.closest<HTMLElement>(".device-screen");if(screen){screen.scrollTop=0;requestAnimationFrame(()=>{screen.scrollTop=0;});}}}><MobileScroll key={panel+(editing?.id??"")} className="category-sheet-scroll"><div className="category-sheet-body">
        {panel==="edit"?<>
          <div className="category-editor-identity" style={{"--category-color":color} as CSSProperties}>
            <span className="category-preview-icon"><CategoryGlyph category={preview} size={32}/></span>
            <label className="category-name-field"><span>分类名称<small>{name.length}/24</small></span><KeyboardInput aria-label="分类名称" placeholder="给分类起个名字" maxLength={24} value={name} readOnly={editing?.id==="uncategorized"} onChange={event=>setName(event.target.value)} onKeyDown={event=>{if(event.key==="Enter"){event.preventDefault();keyboard.hide();}}}/></label>
          </div>
          {duplicate&&<p className="category-validation" role="alert">这个名称已经存在，请换一个。</p>}
          <div className="category-field-heading"><span>图标</span><small>{CATEGORY_ICONS.find(option=>option.key===icon)?.label}</small></div>
          <div className="category-icon-grid" role="group" aria-label="分类图标">{CATEGORY_ICONS.map(option=><button key={option.key} aria-label={option.label+"图标"} aria-pressed={icon===option.key} style={{"--category-color":color} as CSSProperties} onClick={()=>{keyboard.hide();setIcon(option.key);}}><option.Icon size={25} weight="duotone"/><span>{option.label}</span>{icon===option.key&&<i className="category-icon-selected"><Check size={9} weight="bold"/></i>}</button>)}</div>
          <div className="category-field-heading"><span>颜色</span><small>{CATEGORY_COLORS.find(option=>option.value===color)?.name??"自定义"}</small></div>
          <div className="category-color-options" role="group" aria-label="分类颜色">{CATEGORY_COLORS.map(option=><button key={option.value} aria-label={option.name} aria-pressed={color===option.value} style={{"--category-color":option.value} as CSSProperties} onClick={()=>{keyboard.hide();setColor(option.value);}}><span>{color===option.value&&<Check size={16} weight="bold"/>}</span></button>)}</div>
        </>:<div className="category-directory">
          <div className="category-directory-overview"><span>{categories.length} 个分类</span><span>{activeItems.length} 个事项</span></div>
          <div className="category-directory-grid">{categories.filter(category=>category.id!=="uncategorized").map(category=>renderCategory(category))}<button className="category-create-tile" onClick={()=>edit()}><span><Plus size={23}/></span><strong>新建分类</strong></button></div>
          {defaultCategory&&renderCategory(defaultCategory,true)}
        </div>}
      </div></MobileScroll></div>
      {panel==="edit"&&<div className="category-sheet-footer"><button className="category-back-button" onClick={()=>{keyboard.hide();setPanel(target?"assign":"manage");}}><ArrowLeft size={17}/>返回</button><button className="primary-button" disabled={!cleanName||duplicate} onClick={save}>保存分类<Check size={17} weight="bold"/></button></div>}
    </BottomSheet>
  </>;
}
function TodoListPage({items,categories,visible,blocked,nav,onManage,onAssign,onCategory,onSearch,onDetail,onToggle,onToggleChild,onRecord,onAddChild,onStatus}: {
  items:Work[];categories:WorkCategory[];visible:boolean;blocked:boolean;nav:ReactNode;onManage:()=>void;onAssign:(id:string)=>void;onCategory:(name:string)=>void;onSearch:()=>void;onDetail:(id:string)=>void;
  onToggle:(work:Work)=>void;onToggleChild:(work:Work,child:Subtask)=>void;
  onRecord:(work:Work,child?:Subtask)=>void;onAddChild:(work:Work)=>void;
  onStatus:(work:Work,anchor:HTMLButtonElement,childId?:string)=>void;
}) {
  const [view,setView]=useState<"category"|"time">("time");
  const [category,setCategory]=useState("all");
  const [includeHistory,setIncludeHistory]=useState(false);
  const [collapsed,setCollapsed]=useState<string[]>([]);
  const [expandedGroups,setExpandedGroups]=useState<string[]>([]);
  const [limit,setLimit]=useState(14);
  const [openedTasks,setOpenedTasks]=useState<string[]>([]);
  // Preserve reading order while checking off tasks. Refresh applies new timestamps explicitly.
  const [anchors,setAnchors]=useState(()=>Object.fromEntries(items.map(work=>[work.id,lastEntry(work).at])));
  const screenRef=useRef<HTMLElement>(null);
  const viewScroll=useRef({category:0,time:0});
  useEffect(()=>{
    const added=items.filter(work=>!anchors[work.id]);
    if(!added.length)return;
    setAnchors(current=>({...current,...Object.fromEntries(added.map(work=>[work.id,lastEntry(work).at]))}));
    setCategory("all");onCategory("未分类");setCollapsed([]);setLimit(14);
  },[items,anchors]);
  useLayoutEffect(()=>{screenRef.current?.querySelector<HTMLElement>(".mobile-scroll")?.scrollTo({top:viewScroll.current[view]});},[view]);
  const live=items.filter(work=>!work.deleted&&!work.cancelled);
  const pending=live.filter(work=>work.status!=="done").length;
  const todayDone=live.filter(completedToday).length;
  const scope=live.filter(work=>includeHistory||work.status!=="done"||completedToday(work)).sort((a,b)=>(anchors[b.id]??lastEntry(b).at).localeCompare(anchors[a.id]??lastEntry(a).at));
  const selectedCategory=categories.find(option=>option.id===category);
  const selected=scope.filter(work=>category==="all"||work.tag===selectedCategory?.name);
  const groupMap=new Map<string,Work[]>();
  (view==="time"?selected.slice(0,limit):selected).forEach(work=>{
    const key=view==="time"?(anchors[work.id]??lastEntry(work).at).slice(0,10):categories.find(option=>option.name===work.tag)!.id;
    const group=groupMap.get(key);if(group)group.push(work);else groupMap.set(key,[work]);
  });
  const needsRefresh=selected.some(work=>anchors[work.id]!==lastEntry(work).at);
  const resetScroll=()=>{screenRef.current?.querySelector<HTMLElement>(".mobile-scroll")?.scrollTo({top:0});viewScroll.current={category:0,time:0};};
  const chooseCategory=(id:string)=>{setCategory(id);onCategory(categories.find(option=>option.id===id)?.name??"未分类");setLimit(14);resetScroll();};
  const changeView=(next:typeof view)=>{if(next===view)return;viewScroll.current[view]=screenRef.current?.querySelector<HTMLElement>(".mobile-scroll")?.scrollTop??0;setView(next);};
  const renderTask=(work:Work)=>{
    const children=work.subtasks??[],completed=children.filter(child=>child.status==="done").length,open=openedTasks.includes(work.id);
    const cat=categories.find(option=>option.name===work.tag)!;
    const at=lastEntry(work).at;
    return <article key={work.id} className={"todo-task "+work.status+(open&&children.length?" with-children":"")} aria-label={"清单事项 "+work.title}>
      <div className="todo-task-top"><button className="todo-check" role="checkbox" aria-checked={work.status==="done"} aria-label={(work.status==="done"?"取消完成 ":"完成 ")+work.title} title={LABEL[work.status]} onClick={()=>onToggle(work)}><span className={"work-checkbox "+work.status+(work.status==="done"?" checked":"")}>{work.status==="done"&&<Check size={15} weight="bold"/>}</span></button><button className="todo-task-title" aria-label={"查看任务 "+work.title} onClick={()=>onDetail(work.id)}><span>{work.title}</span></button><div className="todo-task-actions"><button className="todo-record-action" aria-label={"记进展 "+work.title} title="记进展" onClick={()=>onRecord(work)}><NotePencil size={19}/></button><button className="todo-more" aria-label={"更改状态 "+work.title} onClick={event=>onStatus(work,event.currentTarget)}><DotsThreeVertical size={18}/></button></div></div>
      <div className="todo-task-meta"><button className="todo-category-label" style={{"--category-color":cat.color} as CSSProperties} aria-label={"修改分类 "+work.title+"，当前"+cat.name} onClick={()=>onAssign(work.id)}><CategoryGlyph category={cat} size={14}/><span>{cat.name}</span></button>
      {!!children.length?<button className="todo-child-summary" aria-label={(open?"收起":"展开")+work.title+"的子任务"} aria-expanded={open} onClick={()=>setOpenedTasks(current=>open?current.filter(id=>id!==work.id):[...current,work.id])}><span className="todo-mini-progress" aria-hidden="true"><span style={{width:completed/children.length*100+"%"}}/></span><span>{completed}<em> / {children.length}</em></span><span>子任务</span>{open?<CaretUp size={12}/>:<CaretDown size={12}/>}</button>:<button className="todo-add-first" aria-label={"为"+work.title+"添加子任务"} onClick={()=>onAddChild(work)}><Plus size={12}/>子任务</button>}<time dateTime={at} title={"更新于 "+timeLabel(at)}>{at.startsWith(TODAY)?at.slice(11,16):shortDate(at.slice(0,10))}</time></div>
      {open&&!!children.length&&<div className="todo-children">{children.map(child=><div key={child.id} className={"todo-child "+child.status}><button className="todo-check" role="checkbox" aria-checked={child.status==="done"} aria-label={(child.status==="done"?"取消完成子任务 ":"完成子任务 ")+child.title} onClick={()=>onToggleChild(work,child)}><span className={"work-checkbox "+child.status+(child.status==="done"?" checked":"")}>{child.status==="done"&&<Check size={12} weight="bold"/>}</span></button><span className="todo-child-title">{child.title}</span><button className="todo-child-note" aria-label={"记子任务进展 "+child.title} onClick={()=>onRecord(work,child)}><NotePencil size={16}/></button><button className="todo-child-more" aria-label={"更改子任务状态 "+child.title} onClick={event=>onStatus(work,event.currentTarget,child.id)}><DotsThreeVertical size={15}/></button></div>)}<button className="todo-add-child" aria-label={"为"+work.title+"添加子任务"} onClick={()=>onAddChild(work)}><Plus size={13}/>子任务</button></div>}
    </article>;
  };
  return <section ref={screenRef} className="scene todo-scene" hidden={!visible} inert={!visible||blocked} aria-label="待办清单">
    <header className="todo-header">
      <div className="todo-overview"><div className="todo-overview-metrics"><h1><strong>{pending}</strong><span>待办事项</span></h1><div className="todo-today"><strong>{todayDone}</strong><span><CheckCircle size={12} weight="fill"/>今日完成</span></div></div><div className="todo-overview-right"><time>{shortDate(TODAY)} <span>周{"日一二三四五六"[dateObj(TODAY).getDay()]}</span></time><div><IconButton label="管理分类" onClick={onManage}><SquaresFour size={21}/></IconButton><IconButton label="搜索清单" onClick={onSearch}><MagnifyingGlass size={22}/></IconButton></div></div></div>
      <div className="todo-view-switch" role="group" aria-label="清单视图"><button aria-pressed={view==="category"} onClick={()=>changeView("category")}><SquaresFour size={17} weight={view==="category"?"duotone":"regular"}/>分类</button><button aria-pressed={view==="time"} onClick={()=>changeView("time")}><ClockCounterClockwise size={17}/>时间线</button></div>
      <Carousel className="todo-category-rail" contentClassName="todo-categories" ariaLabel="筛选清单分类"><button aria-pressed={category==="all"} onClick={()=>chooseCategory("all")}>全部<span>{scope.length}</span></button>{categories.map(cat=><button key={cat.id} aria-pressed={category===cat.id} onClick={()=>chooseCategory(cat.id)} style={{"--category-color":cat.color} as CSSProperties}><CategoryGlyph category={cat} size={15}/><strong>{cat.name}</strong><span>{scope.filter(work=>work.tag===cat.name).length}</span></button>)}<button className="todo-new-category" aria-label="设置我的分类" onClick={onManage}><PencilSimple size={15}/></button></Carousel>
    </header>
    <MobileScroll className="todo-scroll"><main className={"todo-content view-"+view}>
      <div className="todo-list-tools">{needsRefresh?<button className="todo-refresh" onClick={()=>{setAnchors(Object.fromEntries(items.map(work=>[work.id,lastEntry(work).at])));resetScroll();}}><ArrowCounterClockwise size={13}/>有更新 · 重新排列</button>:<span>{view==="time"?"按更新时间":<button className="todo-manage-link" onClick={onManage}>管理分类<PencilSimple size={12}/></button>}<small>{selected.length} 项</small></span>}<button aria-label="包含历史已完成事项" aria-pressed={includeHistory} onClick={()=>{setIncludeHistory(value=>!value);setExpandedGroups([]);setLimit(14);resetScroll();}}><ClockCounterClockwise size={15}/>{includeHistory?"收起历史":"历史"}</button></div>
      {[...groupMap].map(([key,works])=>{
        const cat=categories.find(option=>option.id===key),foldKey=view+"-"+key,folded=collapsed.includes(foldKey),expanded=expandedGroups.includes(key);
        const totalWorks=view==="time"?selected.filter(work=>(anchors[work.id]??lastEntry(work).at).startsWith(key)):works;
        const done=totalWorks.filter(work=>work.status==="done").length;
        const shown=view==="category"&&!expanded?works.slice(0,4):works;
        const label=view==="time"?dateLabel(key):cat!.name;
        return <section key={key} className={"todo-group "+(view==="time"?"todo-day":"todo-category-group")+(folded?" folded":"")} style={{"--category-color":cat?.color??"#4278cc"} as CSSProperties} aria-label={label+"清单"}>
          <button className="todo-group-heading" aria-expanded={!folded} aria-label={(folded?"展开":"收起")+label+"清单"} onClick={()=>setCollapsed(current=>folded?current.filter(value=>value!==foldKey):[...current,foldKey])}>{view==="category"?<span className="todo-group-symbol"><CategoryGlyph category={cat!} size={21}/></span>:<span className={"todo-date-marker"+(key===TODAY?" current":"")} aria-hidden="true"/>}<h2>{label}</h2>{view==="time"&&<time>{key>=addDays(TODAY,-1)?shortDate(key)+" · ":""}周{"日一二三四五六"[dateObj(key).getDay()]}</time>}<span className="todo-group-count">{works.length<totalWorks.length?works.length+" / ":""}{totalWorks.length} 项{done>0&&<small> · 完成 {done}</small>}</span>{folded?<CaretDown size={14}/>:<CaretUp size={14}/>}</button>
          {folded?<div className="todo-folded-preview"><div><span>{totalWorks.length-done} 待完成</span><span>{done} 已完成</span></div><p>{works.slice(0,2).map(work=>work.title).join(" · ")}</p></div>:<div className="todo-group-list">{shown.map(renderTask)}{view==="category"&&works.length>4&&<button className="todo-show-more" onClick={()=>setExpandedGroups(current=>expanded?current.filter(value=>value!==key):[...current,key])}>{expanded?"收起清单":"展开其余 "+(works.length-4)+" 项"}{expanded?<CaretUp size={13}/>:<CaretDown size={13}/>}</button>}</div>}
        </section>;
      })}
      {view==="time"&&selected.length>limit&&<button className="todo-load-earlier" onClick={()=>setLimit(current=>current+20)}>查看更早的 {Math.min(20,selected.length-limit)} 项<CaretDown size={14}/></button>}
      {!groupMap.size&&<div className="todo-empty"><ListChecks size={34} weight="light"/><p>{category==="all"?"当前清单已完成":selectedCategory?.name+"暂无事项"}</p><button onClick={()=>{if(category!=="all")chooseCategory("all");else{setIncludeHistory(true);resetScroll();}}}>{category==="all"?"查看历史事项":"查看全部清单"}<CaretRight size={14}/></button></div>}
    </main></MobileScroll>{nav}
  </section>;
}
export default function WorkApp() {
  const keyboard = useKeyboard();
  const { bottomInset, isKeyboardVisible } = useKeyboardInsets();
  const [items, setItems] = useState<Work[]>(()=>readSlot("items", []));
  const [pages, setPages] = useState<Page[]>([{ name: "home" }]);
  const page = pages[pages.length - 1];
  const [filter, setFilter] = useState<Filter>(EMPTY_FILTER);
  const [pendingFilter, setPendingFilter] = useState<Filter>(EMPTY_FILTER);
  const [sort, setSort] = useState("recent");
  const [query, setQuery] = useState("");
  const [sheet, setSheet] = useState<Sheet>("none");
  const [sheetReturn, setSheetReturn] = useState<Sheet>("none");
  const [fieldTarget, setFieldTarget] = useState<"draft" | "progress" | "item" | "batch" | "timeline">("draft");
  const [draft, setDraft] = useState<Draft>(newDraft);
  const [savedNewDraft, setSavedNewDraft] = useState<Draft>(newDraft);
  const editDrafts = useRef<Record<string, Draft>>({});
  const progressDrafts = useRef<Record<string, Draft>>({});
  const [progress, setProgress] = useState<Draft>(newDraft);
  const [progressId, setProgressId] = useState<string | null>(null);
  const [editEntryId, setEditEntryId] = useState<string | null>(null);
  const [deleteIds, setDeleteIds] = useState<string[]>([]);
  const [selection, setSelection] = useState<string[] | null>(null);
  const [descriptionOpen, setDescriptionOpen] = useState(false);
  const [historyLimit, setHistoryLimit] = useState(10);
  const [timelineMode, setTimelineMode] = useState<"day" | "week" | "month">("week");
  const [timelineDate, setTimelineDate] = useState(TODAY);
  const [expandedDays, setExpandedDays] = useState<string[]>([]);
  const [panelView, setPanelView] = useState<"done"|"active"|"events">("events");
  const [activityFilter,setActivityFilter] = useState<ActivityType|"all">("all");
  const [focusHour,setFocusHour] = useState<number|null>(null);
  const [focusDay, setFocusDay] = useState<string|null>(null);
  const [outcomeLimit,setOutcomeLimit] = useState(8);
  const [quickTarget, setQuickTarget] = useState<string|null>(null);
  const [quickText, setQuickText] = useState("");
  const [quickStatus, setQuickStatus] = useState<Status>("todo");
  const [quickExpanded, setQuickExpanded] = useState(false);
  const [quickChildId,setQuickChildId] = useState<string|null>(null);
  const [quickIntent,setQuickIntent] = useState<"record"|"child">("record");
  const [recordMode,setRecordMode] = useState<RecordMode>("text");
  const [captureAssets,setCaptureAssets] = useState<Attachment[]>([]);
  const [audioRecording,setAudioRecording] = useState(false);
  const audioCaptureRef=useRef<AudioCaptureHandle>(null),closingRecord=useRef(false);
  const [filesReading,setFilesReading] = useState(false);
  const [recorderPosition,setRecorderPosition] = useState<RecorderPosition|null>(()=>readSlot("recorderPosition",null));
  const [viewedPhoto,setViewedPhoto] = useState<PhotoGallery|null>(null);
  const photoOrigin = useRef<HTMLButtonElement|null>(null);
  const quickOrigin=useRef<HTMLElement|null>(null);
  const captureDrafts = useRef<Record<string,Attachment[]>>(readSlot("captureDrafts",{}));
  const captureSession = useRef(0);
  const imageRef = useRef<HTMLInputElement>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  const [openWorkDays,setOpenWorkDays] = useState<string[]>([TODAY]);
  const [groupAnchors,setGroupAnchors] = useState<Record<string,string>>({});
  const [openedChildren,setOpenedChildren] = useState<string[]>([]);
  const [detailScope,setDetailScope] = useState<RecordScope>({kind:"all"});
  const [toastPaused,setToastPaused] = useState(false);
  const quickDrafts = useRef<Record<string,string>>(readSlot("quickDrafts",{}));
  const [statusMenu,setStatusMenu] = useState<{id:string;childId?:string;top:number;left:number}|null>(null);
  const statusAnchor = useRef<HTMLButtonElement|null>(null);
  const [expandedCard,setExpandedCard] = useState<string|null>(null);
  const [cardOrder,setCardOrder] = useState<string[]|null>(null);
  const [toast, setToast] = useState<{ text: string; before?: Work[]; beforeCategories?:WorkCategory[] } | null>(null);
  const [restoreMessage, setRestoreMessage] = useState("");
  const importRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollPositions = useRef<Record<string, number>>({});
  const editing = page.mode === "edit";
  const active = items.find(i => i.id === page.id);
  const progressWork = items.find(i => i.id === progressId);
  const quickWork = items.find(i => i.id === quickTarget);
  const statusWork = items.find(w=>w.id===statusMenu?.id);
  const statusChild = statusWork?.subtasks?.find(c=>c.id===statusMenu?.childId);
  const quickChild = quickWork?.subtasks?.find(c=>c.id===quickChildId);
  const quickKey = quickIntent==="child" ? (quickTarget??"")+":new-child" : quickChildId ?? quickTarget ?? "new";
  const live = items.filter(i => !i.deleted && !i.cancelled);
  const closePhoto = () => {keyboard.hide();setViewedPhoto(null);requestAnimationFrame(()=>photoOrigin.current?.focus({preventScroll:true}));};
  const openPhotos = (photos:Attachment[],index:number,trigger:HTMLButtonElement,entry:Entry,title:string) => {keyboard.hide();photoOrigin.current=trigger;setViewedPhoto({photos,index,title,at:entry.at});};
  const pageKey = page.name + (page.id ?? "") + (page.mode ?? "");
  useLayoutEffect(() => {
    const screen = rootRef.current?.closest<HTMLElement>(".device-screen");
    if (screen) screen.scrollTop = 0;
  }, [pageKey,isKeyboardVisible]);
  useEffect(() => { setCardOrder(null); setGroupAnchors({}); setExpandedCard(null); setStatusMenu(null); }, [pageKey,sort,filter]);
  const [,refreshDay]=useState(TODAY);
  useEffect(()=>{const update=()=>{const day=localDay();if(TODAY!==day){TODAY=day;refreshDay(day);}};const timer=setInterval(update,30000);document.addEventListener("visibilitychange",update);return()=>{clearInterval(timer);document.removeEventListener("visibilitychange",update);};},[]);
  useEffect(()=>{void persistSlot("items",items);},[items]);
  useEffect(()=>{void persistSlot("recorderPosition",recorderPosition);},[recorderPosition]);
  useEffect(()=>{if(quickExpanded){quickDrafts.current[quickKey]=quickText;captureDrafts.current[quickKey]=captureAssets;}void persistSlot("quickDrafts",{...quickDrafts.current});void persistSlot("captureDrafts",{...captureDrafts.current});},[quickText,captureAssets,quickExpanded,quickKey]);
  useAndroidBack(()=>{
    if(viewedPhoto){closePhoto();return true;}
    if(quickExpanded){void closeRecord();return true;}
    if(statusMenu){setStatusMenu(null);return true;}
    if(sheet!=="none"){closeSheet();return true;}
    if(selection){setSelection(null);return true;}
    if(pages.length>1){back();return true;}
    if(page.name!=="home"){rootNav("home");return true;}
    return false;
  });
  useEffect(() => {
    const key = pageKey;
    const scroller = rootRef.current?.querySelector<HTMLElement>(".scene:not([hidden]) .mobile-scroll");
    if (scroller) scroller.scrollTop = scrollPositions.current[key] ?? 0;
  }, [pageKey]);
  useEffect(()=>{if(statusMenu)rootRef.current?.querySelector<HTMLButtonElement>(".card-status-menu [aria-checked=\"true\"]")?.focus({preventScroll:true});},[statusMenu?.id]);
  useEffect(() => { if (!toast || toastPaused) return; const t = window.setTimeout(() => setToast(null), toast.before?3000:1800); return () => clearTimeout(t); }, [toast,toastPaused]);
  useEffect(() => {
    if (page.name !== "editor" || page.mode === "progress") return;
    if (editing && page.id) editDrafts.current[page.id] = draft;
    else setSavedNewDraft(draft);
  }, [draft, pageKey]);
  useEffect(() => { if (progressId && !editEntryId) progressDrafts.current[progressId] = progress; }, [progress, progressId, editEntryId]);
  const rememberScroll = () => {
    const el = rootRef.current?.querySelector<HTMLElement>(".scene:not([hidden]) .mobile-scroll");
    if (el) scrollPositions.current[pageKey] = el.scrollTop;
  };
  const push = (next: Page) => { setQuickExpanded(false);keyboard.hide(); rememberScroll(); setSheet("none"); setPages(p => [...p, next]); };
  const back = () => { setQuickExpanded(false);keyboard.hide(); rememberScroll(); setSheet("none"); setPages(p => p.length > 1 ? p.slice(0, -1) : [{ name: "home" }]); };
  const rootNav = (name: "home" | "todo" | "timeline") => {  setQuickExpanded(false); keyboard.hide(); rememberScroll(); setSheet("none"); setSelection(null); setPages([{ name }]); };
  const openSheet = (s: Sheet) => { keyboard.hide(); setSheet(s); };
  const closeSheet = () => { keyboard.hide(); setSheet("none"); };
  const notify = (text: string) => {setToastPaused(false);setToast({ text });};
  const commit = (next: Work[], text: string, beforeCategories?:WorkCategory[]) => { setToastPaused(false);setToast({ text, before: items, beforeCategories }); setItems(next); };
  const enterDetail = (id: string) => { setDescriptionOpen(false); setHistoryLimit(10);setDetailScope({kind:"all"});setOpenedChildren([]); push({ name: "detail", id }); };
  const nextEntryAt = () => localTimestamp();
  const changeState = (ids: string[], status: Status) => {
    const changed = items.filter(w=>ids.includes(w.id) && w.status !== status);
    if(!changed.length) { setStatusMenu(null);closeSheet();return; }
    if(page.name === "home" && !selection) {setCardOrder(filtered.map(w=>w.id));setGroupAnchors(Object.fromEntries(filtered.map(w=>[w.id,groupAnchors[w.id]??(sort==="created"?w.createdAt:lastEntry(w).at).slice(0,10)])));}
    const next = items.map(w => {if(!changed.some(c=>c.id===w.id))return w;const childChanges=status==="done"?(w.subtasks??[]).filter(c=>c.status!=="done").map(c=>({id:c.id,before:c.status})):undefined;const restore=w.status==="done"?sortedEntries(w).find(e=>e.kind==="done")?.childChanges:undefined;const subtasks=w.subtasks?.map(c=>status==="done"?{...c,status:"done" as Status}:restore?.some(x=>x.id===c.id)?{...c,status:restore.find(x=>x.id===c.id)!.before}:c);return { ...w, status, subtasks, entries: [...w.entries, { id: mkId(), at: nextEntryAt(), recordedAt:new Date().toISOString(), fromStatus:w.status, text: LABEL[w.status]+" → "+LABEL[status], kind: updateKind(w.status,status), status,childChanges }] };});
    const action=status === "done" ? "已完成" : status === "todo" ? "已设为未开始" : changed[0].status === "done" ? "已继续处理" : "已开始处理";
    const childCount=status==="done"?(changed[0].subtasks??[]).filter(c=>c.status!=="done").length:0;
    commit(next, changed.length>1 ? changed.length+" 个事项"+action : action+(childCount?"，含 "+childCount+" 个子任务":""));
    if(quickTarget && ids.includes(quickTarget))setQuickStatus(status);
    setSelection(null); setStatusMenu(null); closeSheet();
  };
  const openCardStatus = (w:Work,anchor:HTMLButtonElement,childId?:string) => {
    keyboard.hide();setQuickExpanded(false);statusAnchor.current=anchor;
    const root=rootRef.current!,bounds=root.getBoundingClientRect(),rect=anchor.getBoundingClientRect();const scale=bounds.width/root.offsetWidth;
    setStatusMenu({id:w.id,childId,left:Math.max(14,Math.min((rect.left-bounds.left)/scale,root.offsetWidth-166)),top:Math.max(76,Math.min((rect.bottom-bounds.top)/scale+3,root.offsetHeight-168))});
  };
  const closeCardStatus = () => {setStatusMenu(null);statusAnchor.current?.focus({preventScroll:true});};
  const removeItems = () => {
    commit(items.map(w => deleteIds.includes(w.id) ? { ...w, deleted: true } : w), "已移入回收站");
    setSelection(null); closeSheet();
    if (page.name === "detail") back();
  };
  const beginRecord = (work?:Work, child?:Subtask, intent:"record"|"child"="record", mode:RecordMode="text") => {
    captureSession.current++;setFilesReading(false);
    if(!quickExpanded)quickOrigin.current=document.activeElement as HTMLElement;
    if(quickExpanded){quickDrafts.current[quickKey]=quickText;captureDrafts.current[quickKey]=captureAssets;}
    keyboard.hide();setSheet("none");setStatusMenu(null);setExpandedCard(null);
    const key=intent==="child"?(work?.id??"")+":new-child":child?.id??work?.id??"new";
    setQuickTarget(work?.id??null);setQuickChildId(child?.id??null);setQuickIntent(intent);setRecordMode(mode);
    setQuickText(quickDrafts.current[key]??"");setCaptureAssets(captureDrafts.current[key]??[]);
    setQuickStatus(intent==="child"?"todo":child?.status??work?.status??"todo");setQuickExpanded(true);
    if(mode==="text")requestAnimationFrame(()=>rootRef.current?.querySelector<HTMLTextAreaElement>("#quick-record-input")?.focus());
  };
  const openNew = () => beginRecord();
  const openQuickProgress = (w:Work, child?:Subtask) => beginRecord(w,child);
  const closeRecord = async () => {
    if(closingRecord.current)return;
    closingRecord.current=true;keyboard.hide();
    const recording=await audioCaptureRef.current?.finish();
    const assets=recording&&!captureAssets.some(a=>a.id===recording.id)?[...captureAssets,recording]:captureAssets;
    captureSession.current++;setFilesReading(false);quickDrafts.current[quickKey]=quickText;captureDrafts.current[quickKey]=assets;setCaptureAssets(assets);setQuickExpanded(false);closingRecord.current=false;
    requestAnimationFrame(()=>quickOrigin.current?.isConnected&&quickOrigin.current.focus({preventScroll:true}));
  };
  const receiveImages = async (files:File[],source:"upload"|"camera") => {
    if(!files.length)return;
    const session=captureSession.current;setFilesReading(true);
    const results=await Promise.allSettled(files.map(file=>new Promise<Attachment>((resolve,reject)=>{
      if(!file.type.startsWith("image/")){reject(new Error("not-image"));return;}
      const reader=new FileReader();reader.onload=()=>{const src=String(reader.result),image=new Image();image.onload=()=>resolve({id:mkId(),kind:"photo",src,name:file.name,source,width:image.naturalWidth,height:image.naturalHeight});image.onerror=()=>reject(new Error("invalid-image"));image.src=src;};reader.onerror=()=>reject(reader.error);reader.readAsDataURL(file);
    })));
    if(session!==captureSession.current)return;
    setCaptureAssets(previous=>[...previous,...results.flatMap(result=>result.status==="fulfilled"?[result.value]:[])]);setFilesReading(false);
    if(results.some(result=>result.status==="rejected"))notify("有图片未能读取，请重新选择");
  };
  const pickImages = async (source:"camera"|"upload") => {
    keyboard.hide();
    if(!isAndroid()){(source==="camera"?photoRef:imageRef).current?.click();return;}
    setFilesReading(true);
    try {await flushStorage();const files=await chooseNativeImages(source);await receiveImages(files,source);}
    catch(error){if(!/cancel|取消/i.test(String(error)))notify("未能读取图片，请重新选择");}
    finally{setFilesReading(false);}
  };
  const changeChildState = (w:Work,child:Subtask,status:Status) => {
    setStatusMenu(null);if(child.status===status)return;
    const parentStatus=w.status==="done"&&status!=="done"?"doing":w.status;
    const entry:Entry={id:mkId(),at:nextEntryAt(),recordedAt:new Date().toISOString(),text:LABEL[child.status]+" → "+LABEL[status],kind:updateKind(w.status,parentStatus),status:parentStatus,fromStatus:w.status,subtaskId:child.id,childAction:"status",childFromStatus:child.status,childStatus:status};
    commit(items.map(item=>item.id===w.id?{...item,status:parentStatus,subtasks:item.subtasks?.map(c=>c.id===child.id?{...c,status}:c),entries:[...item.entries,entry]}:item),status==="done"?"子任务已完成":"子任务已"+(status==="doing"?"开始处理":"设为未开始"));
  };
  const saveQuick = (category:string,finish = false) => {
    if(audioRecording||filesReading||(!quickText.trim()&&!captureAssets.length))return false;
    const text=quickText.trim()||(captureAssets.some(a=>a.kind==="photo")?captureAssets.some(a=>a.source==="upload")?"图片记录":"拍照记录":"录音记录");
    const status:Status=finish?"done":quickStatus;
    const at=nextEntryAt();const target=items.find(w=>w.id===quickTarget);
    const base:Entry={id:mkId(),at,recordedAt:new Date().toISOString(),text,kind:"progress",status,attachments:captureAssets.length?captureAssets:undefined};
    if(target&&quickIntent==="child") {
      const child:Subtask={id:mkId(),title:text.split("\n")[0].slice(0,160),status,createdAt:at};
      const parentStatus=target.status==="done"&&status!=="done"?"doing":target.status;
      const entry:Entry={...base,status:parentStatus,fromStatus:target.status,kind:updateKind(target.status,parentStatus),subtaskId:child.id,childStatus:status,childAction:"created"};
      commit(items.map(w=>w.id===target.id?{...w,status:parentStatus,subtasks:[...(w.subtasks??[]),child],entries:[...w.entries,entry]}:w),"子任务已添加");
    } else if(target&&quickChildId) {
      const child=target.subtasks?.find(c=>c.id===quickChildId);if(!child)return false;
      const parentStatus=target.status==="done"&&status!=="done"?"doing":target.status;
      const entry:Entry={...base,status:parentStatus,fromStatus:target.status,kind:updateKind(target.status,parentStatus),subtaskId:child.id,childStatus:status,childFromStatus:child.status,childAction:child.status===status?"progress":"status"};
      commit(items.map(w=>w.id===target.id?{...w,status:parentStatus,subtasks:w.subtasks?.map(c=>c.id===child.id?{...c,status}:c),entries:[...w.entries,entry]}:w),"子任务进展已保存");
    } else if(target) {
      const childChanges=status==="done"&&target.status!=="done"?target.subtasks?.filter(c=>c.status!=="done").map(c=>({id:c.id,before:c.status})):undefined;
      const entry:Entry={...base,fromStatus:target.status,kind:updateKind(target.status,status),childChanges};
      const restore=target.status==="done"?sortedEntries(target).find(e=>e.kind==="done")?.childChanges:undefined;
      commit(items.map(w=>w.id===target.id?{...w,status,subtasks:w.subtasks?.map(c=>status==="done"?{...c,status:"done" as Status}:restore?.some(x=>x.id===c.id)?{...c,status:restore.find(x=>x.id===c.id)!.before}:c),entries:[...w.entries,entry]}:w),finish?"进展已保存，任务已完成":"记录已保存");
    } else {
      const entry:Entry={...base,kind:status==="done"?"done":"created"};
      const work:Work={id:mkId(),title:text.split("\n")[0].slice(0,160),description:quickText.trim().split("\n")[0].length<=160?quickText.trim().split("\n").slice(1).join("\n").trim():quickText.trim(),status,tag:category,createdAt:at,entries:status==="done"?[{...entry,id:mkId(),kind:"created",status:"todo",text:"建立工作记录",attachments:undefined},entry]:[entry]};
      commit([work,...items],"已保存到「"+category+"」");setFilter(EMPTY_FILTER);
    }
    setCardOrder(null);setGroupAnchors({});setOpenWorkDays(days=>days.includes(TODAY)?days:[TODAY,...days]);
    captureSession.current++;delete quickDrafts.current[quickKey];delete captureDrafts.current[quickKey];setQuickText("");setCaptureAssets([]);setQuickTarget(null);setQuickChildId(null);setQuickExpanded(false);keyboard.hide();
    if(page.name==="home"||page.name==="todo"&&!target){const scroller=rootRef.current?.querySelector<HTMLElement>(".scene:not([hidden]) .mobile-scroll");scroller?.scrollTo({top:0,behavior:"smooth"});}
    return true;
  };
  const openEdit = () => {
    if (!active) return;
    setDraft(editDrafts.current[active.id] ?? { text: active.description, title: active.title, date: active.createdAt.slice(0, 10), time: active.createdAt.slice(11, 16), status: active.status, tag: active.tag });
    push({ name: "editor", mode: "edit", id: active.id });
  };
  const openProgress = (w: Work) => openQuickProgress(w);
  const editProgress = (w: Work, e: Entry) => {
    setProgressId(w.id); setEditEntryId(e.id);
    setProgress({ ...newDraft(), text:e.text, status:e.status, date:e.at.slice(0,10), time:e.at.slice(11,16), tag:w.tag });
    push({ name:"editor", mode:"progress", id:w.id });
  };
  const selectField = (s: Sheet, target: typeof fieldTarget, returnTo: Sheet = "none") => { setFieldTarget(target); setSheetReturn(returnTo); openSheet(s); };
  const returnFromField = () => { keyboard.hide(); setSheet(sheetReturn); setSheetReturn("none"); };
  const resetReviewPosition = () => requestAnimationFrame(()=>rootRef.current?.querySelector<HTMLElement>(".review-dashboard .mobile-scroll")?.scrollTo({top:0}));
  const updateDate = (date: string) => {
    if (fieldTarget === "timeline") {setTimelineDate(date);setFocusDay(null);setFocusHour(null);setOutcomeLimit(8);resetReviewPosition();}
    else if (fieldTarget === "progress") setProgress(p => ({ ...p, date }));
    else setDraft(p => ({ ...p, date }));
  };
  const saveRecord = () => {
    const text = draft.text.trim();
    const title = draft.title.trim() || text.split("\n")[0]?.slice(0, 100);
    if (!title) return;
    if (editing && active) {
      const at = stamp(draft.date, draft.time);
      commit(items.map(w => w.id === active.id ? { ...w, title, description: text, tag: draft.tag, createdAt: at, entries: w.entries.map(e => e.kind === "created" ? { ...e, at } : e) } : w), "事项已更新");
      delete editDrafts.current[active.id]; setDraft(savedNewDraft); back(); return;
    }
    const id = mkId(); const at = stamp(draft.date, draft.time);
    const entry: Entry = { id: mkId(), at, recordedAt: new Date().toISOString(), kind: draft.status === "done" ? "done" : "created", text: draft.status === "done" ? "记录已完成的工作" : text || title, status: draft.status };
    commit([{ id, title, description: text, status: draft.status, tag: draft.tag, createdAt: at, entries: draft.status === "done" ? [{...entry,id:mkId(),kind:"created",status:"todo",text:"建立工作记录"},entry] : [entry] }, ...items], draft.status === "done" ? "已保存完成记录" : "记录已保存");
    setDraft(newDraft()); setSavedNewDraft(newDraft()); setDescriptionOpen(false); keyboard.hide(); setPages(p => [...p.slice(0, -1), { name: "detail", id }]);
  };
  const saveProgress = () => {
    if (!progressWork || !progress.text.trim()) return;
    const previous = progressWork.entries.find(e => e.id === editEntryId);
    const entry: Entry = { ...previous, id: editEntryId ?? mkId(), at: stamp(progress.date, progress.time), recordedAt: previous?.recordedAt ?? new Date().toISOString(), text: progress.text.trim(), fromStatus: previous?.fromStatus ?? progressWork.status, kind: editEntryId ? (previous!.status === progress.status ? previous!.kind : updateKind(previous!.fromStatus ?? progressWork.status,progress.status)) : updateKind(progressWork.status,progress.status), status: progress.status };
    commit(items.map(w => {
      if (w.id !== progressWork.id) return w;
      const entries = editEntryId ? w.entries.map(e => e.id === editEntryId ? entry : e) : [...w.entries, entry];
      return { ...w, entries, status: sortedEntries({ ...w, entries })[0].status };
    }), editEntryId ? "记录已更正" : "进展已保存");
    if (!editEntryId) delete progressDrafts.current[progressWork.id];
    closeSheet(); setProgressId(null); setEditEntryId(null); setProgress(newDraft());
    if (page.name === "editor" && page.mode === "progress") back();
  };
  const matchesFilter = (w: Work, f = filter) => {
    if (f.status === "today-done" ? !completedToday(w) : f.status !== "all" && w.status !== f.status) return false;
    if (f.tag !== "all" && w.tag !== f.tag) return false;
    const d = lastEntry(w)?.at.slice(0, 10) || w.createdAt.slice(0, 10);
    return f.date === "all" || (f.date === "today" ? d === TODAY : f.date === "week" ? d >= weekStart(TODAY) : d >= monthStart(TODAY));
  };
  const filtered = useMemo(() => {
    const list = live.filter(w => matchesFilter(w));
    if (sort === "created") list.sort((a,b) => b.createdAt.localeCompare(a.createdAt));
    else if (sort === "title") list.sort((a,b) => a.title.localeCompare(b.title, "zh-CN"));
    else list.sort((a,b) => (lastEntry(b)?.at ?? b.createdAt).localeCompare(lastEntry(a)?.at ?? a.createdAt));
    if(cardOrder) list.sort((a,b)=>{const ai=cardOrder.indexOf(a.id),bi=cardOrder.indexOf(b.id);return (ai<0?-1:ai)-(bi<0?-1:bi);});
    return list;
  }, [items, filter, sort, cardOrder]);
  const activeFilters = Object.values(filter).filter(x => x !== "all").length;
  const overviewMetrics = [
    {key:"doing",label:"进行中",count:live.filter(w=>w.status==="doing").length},
    {key:"todo",label:"待开始",count:live.filter(w=>w.status==="todo").length},
    {key:"today-done",label:"今日完成",count:live.filter(completedToday).length},
  ];
  const selectedOverview = filter.tag === "all" && filter.date === "all" ? filter.status : "all";
  const selectOverview = (key:string) => {
    keyboard.hide();setStatusMenu(null);
    setFilter(selectedOverview === key ? EMPTY_FILTER : {...EMPTY_FILTER,status:key});
    const scroller=rootRef.current?.querySelector<HTMLElement>(".home-scroll .mobile-scroll");
    if(scroller)scroller.scrollTop=0;
  };
  const searchResults = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    if (!q) return [];
    return live.filter(w => matchesFilter(w) && (w.title + "\n" + w.description + "\n" + (w.subtasks??[]).map(c=>c.title).join("\n") + "\n" + w.entries.map(e => e.text).join("\n")).toLocaleLowerCase().includes(q));
  }, [query, items, filter]);
  const homeGroups = [...new Set(filtered.map(w=>groupAnchors[w.id]??(sort==="created"?w.createdAt:lastEntry(w).at).slice(0,10)))].sort((a,b)=>b.localeCompare(a)).map(date=>{
    const works=filtered.filter(w=>(groupAnchors[w.id]??(sort==="created"?w.createdAt:lastEntry(w).at).slice(0,10))===date);
    const counts=activityCounts(works.flatMap(w=>w.entries.filter(e=>e.kind!=="edited"&&e.at.slice(0,10)===date)));
    return {date,works,counts,completed:works.filter(w=>w.status==="done").length};
  });
  const hotWorks = live.filter(w=>matchesFilter(w)).map(w=>({work:w,updates:w.entries.filter(e=>e.kind!=="created"&&e.kind!=="edited"&&e.at.slice(0,10)>=addDays(TODAY,-6)).length})).filter(x=>x.updates>0).sort((a,b)=>b.updates-a.updates||lastEntry(b.work).at.localeCompare(lastEntry(a.work).at)).slice(0,6);
  const detailHistory = active ? sortedEntries(active).filter(e=>recordMatchesScope(e,detailScope)) : [];
  const detailChild = detailScope.kind === "children" ? active?.subtasks?.find(child=>child.id===detailScope.childId) : undefined;
  const selectRecordScope = (scope:RecordScope) => {setDetailScope(scope);setHistoryLimit(10);};
  const allEvents = useMemo(() => items.filter(w => !w.deleted).flatMap(w => sortedEntries(w).filter(e=>e.kind !== "edited").map(e => ({ ...e, work: w }))).sort((a,b) => b.at.localeCompare(a.at)), [items]);
  const rangeStart = timelineMode === "day" ? timelineDate : timelineMode === "week" ? weekStart(timelineDate) : monthStart(timelineDate);
  const rangeEnd = timelineMode === "day" ? timelineDate : timelineMode === "week" ? addDays(rangeStart, 6) : dayKey(new Date(dateObj(rangeStart).getFullYear(), dateObj(rangeStart).getMonth() + 1, 0));
  const periodEvents = allEvents.filter(e => e.at.slice(0, 10) >= rangeStart && e.at.slice(0, 10) <= rangeEnd);
  const completedPeriod = new Set(periodEvents.filter(e => e.kind === "done" && sortedEntries(e.work).find(x => x.at.slice(0, 10) <= rangeEnd)?.status === "done").map(e => e.work.id)).size;
  const groups = [...new Set(periodEvents.map(e => e.at.slice(0, 10)))];
  const touched = [...new Set(periodEvents.map(e=>e.work.id))].map(id=>{
    const work=items.find(w=>w.id===id)!;
    const state=sortedEntries(work).find(e=>e.at.slice(0,10)<=rangeEnd)!;
    const latest=periodEvents.find(e=>e.work.id===id)!;
    const completion=periodEvents.find(e=>e.work.id===id&&e.kind === "done");
    return {work,state,latest,completion};
  });
  const finished=touched.filter(x=>x.state.status === "done" && x.completion);
  const continuing=touched.filter(x=>x.state.status === "doing" && !x.work.cancelled);
  const periodCounts=activityCounts(periodEvents);
  const focusedEvents=focusDay?periodEvents.filter(e=>e.at.slice(0,10)===focusDay):periodEvents;
  const focusedCounts=activityCounts(focusedEvents);
  const scopedEvents=focusedEvents.filter(e=>(activityFilter === "all" || activityType(e) === activityFilter) && (focusHour === null || (Number(e.at.slice(11,13))>=focusHour && Number(e.at.slice(11,13))<focusHour+4)));
  const visiblePeriodEvents=scopedEvents.slice(0,outcomeLimit);
  const periodEventDays=[...new Set(visiblePeriodEvents.map(e=>e.at.slice(0,10)))].map(date=>({date,events:visiblePeriodEvents.filter(e=>e.at.startsWith(date)),total:scopedEvents.filter(e=>e.at.startsWith(date)).length}));
  const scopedWorks=(panelView === "done"?finished:continuing).filter(x=>!focusDay || (panelView === "done"?x.completion?.at.slice(0,10)===focusDay:periodEvents.some(e=>e.work.id===x.work.id&&e.at.slice(0,10)===focusDay)));
  const periodLabel=timelineMode === "day" ? shortDate(timelineDate) : timelineMode === "week" ? shortDate(rangeStart)+" — "+shortDate(rangeEnd) : dateObj(timelineDate).getFullYear()+" 年 "+(dateObj(timelineDate).getMonth()+1)+" 月";
  const weekDays=Array.from({length:7},(_,i)=>addDays(rangeStart,i));
  const dayCount=(d:string)=>periodEvents.filter(e=>e.at.slice(0,10)===d).length;
  const weekMax=Math.max(1,...weekDays.map(dayCount));
  const pickFocusDay=(d:string)=>{setFocusDay(prev=>prev===d?null:d);setFocusHour(null);setPanelView("events");setOutcomeLimit(8);};
  const pickActivity=(type:ActivityType)=>{setActivityFilter(prev=>prev===type?"all":type);setPanelView("events");setOutcomeLimit(8);};
  const renderStack=(events:Entry[],max:number)=>{const counts=activityCounts(events);return <span className="stacked-segments" style={{height:(events.length?Math.max(8,events.length/max*100):3)+"%"}}>{ACTIVITY.map(type=>counts[type]>0?<span key={type} className={"segment "+type+(activityFilter !== "all" && activityFilter !== type?" dimmed":"")} style={{flex:counts[type]}}/>:null)}</span>};
  const navigatePeriod = (n: number) => {
    if (timelineMode === "month") { const d = dateObj(monthStart(timelineDate)); d.setMonth(d.getMonth() + n); setTimelineDate(dayKey(d)); }
    else setTimelineDate(d => addDays(d, n * (timelineMode === "week" ? 7 : 1)));
    setExpandedDays([]); setFocusDay(null);setFocusHour(null);setOutcomeLimit(8);resetReviewPosition();
  };
  const showChildRecords = (id:string) => {selectRecordScope({kind:"children",childId:id});requestAnimationFrame(()=>{const scroller=rootRef.current?.querySelector<HTMLElement>(".detail-scene .mobile-scroll");const section=rootRef.current?.querySelector<HTMLElement>(".detail-records");if(scroller&&section)scroller.scrollTo({top:scroller.scrollTop+section.getBoundingClientRect().top-scroller.getBoundingClientRect().top-15,behavior:"smooth"});});};
  const renderRow = (w: Work, options: { search?: boolean; restore?: boolean } = {}) => {
    const history = sortedEntries(w).filter(e=>e.kind !== "edited");
    const latest = history[0];
    const count = history.length;
    const children=childProgress(w);
    const longTitle=w.title.length>=14;
    const checked = !!selection?.includes(w.id);
    const expanded = expandedCard === w.id;
    const content = history.find(e=>e.text && e.text!=="建立工作记录" && !(e.fromStatus && e.text===LABEL[e.fromStatus]+" → "+LABEL[e.status]) && !(e.childFromStatus&&e.childStatus&&e.text===LABEL[e.childFromStatus]+" → "+LABEL[e.childStatus]));
    let sub = content && content.text !== w.title ? content.text : "";
    if(content?.kind==="created"&&sub.startsWith(w.title))sub=sub.slice(w.title.length).trim();
    if (options.search && query && !w.title.toLowerCase().includes(query.toLowerCase())) {
      const source=[w.description,...w.entries.map(x=>x.text)].find(t=>t.toLowerCase().includes(query.toLowerCase()));
      if(source){const at=source.toLowerCase().indexOf(query.toLowerCase());sub=(at>10?"…":"")+source.slice(Math.max(0,at-10),at+query.length+36);}
    }
    const select=()=>setSelection(prev=>prev?.includes(w.id)?prev.filter(id=>id!==w.id):[...(prev??[]),w.id]);
    return <article className={"entry-card "+w.status+(expanded?" expanded":"")+(checked?" selected":"")+(quickTarget===w.id&&quickExpanded?" recording":"")} key={w.id} aria-label={"事项卡片 "+w.title}>
      <div className={"entry-card-heading"+(sub?" has-progress":"")+(longTitle?" long-copy":"")}>
        {selection ? <button role="checkbox" aria-checked={checked} aria-label={"选择 "+w.title} className="entry-complete-toggle" onClick={select}><span className={"work-checkbox"+(checked?" checked":"")}>{checked&&<Check size={14} weight="bold"/>}</span></button> : <button className="entry-complete-toggle" role="checkbox" aria-checked={w.status==="done"} aria-label={(w.status==="done"?"取消完成 ":"标记完成 ")+w.title} title={LABEL[w.status]} disabled={options.restore} onClick={()=>changeState([w.id],w.status==="done"?resumeStatus(w):"done")}><span className={"work-checkbox "+w.status+(w.status==="done"?" checked":"")}>{w.status==="done"&&<Check size={14} weight="bold"/>}</span></button>}
        <button className="entry-title" aria-label={"查看事项 "+w.title} onClick={()=>selection?select():enterDetail(w.id)}><span>{w.title}</span></button>
        {sub&&<div className="entry-latest-progress" aria-label={"最新进展："+sub} title={sub}>{(sub.match(/[^，。；、！？,;!?]+[，。；、！？,;!?]?/g)??[sub]).map((phrase,i)=><span key={i}>{phrase}</span>)}</div>}
        {options.restore&&<button className="text-button restore-button" onClick={()=>commit(items.map(i=>i.id===w.id?{...i,deleted:false,cancelled:false}:i),"事项已恢复")}>恢复</button>}
      </div>
      <div className="entry-card-footer">
        {!options.restore&&!selection&&<div className="entry-secondary-actions"><button className="entry-note-action" aria-label={(w.status==="done"?"补充结果 ":"记进展 ")+w.title} onClick={()=>openQuickProgress(w)}><NotePencil size={17}/></button>{children.total>0&&<button className="entry-children-count" aria-label={"查看子任务 "+w.title+"，"+children.done+"/"+children.total+" 已完成"} onClick={()=>enterDetail(w.id)}><ListChecks size={15}/><span>{children.done}/{children.total}</span></button>}<button className="entry-more-action" aria-label={"调整状态 "+w.title} title={"当前"+LABEL[w.status]} aria-haspopup="menu" aria-expanded={statusMenu?.id===w.id} onClick={e=>openCardStatus(w,e.currentTarget)}><DotsThreeVertical size={17}/></button></div>}
        <button className="entry-history-toggle" aria-label={(expanded?"收起":"展开")+"最近记录 "+w.title} aria-expanded={expanded} aria-controls={"recent-"+w.id} onClick={()=>selection?select():setExpandedCard(expanded?null:w.id)}><time>{timeLabel(latest?.at ?? w.createdAt)}</time><span className="meta-divider">·</span><span>{count} 条</span>{expanded?<CaretUp size={12}/>:<CaretDown size={12}/>}</button>
      </div>
      {expanded && !selection && <RecentRecords key={w.id} work={w} history={history} onDetail={()=>enterDetail(w.id)}/>}
    </article>;
  };
  const renderEvent = (e: Entry & { work: Work }) => {
    const before=e.childFromStatus??e.fromStatus,after=e.childStatus??e.status;
    return <button className={"timeline-event activity-event "+activityType(e)} key={e.id} onClick={()=>enterDetail(e.work.id)}>
      <span className="event-time">{e.at.slice(11,16)}</span><span className={"event-symbol "+activityType(e)}>{e.kind==="done"?<CheckCircle size={18} weight="fill"/>:<Circle size={9} weight="fill"/>}</span><span className="event-content"><span className="event-type-line"><span className={"event-type-badge "+activityType(e)}>{e.subtaskId?recordLabel(e):ACTIVITY_LABEL[activityType(e)]}</span><span className="event-state-change">{before&&before!==after?LABEL[before]+" → "+LABEL[after]:LABEL[after]}</span></span><strong>{e.work.title}</strong>{e.subtaskId&&<span className="event-child-title"><ListChecks size={13}/>{e.work.subtasks?.find(c=>c.id===e.subtaskId)?.title}</span>}<span className="event-note">{e.text}</span></span><CaretRight size={15}/>
    </button>;
  };
  const nav = <nav className="bottom-nav" style={{ bottom: bottomInset }} aria-label="主导航"><button className={page.name === "home" ? "active" : ""} aria-current={page.name==="home"?"page":undefined} onClick={() => rootNav("home")}><ListBullets size={25} weight={page.name === "home" ? "bold" : "regular"} /><span>工作台</span></button><button className={page.name==="todo"?"active":""} aria-current={page.name==="todo"?"page":undefined} onClick={()=>rootNav("todo")}><ListChecks size={25} weight={page.name==="todo"?"bold":"regular"}/><span>清单</span></button><button className={page.name === "timeline" ? "active" : ""} aria-current={page.name==="timeline"?"page":undefined} onClick={() => rootNav("timeline")}><CalendarBlank size={24} weight={page.name === "timeline" ? "bold" : "regular"} /><span>回顾</span></button></nav>;
  const toolbar = (title: string, right?: ReactNode) => <header className="simple-toolbar"><IconButton label="返回" onClick={back}><ArrowLeft size={23} /></IconButton><h2>{title}</h2><div className="toolbar-right">{right}</div></header>;
  const editorData = page.mode === "progress" ? progress : draft;
  const setEditorData = page.mode === "progress" ? setProgress : setDraft;
  const selectedDate = fieldTarget === "timeline" ? timelineDate : fieldTarget === "progress" ? progress.date : draft.date;
  const statusField = (value: Status, target: typeof fieldTarget, returnTo: Sheet = "none") => <button className="field-chip" onClick={() => selectField("status", target, returnTo)}><CheckCircle size={17} /><span>{LABEL[value]}</span><CaretDown size={14} /></button>;
  const dateField = (value: string, target: typeof fieldTarget, returnTo: Sheet = "none") => <button className="field-chip" onClick={() => selectField("date", target, returnTo)}><CalendarBlank size={17} /><span>{dateLabel(value)}</span><CaretDown size={14} /></button>;
  const exportText = async () => {
    const lines = ["工作记录 · " + rangeStart + " — " + rangeEnd, "", ...periodEvents.map(e => e.at.slice(0,10) + " " + e.at.slice(11,16) + " · " + KIND[e.kind] + "\n" + e.work.title + "\n" + e.text + "\n")];
    try{await download("拾迹记录-" + rangeStart + ".txt", lines.join("\n"));closeSheet();notify("记录已导出");}catch{notify("导出已取消或未完成");}
  };
  return <CategoryWorkspace items={items} onNotify={notify} onAssign={(id,name)=>commit(items.map(work=>work.id===id?{...work,tag:name}:work),"分类已更新")} onRename={(before,after)=>{
    setItems(current=>current.map(work=>work.tag===before?{...work,tag:after}:work));
    const renameDraft=(value:Draft)=>value.tag===before?{...value,tag:after}:value;
    setDraft(renameDraft);setProgress(renameDraft);setSavedNewDraft(renameDraft);
    setFilter(value=>value.tag===before?{...value,tag:after}:value);setPendingFilter(value=>value.tag===before?{...value,tag:after}:value);
    Object.keys(editDrafts.current).forEach(id=>{editDrafts.current[id]=renameDraft(editDrafts.current[id]);});
    Object.keys(progressDrafts.current).forEach(id=>{progressDrafts.current[id]=renameDraft(progressDrafts.current[id]);});
  }}>{categoryUI=><><div className="work-app" inert={categoryUI.isOpen} ref={rootRef} onFocusCapture={() => { const screen=rootRef.current?.closest<HTMLElement>(".device-screen"); if(screen) screen.scrollTop=0; }}  style={{ "--bottom-inset": bottomInset + "px" } as CSSProperties}>
    {page.name === "home" && <section inert={quickExpanded||!!viewedPhoto} className="scene home-scene">
      <header className="home-header" aria-label="任务概览"><div className="home-overview-row">{selection?<><div className="batch-overview"><h1>批量管理</h1><span>已选择 {selection.length} 个事项</span></div><button className="text-button" onClick={()=>setSelection(null)}>取消</button></>:<><div className="work-overview" role="group" aria-label="任务数量，点击筛选">{overviewMetrics.map(metric=><button key={metric.key} className={"overview-metric "+metric.key} aria-label={"查看"+metric.label+"任务，"+metric.count+" 项"} aria-pressed={selectedOverview===metric.key} onClick={()=>selectOverview(metric.key)}>{metric.key==="doing"?<><strong>{metric.count}</strong><span>{metric.label}</span></>:<><span>{metric.label}</span><strong>{metric.count}</strong></>}</button>)}</div><div className="home-utilities"><div className="work-summary"><time>{shortDate(TODAY)}</time><span className="summary-divider">·</span><span>{live.length} 条</span></div><div className="header-actions"><IconButton label="搜索记录" onClick={()=>push({name:"search"})}><MagnifyingGlass size={22}/></IconButton><IconButton label="更多功能" onClick={()=>openSheet("menu")}><DotsThreeVertical size={21}/></IconButton></div></div></>}</div>
      <div className="list-tools"><div>{selection?<button onClick={()=>setSelection(selection.length===filtered.length?[]:filtered.map(w=>w.id))}>全选当前列表</button>:<><button onClick={()=>openSheet("sort")}>{sort==="recent"?"最近更新":sort==="created"?"最近创建":"组内按名称"}<CaretDown size={13}/></button><button className="collapse-all" aria-label={openWorkDays.length?"折叠所有日期":"展开所有日期"} onClick={()=>setOpenWorkDays(openWorkDays.length?[]:homeGroups.map(g=>g.date))}>{openWorkDays.length?<CaretUp size={13}/>:<CaretDoubleDown size={13}/>}全部{openWorkDays.length?"折叠":"展开"}</button></>}</div><button className={activeFilters?"active-filter":""} onClick={()=>{setPendingFilter(filter);openSheet("filter");}}><FunnelSimple size={17}/>筛选{activeFilters?" "+activeFilters:""}</button></div></header>
      <MobileScroll className="home-scroll"><main className="list-body" aria-label="工作事项列表">{activeFilters>0&&<div className="filter-summary"><span>{filtered.length} 个匹配事项</span><button onClick={()=>setFilter(EMPTY_FILTER)}>清除筛选<X size={13}/></button></div>}{homeGroups.map(group=>{const isOpen=openWorkDays.includes(group.date);return <section className={"work-day "+(isOpen?"expanded":"collapsed")} key={group.date} aria-label={dateLabel(group.date)+"的任务"}>
        <button className="work-day-heading" aria-expanded={isOpen} aria-controls={"day-"+group.date} onClick={()=>setOpenWorkDays(days=>isOpen?days.filter(d=>d!==group.date):[...days,group.date])}><span><strong>{dateLabel(group.date)}</strong><small>{group.date>=addDays(TODAY,-1)?shortDate(group.date)+" · ":""}周{"日一二三四五六"[dateObj(group.date).getDay()]}</small></span><span className="day-task-total">{group.works.length} 项{isOpen?<CaretUp size={15}/>:<CaretDown size={15}/>}</span></button>
        {isOpen?<div id={"day-"+group.date}>{group.works.map(w=>renderRow(w))}</div>:<button className="day-summary-body" aria-label={"展开 "+dateLabel(group.date)+"，"+group.works.length+" 个任务"} onClick={()=>setOpenWorkDays(days=>[...days,group.date])}><div className="day-summary-states"><span>{group.works.length-group.completed} 项待完成</span><span>{group.completed} 项已完成</span></div><div className="day-state-track"><span style={{width:group.completed/group.works.length*100+"%"}}/></div><div className="day-event-summary">{ACTIVITY.map(t=><span key={t} className={t}><i/>{ACTIVITY_SHORT[t]}<b>{group.counts[t]}</b></span>)}</div><p>{group.works.slice(0,2).map(w=>w.title).join(" · ")}</p></button>}
      </section>})}{!filtered.length&&<Empty title={activeFilters?"没有匹配的事项":"记下第一件工作"} text="" action={activeFilters?"清除筛选":"记一条"} onAction={()=>activeFilters?setFilter(EMPTY_FILTER):openNew()}/>}<p className="list-end">{filtered.length?"共 "+filtered.length+" 个任务 · 按"+(sort==="created"?"创建":"最近更新")+"日期归组":""}</p></main></MobileScroll>
      {selection ? <div className="batch-bar" style={{ bottom: bottomInset }}><button disabled={!selection.length} onClick={() => changeState(selection, "done")}><CheckCircle size={22} />完成</button><button disabled={!selection.length} onClick={() => selectField("tag", "batch")}><TagSimple size={22} />分类</button><button disabled={!selection.length} onClick={() => { setDeleteIds(selection); openSheet("delete"); }}><Trash size={22} />删除</button></div> : <>{!isKeyboardVisible && nav}</>}
    </section>}

    <TodoListPage items={items} visible={page.name==="todo"} blocked={quickExpanded||!!viewedPhoto} nav={!isKeyboardVisible?nav:null} onSearch={()=>push({name:"search"})} onDetail={enterDetail} onToggle={work=>changeState([work.id],work.status==="done"?resumeStatus(work):"done")} onToggleChild={(work,child)=>changeChildState(work,child,child.status==="done"?(sortedEntries(work).find(entry=>entry.subtaskId===child.id&&entry.childStatus==="done")?.childFromStatus??"doing"):"done")} onRecord={openQuickProgress} onAddChild={work=>beginRecord(work,undefined,"child")} onStatus={openCardStatus} categories={categoryUI.categories} onManage={categoryUI.manage} onAssign={categoryUI.assign} onCategory={name=>setSavedNewDraft(current=>({...current,tag:name}))}/>

    {page.name === "detail" && active && <section inert={quickExpanded||!!viewedPhoto} className="scene detail-scene">
      {toolbar("任务详情",<IconButton label="事项操作" onClick={()=>openSheet("item-menu")}><DotsThreeVertical size={22}/></IconButton>)}
      <MobileScroll className="standard-scroll"><main className="detail-content">
        <section className="detail-overview"><div className="detail-kicker"><button className="detail-category-edit" aria-label={"修改任务分类，当前"+active.tag} onClick={()=>categoryUI.assign(active.id)}>{active.tag}<CaretDown size={11}/></button><time>{shortDate(active.createdAt.slice(0,10))} 创建</time></div><div className="detail-title-row"><button className="detail-check" role="checkbox" aria-checked={active.status==="done"} aria-label={active.status==="done"?"取消完成主任务":"完成主任务"} onClick={()=>changeState([active.id],active.status==="done"?resumeStatus(active):"done")}><span className={"work-checkbox "+active.status+(active.status==="done"?" checked":"")}>{active.status==="done"&&<Check size={17} weight="bold"/>}</span></button><h1 className="detail-title">{active.title}</h1></div>
          <div className="detail-status-line"><button onClick={e=>openCardStatus(active,e.currentTarget)}><span className={"work-status-dot "+active.status}/>{LABEL[active.status]}<CaretDown size={12}/></button><time>更新于 {timeLabel(lastEntry(active).at)}</time></div>
          {active.description&&<div className="detail-description"><p className={"description-text "+(!descriptionOpen&&active.description.length>65?"clamped":"")}>{active.description}</p><div className="description-actions">{active.description.length>65&&<button onClick={()=>setDescriptionOpen(v=>!v)}>{descriptionOpen?"收起":"展开全文"}<CaretDown size={12}/></button>}<button onClick={openEdit}><PencilSimple size={13}/>编辑说明</button></div></div>}
        </section>
        <section className="task-breakdown"><div className="section-heading"><h3>子任务 <span>{childProgress(active).done}/{childProgress(active).total}</span></h3><button className="text-button" onClick={()=>beginRecord(active,undefined,"child")}><Plus size={16}/>添加</button></div>
          {(active.subtasks??[]).length>0&&<div className="child-progress-track" aria-label={childProgress(active).done+" 个子任务已完成，共 "+childProgress(active).total+" 个"}><span style={{width:childProgress(active).done/childProgress(active).total*100+"%"}}/></div>}
          {(active.subtasks??[]).map(child=>{const childEntries=sortedEntries(active).filter(e=>e.subtaskId===child.id);const latest=childEntries.find(e=>e.childAction==="progress"||!!e.attachments?.length);const isOpen=openedChildren.includes(child.id);return <article className={"subtask-card "+child.status} key={child.id} aria-label={"子任务 "+child.title}>
            <div className="subtask-top"><button className="subtask-check" role="checkbox" aria-checked={child.status==="done"} aria-label={(child.status==="done"?"取消完成子任务 ":"完成子任务 ")+child.title} onClick={()=>changeChildState(active,child,child.status==="done"?(childEntries.find(e=>e.childStatus==="done")?.childFromStatus??"doing"):"done")}><span className={"work-checkbox "+child.status+(child.status==="done"?" checked":"")}>{child.status==="done"&&<Check size={13} weight="bold"/>}</span></button><button className="subtask-title" aria-expanded={isOpen} onClick={()=>setOpenedChildren(ids=>isOpen?ids.filter(id=>id!==child.id):[...ids,child.id])}>{child.title}</button><button className="subtask-note" aria-label={"记子任务进展 "+child.title} onClick={()=>openQuickProgress(active,child)}><NotePencil size={18}/></button><button className="subtask-more" aria-label={"调整子任务状态 "+child.title} onClick={e=>openCardStatus(active,e.currentTarget,child.id)}><DotsThreeVertical size={16}/></button></div>
            {latest&&!isOpen&&<button className="subtask-latest" onClick={()=>setOpenedChildren(ids=>[...ids,child.id])}>{latest.text}<CaretDown size={11}/></button>}
            {isOpen&&<div className="subtask-records">{childEntries.length?<RecentRecords work={{...active,id:child.id,title:child.title}} history={childEntries} onDetail={()=>showChildRecords(child.id)} onViewPhotos={(photos,index,trigger,entry)=>openPhotos(photos,index,trigger,entry,child.title)}/>:<button className="text-button" onClick={()=>openQuickProgress(active,child)}><Plus size={14}/>补充进展</button>}</div>}
          </article>})}
          {!(active.subtasks??[]).length&&<button className="add-first-child" onClick={()=>beginRecord(active,undefined,"child")}><Plus size={18}/>添加子任务</button>}
        </section>
        <section className="detail-records"><div className="section-heading record-section-heading"><h3>进展记录</h3><span className="record-order">最新在前</span></div>
          <div className="record-scope" role="group" aria-label="记录范围">
            <button aria-label="全部记录" aria-description={"共 "+active.entries.length+" 条"} aria-pressed={detailScope.kind==="all"} className={detailScope.kind==="all"?"active":""} onClick={()=>selectRecordScope({kind:"all"})}>全部<span>{active.entries.length}</span></button>
            <button aria-label="主任务记录" aria-description={"共 "+active.entries.filter(entry=>!entry.subtaskId).length+" 条"} aria-pressed={detailScope.kind==="main"} className={detailScope.kind==="main"?"active":""} onClick={()=>selectRecordScope({kind:"main"})}>主任务<span>{active.entries.filter(entry=>!entry.subtaskId).length}</span></button>
            <button aria-label="子任务记录" aria-description={"共 "+active.entries.filter(entry=>!!entry.subtaskId).length+" 条"} aria-pressed={detailScope.kind==="children"} className={detailScope.kind==="children"?"active":""} onClick={()=>selectRecordScope({kind:"children"})}>子任务<span>{active.entries.filter(entry=>!!entry.subtaskId).length}</span></button>
          </div>
          {detailScope.kind==="children"&&!!active.subtasks?.length&&<div className="record-child-filter"><button aria-label={"选择子任务记录范围，当前："+(detailChild?.title??"全部子任务")} aria-haspopup="dialog" onClick={()=>openSheet("record-child")}><ListChecks size={15}/><span>{detailChild?.title??"全部子任务"}</span>{detailChild&&<small>{detailHistory.length} 条</small>}<CaretDown size={13}/></button>{detailChild&&<button className="record-child-clear" aria-label="清除具体子任务筛选" onClick={()=>selectRecordScope({kind:"children"})}><X size={14}/></button>}</div>}
          <DetailRecordFeed work={active} entries={detailHistory} limit={historyLimit} onScope={selectRecordScope} onEdit={entry=>editProgress(active,entry)} onPhotos={openPhotos}/>
          {!detailHistory.length&&<div className="record-scope-empty"><p>{detailScope.kind==="children"?"暂无子任务记录":"暂无主任务记录"}</p></div>}
          {detailHistory.length>historyLimit&&<button className="load-more" onClick={()=>setHistoryLimit(n=>n+20)}>查看更早的 {detailHistory.length-historyLimit} 条记录<CaretDown size={15}/></button>}
        </section>
      </main></MobileScroll>
      <footer className="detail-footer" style={{bottom:bottomInset}}><button className="secondary-button" onClick={()=>beginRecord(active,undefined,"child")}><Plus size={18}/>子任务</button><button className="primary-button" onClick={()=>openQuickProgress(active,detailChild)}><NotePencil size={19}/>{detailChild?detailChild.status==="done"?"补充子任务结果":"记子任务进展":detailScope.kind==="children"?"记主任务进展":active.status==="done"?"补充结果":"记进展"}</button></footer>
    </section>}

    {page.name === "editor" && <section inert={quickExpanded||!!viewedPhoto} className="scene editor-scene">
      {toolbar(page.mode === "progress" ? editEntryId ? "更正记录" : "记录进展" : editing ? "编辑事项" : "记一条", <button className="toolbar-save" disabled={page.mode === "progress" ? !progress.text.trim() : !draft.text.trim() && !draft.title.trim()} onClick={page.mode === "progress" ? saveProgress : saveRecord}>保存</button>)}
      <MobileScroll className="standard-scroll"><main className="editor-content">{page.mode === "progress" ? <div className="editor-context"><span>正在补充</span><strong>{progressWork?.title}</strong><p>上次：{progressWork && lastEntry(progressWork)?.text}</p></div> : <><label className="field-label" htmlFor="record-title">事项名称 <span>可稍后补充</span></label><KeyboardInput id="record-title" className="title-input" placeholder="用一句话概括这件事" value={draft.title} onChange={e => setDraft(d => ({ ...d, title: e.target.value }))} /></>}
      <label className="field-label" htmlFor="record-content">{page.mode === "progress" ? "这次有什么进展？" : "工作内容"}</label><KeyboardTextarea id="record-content" className="record-textarea" placeholder={page.mode === "progress" ? "记录做到哪里、处理结果或下一步…" : "记下要做的、正在做的，或已经完成的工作…"} value={editorData.text} onChange={e => setEditorData(d => ({ ...d, text: e.target.value }))} rows={10} />
      <div className="editor-count">{editorData.text.length} 字{editorData.text ? " · 草稿已保留" : ""}</div>
      <div className="editor-options">{!editing && statusField(editorData.status, page.mode === "progress" ? "progress" : "draft")}{dateField(editorData.date, page.mode === "progress" ? "progress" : "draft")}{page.mode !== "progress" && <button className="field-chip" onClick={() => selectField("tag", "draft")}><TagSimple size={17} />{draft.tag}<CaretDown size={14} /></button>}</div>
      <p className="editor-help">{page.mode === "progress" ? editEntryId ? "更正这条记录的内容和时间，其他历史保持完整。" : "这次记录会追加到原事项，之前的进展会保留。" : editing ? "更正说明不会覆盖已有的进展记录。" : "已经做完的工作，选择“已完成”即可直接记录。"}</p></main></MobileScroll>
      {isKeyboardVisible && <div className="keyboard-toolbar" style={{ bottom: bottomInset }}><span>{editorData.text.length} 字</span><button onClick={() => keyboard.hide()}>收起键盘<Check size={16} /></button></div>}
    </section>}

    {page.name === "search" && <section inert={quickExpanded||!!viewedPhoto} className="scene search-scene">
      <header className="search-header"><IconButton label="返回" onClick={back}><ArrowLeft size={22} /></IconButton><div className="search-input-wrap"><MagnifyingGlass size={18} /><KeyboardInput aria-label="搜索事项和进展" placeholder="搜索事项、说明或进展" value={query} onChange={e => setQuery(e.target.value)} enterKeyHint="search" onKeyDown={e => { if (e.key === "Enter") keyboard.hide(); }} />{query && <IconButton label="清空搜索" onClick={() => setQuery("")}><X size={16} /></IconButton>}</div><IconButton label="筛选搜索结果" onClick={() => { setPendingFilter(filter); openSheet("filter"); }}><FunnelSimple size={21} /></IconButton></header>
      <MobileScroll className="search-scroll"><main className="search-content">{query.trim() ? <><div className="search-result-count">找到 {searchResults.length} 个事项{activeFilters ? " · 已应用筛选" : ""}</div>{searchResults.length ? searchResults.map(w => renderRow(w, { search: true })) : <Empty title="没有找到相关记录" text="试试更短的关键词，或清除筛选条件。" action={activeFilters ? "清除筛选" : undefined} onAction={() => setFilter(EMPTY_FILTER)} />}</> : <section className="recently-active"><div className="search-section-heading"><h3>近期活跃</h3><span>近 7 天</span></div>{hotWorks.map(({work,updates})=><div className="active-search-item" key={work.id}><div className="search-activity-line"><span>{updates} 次更新</span></div>{renderRow(work)}</div>)}</section>}</main></MobileScroll>
    </section>}

    {page.name === "timeline" && <section inert={quickExpanded||!!viewedPhoto} className="scene review-dashboard">
      <header className="dashboard-header">
        <div className="dashboard-headline"><h1>工作回顾</h1><div className="period-tabs dashboard-tabs" role="tablist" aria-label="回顾周期">{(["day","week","month"] as const).map((mode,i)=><button key={mode} role="tab" aria-label={["按日查看","按周查看","按月查看"][i]} aria-selected={timelineMode===mode} className={timelineMode===mode?"active":""} onClick={()=>{setTimelineMode(mode);setFocusDay(null);setFocusHour(null);setOutcomeLimit(8);setExpandedDays([]);resetReviewPosition();}}>{["日","周","月"][i]}</button>)}</div><IconButton label="导出当前时段" onClick={()=>openSheet("export")}><DownloadSimple size={19}/></IconButton></div>
        <div className="dashboard-period-bar"><button className="dashboard-period-label" onClick={()=>selectField("date","timeline")}><CalendarBlank size={17}/><span>{periodLabel}</span><CaretDown size={12}/></button><div className="dashboard-period-arrows"><IconButton label="上一时段" onClick={()=>navigatePeriod(-1)}><CaretLeft size={17}/></IconButton><IconButton label="下一时段" onClick={()=>navigatePeriod(1)}><CaretRight size={17}/></IconButton></div></div>
      </header>
      <MobileScroll className="dashboard-scroll"><main className="dashboard-content">
        <section className="period-panel" aria-label="周期回顾面板">
        <div className="period-lead"><span>{periodEvents.length} 次记录 · {touched.length} 个事项</span><button onClick={()=>{setTimelineDate(TODAY);setFocusDay(null);setFocusHour(null);setOutcomeLimit(8);resetReviewPosition();}}>回到{timelineMode === "day"?"今天":timelineMode === "week"?"本周":"本月"}</button></div>
        <div className="activity-metrics">{ACTIVITY.map(type=><button key={type} aria-label={"筛选"+ACTIVITY_LABEL[type]+"，"+periodCounts[type]+ACTIVITY_UNIT[type]} className={type+(activityFilter===type?" selected":"")} aria-pressed={activityFilter===type} onClick={()=>pickActivity(type)}><span className="activity-metric-number">{periodCounts[type]}<small>{ACTIVITY_UNIT[type]}</small></span><span className="activity-metric-label"><i/>{ACTIVITY_LABEL[type]}</span></button>)}</div>
        <div className="distribution-heading"><span>{timelineMode === "day"?"按时段分布":timelineMode === "week"?"每天发生了什么":"本月事件分布"}</span><span>{timelineMode === "month"?"角标为记录数 · 点选查看":"点选查看明细"}</span></div>
        {timelineMode === "week" && <div className="week-activity stacked-activity" aria-label="本周分类事件分布">{weekDays.map((d,i)=>{const events=periodEvents.filter(e=>e.at.slice(0,10)===d);return <button key={d} title={activityDescription(events)} aria-label={"查看 "+d+" 的记录，"+activityDescription(events)} className={(d===TODAY?"today ":"")+(focusDay===d?"selected":"")} onClick={()=>pickFocusDay(d)}><span className="activity-count">{events.length||"—"}</span><span className="activity-track">{renderStack(events,weekMax)}</span><span className="activity-weekday">{"一二三四五六日"[i]}</span><span className="activity-date">{Number(d.slice(8))}</span></button>})}</div>}
        {timelineMode === "month" && <div className="month-distribution typed-calendar"><div className="month-weekdays">{"一二三四五六日".split("").map(d=><span key={d}>{d}</span>)}</div><div className="month-grid">{Array.from({length:(dateObj(rangeStart).getDay()+6)%7},(_,i)=><span key={"space"+i}/>)}{Array.from({length:dateObj(rangeEnd).getDate()},(_,i)=>{const d=rangeStart.slice(0,8)+String(i+1).padStart(2,"0");const events=periodEvents.filter(e=>e.at.slice(0,10)===d);const counts=activityCounts(events);return <button key={d} title={activityDescription(events)} aria-label={"查看 "+d+" 的记录，"+activityDescription(events)} className={(d===TODAY?"today ":"")+(focusDay===d?"selected":"")} onClick={()=>pickFocusDay(d)}><span className="month-cell-date">{i+1}<small>{events.length||""}</small></span><span className="month-type-marks">{ACTIVITY.map(t=><i key={t} className={t+(counts[t]?" present":"")+(activityFilter!=="all"&&activityFilter!==t?" dimmed":"")} />)}</span></button>})}</div></div>}
        {timelineMode === "day" && <div className="day-rhythm typed-hours"><div className="hour-bars">{[0,4,8,12,16,20].map(h=>{const events=periodEvents.filter(e=>Number(e.at.slice(11,13))>=h&&Number(e.at.slice(11,13))<h+4);const max=Math.max(1,...[0,4,8,12,16,20].map(x=>periodEvents.filter(e=>Number(e.at.slice(11,13))>=x&&Number(e.at.slice(11,13))<x+4).length));return <button key={h} aria-label={"查看 "+h+" 点至 "+(h+4)+" 点，"+activityDescription(events)} className={focusHour===h?"selected":""} onClick={()=>{setFocusHour(prev=>prev===h?null:h);setPanelView("events");}}><span className="hour-value">{events.length||"—"}</span><span className="hour-track">{renderStack(events,max)}</span><span>{String(h).padStart(2,"0")}:00</span></button>})}</div></div>}
        {focusDay && <div className="selected-day-summary"><strong>{shortDate(focusDay)}</strong><div>{ACTIVITY.map(t=><span className={t} key={t}><i/>{ACTIVITY_SHORT[t]} <b>{focusedCounts[t]}</b></span>)}</div><button aria-label="清除选中日期" onClick={()=>setFocusDay(null)}><X size={13}/></button></div>}
        <p className="distribution-caption">统计主任务；子任务变动汇入进展，完成不重复计入状态。</p>
        </section>
        <section className="period-outcomes"><div className="outcome-view-tabs"><button className={panelView === "events"?"active":""} onClick={()=>setPanelView("events")}>过程记录 <span>{periodEvents.length}</span></button><button className={panelView === "done"?"active":""} onClick={()=>{setPanelView("done");setFocusDay(null);}}>完成事项 <span>{finished.length}</span></button><button className={panelView === "active"?"active":""} onClick={()=>{setPanelView("active");setFocusDay(null);}}>持续推进 <span>{continuing.length}</span></button></div>{panelView==="events"&&(focusDay||focusHour!==null||activityFilter!=="all")&&<div className="outcome-heading"><h2>{(focusDay?shortDate(focusDay)+" · ":focusHour!==null?focusHour+"—"+(focusHour+4)+" 时 · ":"")+(activityFilter==="all"?"全部事件":ACTIVITY_LABEL[activityFilter])}<span>{scopedEvents.length}</span></h2><button onClick={()=>{setFocusDay(null);setFocusHour(null);setActivityFilter("all");}}>清除筛选<X size={12}/></button></div>}
        {panelView !== "events" ? scopedWorks.length ? <><div className="outcome-list">{scopedWorks.slice(0,outcomeLimit).map(x=><button key={x.work.id} className="outcome-row" onClick={()=>enterDetail(x.work.id)}><span className={"outcome-icon "+panelView}>{panelView === "done"?<Check size={18} weight="bold"/>:<ClockCounterClockwise size={18}/>}</span><span className="outcome-body"><strong>{x.work.title}</strong><span>{panelView === "done"?x.completion?.text:x.latest.text}</span><small>{shortDate((panelView === "done"?x.completion!:x.latest).at.slice(0,10))} · {x.work.tag}</small></span><CaretRight size={16}/></button>)}</div>{scopedWorks.length>outcomeLimit&&<button className="load-more" onClick={()=>setOutcomeLimit(n=>n+8)}>查看更多事项<CaretDown size={15}/></button>}</> : <Empty title={panelView === "done"?"这段时间还没有完成事项":"这段时间没有推进中的事项"} text="工作发生后，会自动归入对应的时间。" action="查看全部记录" onAction={()=>setPanelView("events")}/> : <div className="review-event-groups">{periodEventDays.map(({date,events,total})=><section className="review-event-day" key={date} aria-label={shortDate(date)+"的记录"}><div className="review-date-heading"><h3><time dateTime={date}>{shortDate(date)}</time><span>周{"日一二三四五六"[dateObj(date).getDay()]}</span></h3><span>{events.length<total?events.length+" / ":""}{total} 条</span></div><div className="panel-event-list">{events.map(e=><div className="panel-event" key={e.id}>{renderEvent(e)}</div>)}</div></section>)}{!scopedEvents.length&&<Empty title="没有符合条件的记录" text="切换日期或事件类型，继续回看工作。"/>}{scopedEvents.length>outcomeLimit&&<button className="load-more" onClick={()=>setOutcomeLimit(n=>n+12)}>展开更早的记录<CaretDown size={15}/></button>}</div>}
        </section><p className="period-footnote">事项按周期内的实际进展归档，跨天持续保留。</p>
      </main></MobileScroll>{nav}
    </section>}

    {page.name === "data" && <section inert={quickExpanded||!!viewedPhoto} className="scene data-scene">{toolbar("数据与备份")}<MobileScroll className="standard-scroll"><main className="data-content"><div className="data-overview"><FileText size={30} weight="light" /><strong>已保存在本机</strong><span>{live.length} 个事项 · {allEvents.length} 条记录</span></div><div className="setting-group"><h3>保存一份副本</h3><button className="setting-row" onClick={async () => {try{const backup=await portableBackup({version:1,savedAt:new Date().toISOString(),items,categories:categoryUI.categories});await download("拾迹备份-"+TODAY+".json",JSON.stringify(backup),"application/json");notify("备份已导出");}catch{notify("导出已取消或未完成");}}}><DownloadSimple size={23} /><span><strong>导出完整备份</strong><small>保留事项、分类、附件和全部历史</small></span><CaretRight size={17} /></button><button className="setting-row" onClick={() => importRef.current?.click()}><UploadSimple size={23} /><span><strong>从备份恢复</strong><small>按事项合并，同一事项保留备份版本</small></span><CaretRight size={17} /></button><input hidden type="file" accept=".json,application/json" ref={importRef} onChange={async e => { const f = e.target.files?.[0]; if (!f) return; try { if(f.size>100*1024*1024)throw new Error("文件过大"); const data = JSON.parse(await f.text()); if (!isValidBackup(data)) throw new Error("无效备份"); const map = new Map(items.map(i => [i.id,i])); data.items.forEach((i: Work) => map.set(i.id,i)); categoryUI.merge(data.categories); commit([...map.values()], "备份已恢复，可撤销",categoryUI.categories); setRestoreMessage("已合并 " + data.items.length + " 个事项"); } catch { setRestoreMessage("这个文件不是有效的拾迹备份，请选择导出的备份文件。"); } e.target.value = ""; }} />{restoreMessage && <p className="inline-feedback">{restoreMessage}</p>}</div><div className="setting-group"><h3>整理与找回</h3><button className="setting-row" onClick={() => push({ name: "trash" })}><Trash size={22} /><span><strong>回收站</strong><small>{items.filter(i => i.deleted).length} 个事项，可恢复完整历史</small></span><CaretRight size={17} /></button><button className="setting-row" onClick={() => push({ name: "cancelled" })}><ArrowCounterClockwise size={22} /><span><strong>已取消跟进</strong><small>{items.filter(i => i.cancelled && !i.deleted).length} 个事项</small></span><CaretRight size={17} /></button></div><div className="app-about"><img src="/icon.png" alt="拾迹图标"/><div><strong>拾迹 <small>0.1.1 · 开源版</small></strong><small>本地保存 · 无账号 · 无广告</small></div></div></main></MobileScroll></section>}

    {(page.name === "trash" || page.name === "cancelled") && <section inert={quickExpanded||!!viewedPhoto} className="scene recycle-scene">{toolbar(page.name === "trash" ? "回收站" : "已取消跟进")}<MobileScroll className="standard-scroll"><main className="list-body"><p className="recycle-info">恢复后，事项说明与进展历史会一起保留。</p>{items.filter(i => page.name === "trash" ? i.deleted : i.cancelled && !i.deleted).length ? items.filter(i => page.name === "trash" ? i.deleted : i.cancelled && !i.deleted).map(w => renderRow(w, { restore: true })) : <Empty title={page.name === "trash" ? "回收站是空的" : "没有取消的事项"} text="需要找回的工作，会出现在这里。" />}</main></MobileScroll></section>}

    {(page.name==="home"||page.name==="todo"||page.name==="timeline")&&!selection&&!quickExpanded&&!isKeyboardVisible&&<FloatingRecorder bottom={bottomInset+86} position={recorderPosition} onPosition={setRecorderPosition} onChoose={mode=>beginRecord(undefined,undefined,"record",mode)}/>}
    <input type="file" accept="image/*" multiple hidden ref={imageRef} aria-label="选择上传图片" onChange={e=>{void receiveImages([...(e.target.files??[])],"upload");e.target.value="";}}/>
    <input type="file" accept="image/*" capture="environment" hidden ref={photoRef} aria-label="使用系统相机拍照" onChange={e=>{void receiveImages([...(e.target.files??[])],"camera");e.target.value="";}}/>
    <RecordCategoryControl open={quickExpanded} work={quickWork} defaultName={page.name==="todo"?savedNewDraft.tag:page.name==="home"&&filter.tag!=="all"?filter.tag:"未分类"} hasDraft={Boolean(quickText.trim()||captureAssets.length)} disabled={audioRecording||filesReading} categories={categoryUI.categories} onResume={()=>{if(recordMode==="text")requestAnimationFrame(()=>rootRef.current?.querySelector<HTMLTextAreaElement>("#quick-record-input")?.focus());}}>{classification=>quickExpanded&&<div className="record-overlay"><button className="record-overlay-backdrop" aria-label="关闭并保留草稿" onClick={closeRecord}/><section className="quick-composer expanded" role="dialog" aria-modal="true" aria-label={quickIntent==="child"?"添加子任务":quickTarget?"记录进展":"新增记录"} style={{bottom:bottomInset}} onKeyDown={e=>{if(e.key==="Escape")closeRecord();}}>
      <div className="composer-context"><div><strong>{quickIntent==="child"?"添加子任务":quickChild?"子任务进展":quickTarget?quickWork?.status==="done"?"补充结果":"记进展":"新增任务"}</strong>{quickWork&&<span>{quickChild?quickChild.title:quickWork.title}</span>}</div>{classification.control}<IconButton label="收起记录，保留草稿" onClick={closeRecord}><X size={21}/></IconButton></div>
      {classification.picker}
      {quickTarget&&!quickChildId&&<div className="composer-intent"><button disabled={audioRecording||filesReading} className={quickIntent==="record"?"selected":""} onClick={()=>beginRecord(quickWork,undefined,"record",recordMode)}>进展</button><button disabled={audioRecording||filesReading} className={quickIntent==="child"?"selected":""} onClick={()=>beginRecord(quickWork,undefined,"child",recordMode)}>子任务</button></div>}
      {recordMode==="image"&&<button className={"image-capture"+(captureAssets.some(a=>a.kind==="photo")?" has-images":"")} disabled={filesReading} onClick={()=>void pickImages("upload")}><ImageSquare size={25}/><span>{filesReading?"正在读取图片":captureAssets.some(a=>a.kind==="photo")?"继续添加图片":"选择图片"}</span></button>}
      {recordMode==="photo"&&(isAndroid()?<button className="native-camera-button" disabled={filesReading} onClick={()=>void pickImages("camera")}><Camera size={30}/><span>{filesReading?"正在读取照片":"打开相机"}</span></button>:<CameraCapture key={quickKey} onCapture={attachment=>setCaptureAssets(prev=>[...prev,attachment])} onNativeCamera={()=>photoRef.current?.click()}/>)}
      {recordMode==="audio"&&<AudioCapture key={quickKey} control={audioCaptureRef} onRecordingChange={setAudioRecording} onCapture={attachment=>setCaptureAssets(prev=>[...prev,attachment])}/>}
      {captureAssets.length>0&&<div className="capture-previews">{captureAssets.map(a=><div key={a.id} className={"capture-preview "+a.kind}>{a.kind==="photo"?<img src={a.src} alt={a.name} draggable={false}/>:<AudioPlayer attachment={a} draft/>}<button aria-label={"移除附件 "+a.name} onClick={()=>setCaptureAssets(prev=>prev.filter(x=>x.id!==a.id))}><X size={13}/></button></div>)}</div>}
      <div className="composer-entry"><KeyboardTextarea id="quick-record-input" aria-label={quickIntent==="child"?"子任务内容":quickChild?"子任务进展内容":quickTarget?"快速输入进展":"快速输入工作记录"} placeholder={quickIntent==="child"?"这件工作中，还有什么要做？":captureAssets.length?"补充一句说明…":quickTarget?"记录这次的进展…":"记下工作内容…"} rows={recordMode==="text"?4:2} value={quickText} onChange={e=>{setQuickText(e.target.value);quickDrafts.current[quickKey]=e.target.value;}}/></div>
      <div className="composer-attachments"><div>{([["text",<NotePencil size={20}/>,"文字"],["image",<ImageSquare size={20}/>,"图片"],["photo",<Camera size={20}/>,"拍照"],["audio",<Microphone size={20}/>,"录音"]] as const).map(([mode,icon,label])=><button disabled={audioRecording||filesReading} className={recordMode===mode?"selected":""} key={mode} aria-label={"切换到"+label+"记录"} onClick={()=>{keyboard.hide();setRecordMode(mode);if(mode==="text")requestAnimationFrame(()=>rootRef.current?.querySelector<HTMLTextAreaElement>("#quick-record-input")?.focus());}}>{icon}</button>)}</div><span>{quickText.length>0?quickText.length+" 字":"今天"}</span></div>
      <div className="composer-submit"><button className="save-completion" role="checkbox" aria-checked={quickStatus==="done"} onClick={()=>setQuickStatus(quickStatus==="done"?(quickChild?.status==="done"||quickWork?.status==="done"?"doing":quickChild?.status??quickWork?.status??"todo"):"done")}><span className={"work-checkbox"+(quickStatus==="done"?" checked":"")}>{quickStatus==="done"&&<Check size={12} weight="bold"/>}</span>{quickStatus==="done"&&(quickChild?.status==="done"||quickWork?.status==="done")?"保持完成":"同时完成"}</button><button className="primary-button" disabled={audioRecording||filesReading||(!quickText.trim()&&!captureAssets.length)} onClick={()=>{if(saveQuick(classification.name))classification.saved();}}>保存<ArrowUp size={18}/></button></div>
    </section></div>}</RecordCategoryControl>

    {viewedPhoto&&<PhotoViewer gallery={viewedPhoto} onClose={closePhoto}/>}
    {statusMenu&&statusWork&&<div className="card-status-layer"><button className="card-status-dismiss" aria-label="关闭状态选择" onClick={closeCardStatus}/><div className="card-status-menu" role="menu" aria-label={"切换状态 "+(statusChild?.title??statusWork.title)} style={{top:statusMenu.top,left:statusMenu.left}} onKeyDown={e=>{if(e.key==="Escape"){e.preventDefault();closeCardStatus();}if(["ArrowDown","ArrowUp"].includes(e.key)){e.preventDefault();const options=[...e.currentTarget.querySelectorAll<HTMLButtonElement>("button")];const index=options.indexOf(document.activeElement as HTMLButtonElement);options[(index+(e.key==="ArrowDown"?1:2))%3]?.focus({preventScroll:true});}}}>{(["todo","doing","done"] as Status[]).map(s=><button key={s} role="menuitemradio" aria-checked={(statusChild?.status??statusWork.status)===s} onClick={()=>statusChild?changeChildState(statusWork,statusChild,s):changeState([statusWork.id],s)}><span className={"work-status-dot "+s}/><span>{LABEL[s]}</span>{(statusChild?.status??statusWork.status)===s&&<Check size={15}/>}</button>)}</div></div>}
    <BottomSheet open={sheet !== "none"} onOpenChange={o => { if (!o) closeSheet(); }} title={sheet === "progress" && progressWork?.status === "done" ? "补充结果" : ({ none: "", filter: "筛选事项", sort: "排序方式", menu: "更多功能", "item-menu": "事项操作", status: "选择状态", tag: "选择分类", date: "选择日期", progress: "记进展", delete: "移入回收站", export: "导出记录", "record-child":"选择子任务" })[sheet]} description={sheet === "progress" ? progressWork?.title : ({none:"",filter:"组合条件，找到需要处理的工作。",sort:"选择工作台的排列顺序。",menu:"整理事项，或管理自己的记录。","item-menu":"内容与历史都保存在这件工作中。",status:"选择这次记录对应的工作状态。",tag:"分类用于查找，不影响时间归档。",date:"按实际发生日期记录和回看。",delete:"删除后仍可找回完整历史。",export:"保存一份当前时段的工作记录。","record-child":""})[sheet]} snap={sheet === "progress" ? 0.72 : sheet === "date" ? 0.78 : sheet === "filter" ? 0.7 : 0.55}>
      <IconButton label="关闭面板" className="sheet-close" onClick={closeSheet}><X size={21} /></IconButton>
      {sheet==="record-child"&&active&&<div className="record-child-viewport"><MobileScroll className="record-child-scroll"><div className="menu-list record-child-options" role="group" aria-label="选择要查看的子任务">
        <button className="menu-item" aria-pressed={!detailScope.childId} onClick={()=>{selectRecordScope({kind:"children"});closeSheet();}}><ListChecks size={21}/><span><strong>全部子任务</strong><small>{active.entries.filter(e=>!!e.subtaskId).length} 条记录</small></span>{!detailScope.childId&&<Check size={19} className="blue"/>}</button>
        {(active.subtasks??[]).map(child=><button key={child.id} className="menu-item" aria-pressed={detailScope.childId===child.id} onClick={()=>{selectRecordScope({kind:"children",childId:child.id});closeSheet();}}><span className={"work-status-dot "+child.status}/><span><strong>{child.title}</strong><small>{active.entries.filter(e=>e.subtaskId===child.id).length} 条记录</small></span>{detailScope.childId===child.id&&<Check size={19} className="blue"/>}</button>)}
      </div></MobileScroll></div>}
      {sheet === "filter" && <div className="filter-layout"><div className="filter-scroll-viewport"><MobileScroll className="filter-scroll"><div className="filter-panel">{[["状态", "status", [["all","全部"],["todo","未开始"],["doing","进行中"],["done","已完成"],["today-done","今日完成"]]],["分类", "tag", [["all","全部"],...categoryUI.categories.map(t => [t.name,t.name])]],["更新时间", "date", [["all","不限"],["today","今天"],["week","本周"],["month","本月"]]]].map(([title,key,opts]) => <section className="filter-section" key={String(key)}><h3>{String(title)}</h3><div className="option-grid">{(opts as string[][]).map(([value,label]) => <button key={value} className={pendingFilter[key as keyof Filter] === value ? "selected" : ""} onClick={() => setPendingFilter(f => ({ ...f, [String(key)]: value }))}>{label}</button>)}</div></section>)}</div></MobileScroll></div><div className="sheet-button-row"><button className="secondary-button" onClick={() => setPendingFilter(EMPTY_FILTER)}>重置</button><button className="primary-button" onClick={() => { setFilter(pendingFilter); closeSheet(); }}>应用筛选</button></div></div>}
      {sheet === "sort" && <div className="menu-list">{[["recent","最近更新","最近推进的工作排在前面"],["created","最近创建","按事项建立时间排列"],["title","按名称","按事项名称排列"]].map(([value,label,desc]) => <button className="menu-item" key={value} onClick={() => { setSort(value); closeSheet(); }}><span><strong>{label}</strong><small>{desc}</small></span>{sort === value && <Check size={21} className="blue" />}</button>)}</div>}
      {sheet === "menu" && <div className="menu-list"><button className="menu-item" onClick={() => { setSelection([]); closeSheet(); }}><CheckSquare size={23} /><span>批量管理</span><CaretRight size={17} /></button><button className="menu-item" onClick={() => push({ name: "data" })}><DownloadSimple size={23} /><span>数据与备份</span><CaretRight size={17} /></button><button className="menu-item" onClick={() => push({ name: "trash" })}><Trash size={23} /><span>回收站</span><CaretRight size={17} /></button></div>}
      {sheet === "item-menu" && active && <div className="menu-list"><button className="menu-item" onClick={openEdit}><PencilSimple size={22} /><span>编辑事项</span><CaretRight size={16} /></button><button className="menu-item" onClick={() => selectField("status","item")}><CheckCircle size={22} /><span>更改状态</span><CaretRight size={16} /></button><button className="menu-item" onClick={() => { commit(items.map(i => i.id === active.id ? { ...i, cancelled: true } : i), "已取消跟进，可在数据页找回"); back(); }}><ArrowCounterClockwise size={22} /><span>取消跟进</span></button><button className="menu-item danger" onClick={() => { setDeleteIds([active.id]); openSheet("delete"); }}><Trash size={22} /><span>删除事项</span></button></div>}
      {sheet === "status" && <div className="menu-list">{(["todo","doing","done"] as Status[]).map(s => <button key={s} className="menu-item" onClick={() => { if (fieldTarget === "item" && active) { changeState([active.id],s); return; } if (fieldTarget === "progress") setProgress(p => ({ ...p, status:s })); else setDraft(d => ({ ...d,status:s })); returnFromField(); }}><span><strong>{LABEL[s]}</strong><small>{s === "todo" ? "记下来，之后处理" : s === "doing" ? "已开始，持续记录进展" : "事情做完了，保存完成记录"}</small></span>{(fieldTarget === "item" ? active?.status : fieldTarget === "progress" ? progress.status : draft.status) === s && <Check size={21} className="blue" />}</button>)}</div>}
      {sheet === "tag" && <div className="category-select-viewport"><MobileScroll className="category-select-scroll"><div className="menu-list">{categoryUI.categories.map(category => {const t=category.name;return <button className="menu-item" key={category.id} onClick={() => { if (fieldTarget === "batch" && selection) { commit(items.map(i => selection.includes(i.id) ? { ...i,tag:t } : i), "分类已更新"); setSelection(null); } else setDraft(d => ({ ...d,tag:t })); returnFromField(); }}><span className="category-option-icon" style={{color:category.color}}><CategoryGlyph category={category}/></span><span>{t}</span>{draft.tag === t && <Check size={18} className="blue" />}</button>;})}</div></MobileScroll></div>}
      {sheet === "date" && <div className="date-picker"><Calendar selected={selectedDate} onSelect={updateDate} future={fieldTarget === "timeline"} />{fieldTarget !== "timeline" && <div className="time-field"><span>发生时间</span><div><select aria-label="小时" value={(fieldTarget === "progress" ? progress.time : draft.time).slice(0,2)} onChange={e => { const update = fieldTarget === "progress" ? setProgress : setDraft; update(d => ({ ...d,time:e.target.value + d.time.slice(2) })); }}>{Array.from({length:24},(_,i) => String(i).padStart(2,"0")).map(h => <option key={h}>{h}</option>)}</select><span>:</span><select aria-label="分钟" value={(fieldTarget === "progress" ? progress.time : draft.time).slice(3)} onChange={e => { const update = fieldTarget === "progress" ? setProgress : setDraft; update(d => ({ ...d,time:d.time.slice(0,3) + e.target.value })); }}>{Array.from({length:60},(_,i) => String(i).padStart(2,"0")).map(m => <option key={m}>{m}</option>)}</select></div></div>}<div className="sheet-button-row"><button className="secondary-button" onClick={() => updateDate(TODAY)}>今天</button><button className="primary-button" onClick={returnFromField}>确定日期</button></div></div>}
      {sheet === "progress" && progressWork && <div className="progress-panel"><div className="progress-last">上次：{lastEntry(progressWork)?.text}</div><KeyboardTextarea className="progress-input" aria-label="本次进展" placeholder={progressWork.status === "done" ? "补充交付结果、反馈或备注…" : "这次推进了什么？"} value={progress.text} onChange={e => setProgress(p => ({ ...p,text:e.target.value }))} rows={4} /><div className="progress-editor-tools"><span>{progress.text.length} 字 · 追加记录</span><button onClick={() => push({ name:"editor",mode:"progress",id:progressWork.id })}><ArrowsOutSimple size={16} />展开编辑</button></div><div className="editor-options">{dateField(progress.date,"progress","progress")}{statusField(progress.status,"progress","progress")}</div><button className="primary-button full-width" disabled={!progress.text.trim()} onClick={saveProgress}>{progressWork.status === "done" ? "保存结果" : "保存进展"}</button></div>}
      {sheet === "delete" && <div className="confirm-panel"><p>将 {deleteIds.length} 个事项移入回收站？</p><p className="subtle">事项及全部进展会一起保留，可随时恢复。</p><div className="sheet-button-row"><button className="secondary-button" onClick={closeSheet}>取消</button><button className="danger-button" onClick={removeItems}>移入回收站</button></div></div>}
      {sheet === "export" && <div className="export-panel"><p className="subtle">{rangeStart} — {rangeEnd}</p><h3>{periodEvents.length} 条记录，按发生时间整理</h3><p>导出事项名称、进展内容和发生时间，方便留存与整理。</p><button className="primary-button full-width" onClick={exportText}><DownloadSimple size={19} />导出文本记录</button></div>}
    </BottomSheet>
    {toast&&<div className="app-toast" role="status" onMouseEnter={()=>setToastPaused(true)} onMouseLeave={()=>setToastPaused(false)} onFocusCapture={()=>setToastPaused(true)} onBlurCapture={()=>setToastPaused(false)} style={{bottom:bottomInset+(quickExpanded?320:page.name==="home"||page.name==="todo"||page.name==="timeline"?154:84)}}><CheckCircle size={18}/><span>{toast.text}</span>{toast.before&&<button onClick={()=>{setItems(toast.before!);if(toast.beforeCategories){categoryUI.restore(toast.beforeCategories);setRestoreMessage("已撤销本次恢复");}if(page.name==="detail"&&!toast.before!.some(w=>w.id===page.id))back();setToastPaused(false);setToast({text:"已撤销"});}}>撤销</button>}</div>}
  </div></>}</CategoryWorkspace>;
}
