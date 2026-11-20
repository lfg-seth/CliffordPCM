import { defaultFixtures, projectFixture, resizeLens, isLens, clamp } from './viewer-geometry.js';
export { defaultFixtures };

function studio(ctx,w,h) {
  const sky=ctx.createRadialGradient(w*.48,h*.4,0,w*.48,h*.4,w*.72);
  sky.addColorStop(0,'#545858');
  sky.addColorStop(.6,'#3b4141');
  sky.addColorStop(1,'#282e2e');
  ctx.fillStyle=sky;
  ctx.fillRect(0,0,w,h);
  const horizon=h*.58;
  const fade=ctx.createLinearGradient(0,horizon,0,h);
  fade.addColorStop(0,'rgba(203,212,208,0)');
  fade.addColorStop(1,'rgba(203,212,208,.10)');
  ctx.strokeStyle=fade;
  ctx.lineWidth=.7;
  ctx.beginPath();
  for (let i=-18;i<=18;i++) {
    ctx.moveTo(w*.5+i*w*.033,horizon);
    ctx.lineTo(w*.5+i*w*.135,h);
  }
  for (const t of [.04,.11,.21,.35,.55,.82]) {
    ctx.moveTo(0,horizon+(h-horizon)*t);
    ctx.lineTo(w,horizon+(h-horizon)*t);
  }
  ctx.stroke();
}

function drawHaze(ctx,w,h,lit,chaseColors,reach,intensity) {
  const padding=clamp(Math.min(w,h)*.55,2.5,5)*reach;
  // Canvas blur uses bitmap pixels. Scale it with the photo, including zoom and display density.
  const transform=ctx.getTransform();
  const pixelScale=Math.hypot(transform.a,transform.b);
  ctx.save();
  ctx.filter='blur('+padding*1.5*pixelScale+'px)';
  const opacity=.78*(lit.level??1);
  ctx.globalAlpha=opacity*Math.min(intensity,1);
  ctx.fillStyle=lit.color;
  if (chaseColors.length>1) {
    const strip=ctx.createLinearGradient(-w/2,0,w/2,0);
    for (let i=0;i<7;i++) strip.addColorStop(i/6,chaseColors[i%chaseColors.length]);
    ctx.fillStyle=strip;
  }
  ctx.beginPath();
  ctx.roundRect(-w/2-padding,-h/2-padding,w+2*padding,h+2*padding,padding);
  ctx.fill();
  if (intensity>1) {
    ctx.globalCompositeOperation='screen';
    ctx.globalAlpha=opacity*(intensity-1);
    ctx.fill();
  }
  ctx.restore();
}

function drawLamp(ctx,f,p,active,selected,{placement,hazeReach,hazeIntensity}) {
  const lit=active[0];
  const chaseColors=f.kind==='chase' ? [...new Set(active.map(l=>l.color))] : [];
  const {x,y,w,h,tilt}=p;
  ctx.save();
  ctx.translate(x,y);
  ctx.rotate(tilt);
  const lens=isLens(f);
  if (lit && hazeReach>0 && hazeIntensity>0) drawHaze(ctx,w,h,lit,chaseColors,hazeReach,hazeIntensity);
  // The photographed factory lenses already provide an unlit appearance.
  if (!lens || lit) {
    const r=Math.min(w,h)*(f.kind==='pod'?.23:.15);
    ctx.beginPath();
    if (f.kind==='round') ctx.ellipse(0,0,w/2,h/2,0,0,Math.PI*2);
    else ctx.roundRect(-w/2,-h/2,w,h,r);
    if (!lens) {
      ctx.strokeStyle='#191e20'; ctx.lineWidth=Math.min(1.35,h*.23); ctx.stroke();
    }
    const halogen=lit?.bulb==='halogen';
    const glass=halogen
      ? ctx.createRadialGradient(0,-h*.08,0,0,0,Math.max(w,h)*.6)
      : ctx.createLinearGradient(0,-h/2,0,h/2);
    if (lit) {
      if (halogen) {
        glass.addColorStop(0,'#fff0d5');glass.addColorStop(.36,'#ffe0ad');glass.addColorStop(1,lit.color);
      } else if (chaseColors.length>1) {
        glass.addColorStop(0,'#c2b5a4');glass.addColorStop(.55,'#817566');glass.addColorStop(1,'#595650');
      } else {
        glass.addColorStop(0,lit.color);glass.addColorStop(.36,'#fff8df');glass.addColorStop(1,lit.color);
      }
      ctx.globalAlpha=halogen ? lit.level : .47+.53*(lit.level??1);
    } else {
      glass.addColorStop(0,'#a0a6ab'); glass.addColorStop(.3,'#5d6265');
      glass.addColorStop(.64,'#333a3f'); glass.addColorStop(1,'#767d80');
    }
    ctx.fillStyle=glass; ctx.fill();
    if (!lens) {
      const count=f.kind==='bar'?Math.min(25,Math.round(w/2.5)):f.kind==='chase'?7:f.kind==='pod'?2:Math.max(1,Math.floor(w/h));
      const rows=f.kind==='pod'?2:1;
      ctx.fillStyle=lit?'#fffcf1':'#b6bec0';
      ctx.globalAlpha=lit ? .92 : .58;
      const cw=w/(count+.6),ch=h/(rows+.6);
      for (let j=0;j<rows;j++) for (let i=0;i<count;i++) {
        if (chaseColors.length>1) ctx.fillStyle=chaseColors[i%chaseColors.length];
        ctx.beginPath();
        ctx.ellipse(-w*.5+cw*(i+.8),-h*.5+ch*(j+.8),cw*.27,ch*.28,0,0,Math.PI*2);
        ctx.fill();
      }
    }
  }
  ctx.globalAlpha=1;
  if (selected) {
    const hw=w/2+2.7,hh=h/2+2.7,cap=Math.min(hw,hh,3.8);
    ctx.strokeStyle='#ffc382'; ctx.lineWidth=1;
    ctx.beginPath();
    for (const sx of [-1,1]) for (const sy of [-1,1]) {
      ctx.moveTo(sx*(hw-cap),sy*hh); ctx.lineTo(sx*hw,sy*hh);ctx.lineTo(sx*hw,sy*(hh-cap));
    }
    ctx.stroke();
  } else if (placement) {
    ctx.setLineDash([1.3,1.3]); ctx.lineWidth=.65; ctx.strokeStyle='rgba(255,225,189,.85)';
    ctx.strokeRect(-w/2-1.2,-h/2-1.2,w+2.4,h+2.4);
  }
  ctx.restore();
}

const centers=[
  [[250,147],[224,150],[239,144],[250,143],[262,142],[274,140],[250,140]],
  [[250,143],[226,146],[240,140],[250,139],[262,141],[276,148],[250,148]]
];

function drawResizeHandles(ctx,p,scale) {
  // Leave room between the center move target and the four corner targets,
  // even for a small lens viewed edge-on. Handles keep their size while zooming.
  const margin=5/scale, halfWidth=p.w/2+margin, halfHeight=p.h/2+margin;
  const side=6/scale, cosine=Math.cos(p.tilt), sine=Math.sin(p.tilt);
  const handles=[];
  ctx.save();
  ctx.translate(p.x,p.y);
  ctx.rotate(p.tilt);
  ctx.strokeStyle='#ffbd76';
  ctx.fillStyle='#26221d';
  ctx.lineWidth=1/scale;
  ctx.strokeRect(-halfWidth,-halfHeight,halfWidth*2,halfHeight*2);
  for (const sx of [-1,1]) for (const sy of [-1,1]) {
    const x=sx*halfWidth, y=sy*halfHeight;
    ctx.fillRect(x-side/2,y-side/2,side,side);
    ctx.strokeRect(x-side/2,y-side/2,side,side);
    handles.push({id:p.id,sx,sy,x:p.x+cosine*x-sine*y,y:p.y+sine*x+cosine*y,
      cursor:(cosine*sx-sine*sy)*(sine*sx+cosine*sy)>=0?'nwse-resize':'nesw-resize'});
  }
  ctx.restore();
  return handles;
}

// Model a short thermal response in pattern time. Reversing a pulse starts at
// the filament's current brightness, including while the camera faces away.
function filamentLevel(filament,now) {
  if (filament.fadeMs===0) return filament.target;
  const elapsed=Math.max(0,now-filament.start)*filament.speed;
  // Three time constants cover about 95% of the brightness change.
  const remaining=(filament.from-filament.target)*Math.exp(-3*elapsed/filament.fadeMs);
  return Math.abs(remaining)<.005 ? filament.target : filament.target+remaining;
}

export function createViewer(canvas,{onView,onSelect,onEdit}={}) {
  const ctx=canvas.getContext('2d');
  let heading=1,ring=0,zoomFactor=1,raf=0,drag=null,hover=null,hitList=[];
  let handles=[];
  let transform={s:1,left:0,top:0};
  let state={fixtures:[],active:new Set(),selected:null,selectedCircuit:null,placement:false,
    hazeReach:1,hazeIntensity:1,fadeOnMs:54,fadeOffMs:72,speed:1};
  const filaments=new Map();
  const images=new Map();
  const frameKey=(a,b)=>a+':'+b;
  function schedule() {
    if (!raf) raf=requestAnimationFrame(render);
  }
  function load(r,h) {
    const key=frameKey(r,h);
    if (!images.has(key)) {
      const im=new Image();
      im.onload=schedule;
      im.onerror=schedule;
      im.src='/assets/orbit-'+r+'-'+String(h).padStart(2,'0')+'.webp';
      images.set(key,im);
    }
    return images.get(key);
  }
  function render(now) {
    raf=0;
    const w=canvas.clientWidth,h=canvas.clientHeight;
    if (!w||!h) return;
    const dpr=Math.min(window.devicePixelRatio||1,2.5);
    if (canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)) {
      canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);
    }
    ctx.setTransform(dpr,0,0,dpr,0,0);studio(ctx,w,h);
    const im=load(ring,heading);
    hitList=[];
    handles=[];
    if (!im.complete||!im.naturalWidth) {
      ctx.fillStyle='#c5ceca';ctx.font='13px system-ui';ctx.textAlign='center';
      ctx.fillText(im.complete?'Vehicle image unavailable':'Loading vehicle…',w/2,h/2);
      return;
    }
    const [cx,cy]=centers[ring][Math.min(heading,12-heading)];
    const s=Math.min(w/487,h/251)*zoomFactor;
    const left=w/2-(heading>6?500-cx:cx)*s,top=h*.50-cy*s;
    transform={s,left,top};
    ctx.translate(left,top); ctx.scale(s,s);
    ctx.drawImage(im,0,0,500,300);
    let selectedLens=null;
    for (const source of state.fixtures) {
      const f=drag?.patch && source.id===drag.id?{...source,...drag.patch}:source;
      const p=projectFixture(f,heading,ring);
      if (!p) continue;
      let active=f.lamps.filter(l=>state.active.has(l.circuit)).sort((a,b)=>(b.level??1)-(a.level??1));
      const filament=filaments.get(f.id);
      if (filament) {
        const level=filamentLevel(filament,now);
        active=level>0 ? [{...f.lamps[0],level}] : [];
        if (level!==filament.target) schedule();
      }
      const selected=state.selected===f.id || f.lamps.some(l=>l.circuit && l.circuit===state.selectedCircuit);
      drawLamp(ctx,f,p,active,selected || hover===f.id,state);
      const box={id:f.id,...p};
      hitList.push(box);
      if (state.placement && state.selected===f.id && isLens(f)) selectedLens=box;
    }
    if (selectedLens) handles=drawResizeHandles(ctx,selectedLens,s);
  }
  function setView(newHeading,newRing) {
    if (drag && drag.mode!=='orbit') {
      if (canvas.hasPointerCapture(drag.pointer)) canvas.releasePointerCapture(drag.pointer);
      drag=null;
    }
    hitList=[]; handles=[];
    heading=((Math.round(newHeading)%12)+12)%12;
    ring=newRing?1:0;
    hover=null;
    schedule();
    onView?.({heading,ring});
    load(ring,heading);
    load(ring,(heading+1)%12);
    load(ring,(heading+11)%12);
  }
  function pointer(e) {
    const r=canvas.getBoundingClientRect(),{s,left,top}=transform;
    return [(e.clientX-r.left-left)/s,(e.clientY-r.top-top)/s];
  }
  function hit(x,y) {
    let id=null,best=Infinity;
    for (const p of hitList) {
      const dx=Math.abs(x-p.x),dy=Math.abs(y-p.y);
      if (dx>Math.max(4.3,p.w/2+2.7)||dy>Math.max(4.3,p.h/2+2.7)) continue;
      const score=Math.hypot(Math.max(0,dx-p.w/2),Math.max(0,dy-p.h/2))+.012*(dx+dy);
      if (score<best || (score===best && state.placement && p.id===state.selected)) {id=p.id;best=score;}
    }
    return id;
  }
  function hitCorner(x,y) {
    if (!state.placement) return null;
    return handles.find(h=>h.id===state.selected && Math.hypot(x-h.x,y-h.y)<=5/transform.s);
  }
  canvas.addEventListener('pointerdown',e=>{
    if (e.button!==0||drag) return;
    const [x,y]=pointer(e),corner=hitCorner(x,y),id=corner?.id??hit(x,y);
    canvas.focus({preventScroll:true});
    const f=state.fixtures.find(item=>item.id===id);
    const p=f?projectFixture(f,heading,ring):null;
    const mode=corner?'resize':state.placement&&p?'place':'orbit';
    drag={pointer:e.pointerId,id,heading,view:frameKey(ring,heading),x:e.clientX,y:e.clientY,f,p,mode,corner,
      start:[x,y],moved:false,patch:null};
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove',e=>{
    const [x,y]=pointer(e);
    if (!drag) {
      const corner=hitCorner(x,y),id=corner?.id??hit(x,y);
      canvas.style.cursor=corner?.cursor || (id?(state.placement?'move':'pointer'):'grab');
      if (hover!==id) {
        hover=id;
        canvas.title=state.fixtures.find(f=>f.id===id)?.label||'';
        schedule();
      }
      return;
    }
    updateDrag(e,x,y);
  });
  function updateDrag(e,x,y) {
    if (e.pointerId!==drag.pointer) return;
    const dx=e.clientX-drag.x,dy=e.clientY-drag.y;
    if (Math.hypot(dx,dy)>(drag.mode==='orbit'?4:1)) drag.moved=true;
    if (!drag.moved) return;
    if (drag.mode==='orbit') {
      const next=(drag.heading-Math.round(dx/Math.max(25,canvas.clientWidth/13))+120)%12;
      if (next!==heading) setView(next,ring);
    } else {
      const mx=x-drag.start[0],my=y-drag.start[1];
      if (drag.mode==='resize') {
        const box=resizeLens(drag.p,drag.corner,mx,my);
        drag.patch={
          corrections:{...drag.f.corrections,[drag.view]:[box.x/500,box.y/300]},
          viewSizes:{...drag.f.viewSizes,[drag.view]:[box.w/500,box.h/300]}
        };
      } else {
        drag.patch={corrections:{...drag.f.corrections,
          [drag.view]:[clamp((drag.p.x+mx)/500,0,1),clamp((drag.p.y+my)/300,0,1)]}};
      }
      schedule();
    }
  }
  canvas.addEventListener('pointerup',e=>{
    if (!drag||drag.pointer!==e.pointerId) return;
    updateDrag(e,...pointer(e));
    const finished=drag;drag=null;
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    if (finished.patch) onEdit?.(finished.id,finished.patch);
    if (finished.id&&(!finished.moved||finished.patch)) onSelect?.(finished.id);
    schedule();
  });
  canvas.addEventListener('pointercancel',()=>{drag=null;schedule();});
  canvas.addEventListener('pointerleave',()=>{hover=null;schedule();});
  canvas.addEventListener('keydown',e=>{
    if (e.key==='ArrowLeft'||e.key==='ArrowRight') {
      e.preventDefault();setView(heading+(e.key==='ArrowLeft'?-1:1),ring);
    } else if (e.key==='ArrowUp'||e.key==='ArrowDown') {
      e.preventDefault();setView(heading,e.key==='ArrowUp'?1:0);
    }
  });
  new ResizeObserver(schedule).observe(canvas);
  setView(heading,ring);
  // Decode neighboring views first so dragging is immediately responsive.
  for (let i=0;i<12;i++) {load(0,i);load(1,i);}
  return {
    setState(patch) {
      state={...state,...patch};
      if (patch.active) state.active=new Set(patch.active);
      if (patch.active || patch.fixtures || 'speed' in patch || 'fadeOnMs' in patch || 'fadeOffMs' in patch) {
        const now=performance.now();
        for (const f of state.fixtures) {
          const lamp=f.lamps[0];
          if (lamp?.bulb!=='halogen') continue;
          const target=state.active.has(lamp.circuit) ? (lamp.level??1) : 0;
          const fadeMs=target ? state.fadeOnMs : state.fadeOffMs;
          const previous=filaments.get(f.id);
          if (previous?.target===target && previous.speed===state.speed && previous.fadeMs===fadeMs) continue;
          const from=previous ? filamentLevel(previous,now) : 0;
          filaments.set(f.id,{from,target,start:now,speed:state.speed,fadeMs});
        }
      }
      schedule();
    },
    setView,rotate:delta=>setView(heading+delta,ring),
    zoom(factor) {zoomFactor=clamp(zoomFactor*factor,.65,2.3);schedule();},
    resetZoom() {zoomFactor=1;schedule();}
  };
}


