import type {Node as PMNode} from 'prosemirror-model';
import {NodeSelection} from 'prosemirror-state';
import type {EditorView,NodeView} from 'prosemirror-view';

export function createDocFloatingView(node:PMNode,view:EditorView,getPos:()=>number|undefined,assetUrl:(id:string)=>string,canGesture:()=>boolean):NodeView {
 const dom=document.createElement('span');dom.className='doc-floating-anchor';dom.contentEditable='false';
 const box=document.createElement('span');box.className='doc-floating-box';dom.append(box);
 const image=document.createElement('img'),text=document.createElement('span');text.className='doc-floating-text';
 const resize=document.createElement('button');resize.type='button';resize.className='doc-floating-resize';resize.ariaLabel='缩放浮动对象';resize.textContent='↘';
 let current=node,selected=false,destroyed=false,cleanup:()=>void=()=>{};
 const paint=(attrs=current.attrs)=>{
  dom.dataset.docFloatId=String(attrs.id);dom.dataset.kind=current.type.name;box.style.width=`${attrs.width}px`;box.style.height=`${attrs.height}px`;box.style.left=`${attrs.x}px`;box.style.top=`${attrs.y}px`;box.style.transform=`rotate(${attrs.rotation}deg)`;
  dom.style.display=attrs.wrap==='topBottom'?'block':'inline-block';const angle=attrs.rotation*Math.PI/180,bounds=Math.abs(Math.sin(angle))*attrs.width+Math.abs(Math.cos(angle))*attrs.height;dom.style.height=attrs.wrap==='topBottom'?`${Math.max(0,attrs.y+(attrs.height+bounds)/2)}px`:'0px';dom.style.width=attrs.wrap==='topBottom'?'100%':'0px';dom.style.position='static';
  // The containing paragraph is the vertical anchor; x is relative to the body's column.
  const paragraph=dom.closest('p,h1,h2,h3,h4,h5,h6') as HTMLElement|null;const surface=view.dom.getBoundingClientRect(),parent=paragraph?.getBoundingClientRect();const scale=view.dom.clientWidth?surface.width/view.dom.clientWidth:1;
  if(parent&&scale>0)box.style.left=`${attrs.x+(surface.left-parent.left)/scale}px`;
  box.classList.toggle('selected',selected);box.classList.toggle('locked',attrs.locked);
  if(current.type.name==='floating_image'){image.src=assetUrl(String(attrs.assetId));image.alt=String(attrs.alt);image.draggable=false;image.style.width='100%';image.style.height='100%';image.style.objectFit='contain';box.replaceChildren(image,resize);}
  else{text.textContent=String(attrs.text);text.style.fontSize=`${attrs.fontSize}px`;text.style.fontFamily=String(attrs.fontFamily);text.style.color=String(attrs.color);box.style.background=String(attrs.fill);box.style.border=`${attrs.strokeWidth}px solid ${attrs.stroke}`;box.style.borderRadius=attrs.shape==='ellipse'?'50%':'0';box.replaceChildren(text,resize);}
  resize.hidden=!selected||!!attrs.locked;
 };
 const down=(event:PointerEvent)=>{
  if(event.button!==0||destroyed||!view.editable||!canGesture())return;
  event.preventDefault();event.stopPropagation();const at=getPos();if(at===undefined)return;view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc,at)));view.focus();if(current.attrs.locked)return;
  cleanup();const original={...current.attrs},start={x:event.clientX,y:event.clientY},scale=view.dom.getBoundingClientRect().width/view.dom.clientWidth||1,mode=event.target===resize?'resize':'move';let preview={...original};
  const move=(e:PointerEvent)=>{if(destroyed||!view.editable){cancel();return;}const dx=(e.clientX-start.x)/scale,dy=(e.clientY-start.y)/scale;if(mode==='move')preview={...original,x:original.x+dx,y:original.y+dy};else{const angle=original.rotation*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle),dw=c*dx+s*dy,dh=-s*dx+c*dy;const width=Math.max(20,Math.min(5000,original.width+dw)),height=Math.max(20,Math.min(5000,original.height+dh)),w=width-original.width,h=height-original.height;preview={...original,width,height,x:original.x+((c-1)*w-s*h)/2,y:original.y+(s*w+(c-1)*h)/2};}paint(preview);};
  const cancel=()=>{cleanup();paint();};
  const up=()=>{cleanup();if(destroyed||!view.editable)return;const pos=getPos();if(pos===undefined||JSON.stringify(current.attrs)!==JSON.stringify(original)){paint();return;}if(JSON.stringify(preview)!==JSON.stringify(original)){const tr=view.state.tr.setNodeMarkup(pos,undefined,preview);tr.setSelection(NodeSelection.create(tr.doc,pos));view.dispatch(tr);}paint();};
  const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();cancel();}};
  window.addEventListener('pointermove',move);window.addEventListener('pointerup',up,{once:true});window.addEventListener('pointercancel',cancel,{once:true});window.addEventListener('keydown',key);
  cleanup=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);window.removeEventListener('pointercancel',cancel);window.removeEventListener('keydown',key);cleanup=()=>{};};
 };
 box.addEventListener('pointerdown',down);paint();queueMicrotask(()=>{if(!destroyed)paint();});
 return {dom,update(next){if(next.type!==current.type)return false;if(JSON.stringify(next.attrs)!==JSON.stringify(current.attrs))cleanup();current=next;paint();return true;},selectNode(){selected=true;paint();},deselectNode(){selected=false;paint();},stopEvent:event=>event.type.startsWith('pointer')||event.type==='click'||event.type==='dragstart',ignoreMutation:()=>true,destroy(){destroyed=true;cleanup();box.removeEventListener('pointerdown',down);}};
}
