import { boardName, colors, cycleDuration } from './editor.js';
import { moveMount } from './viewer-geometry.js';

const byId = id => document.getElementById(id);
const pad = n => String(n).padStart(2,'0');
const nodeOptions = [['engine','Engine bay'],['cargo','Cargo bay']];

function el(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text != null) element.textContent = text;
  return element;
}
function div(className,...children) {
  const result = el('div',className);
  result.append(...children.filter(Boolean));
  return result;
}
function button(text,action,opts={}) {
  const b = el('button',opts.className ?? 'ed-button',text);
  b.type='button';
  if (opts.title) b.title=opts.title;
  b.disabled=Boolean(opts.disabled);
  b.onclick=action;
  return b;
}
function select(label,options,selected,onChange) {
  const s=el('select','ed-select');
  s.setAttribute('aria-label',label);
  for (const [key,text,disabled] of options) {
    const option=el('option',null,text);
    option.value=key;
    option.disabled=Boolean(disabled);
    s.append(option);
  }
  s.value=selected ?? '';
  s.onchange=()=>onChange(s.value);
  return s;
}
function field(name,input) {
  const label=el('label','ed-field');
  label.append(el('span',null,name),input);
  return label;
}
function pane(title,...actions) {
  return div('ed-section', div('ed-section-head',el('h2',null,title),div('ed-actions',...actions)));
}
function empty(text) { return el('p','ed-empty',text); }
function swatch(color) { const dot=el('i','ed-swatch');dot.style.backgroundColor=color;return dot; }
function preferredColor(editor,id) {
  for (const f of editor.fixtures) {
    const lamp = f.lamps.find(l=>l.circuit===id);
    if (lamp?.color) return lamp.color;
  }
  return '#c2ccd2';
}
function circuitName(editor,id) { return editor.circuit(id)?.name || id; }
function lightRow(editor,id) {
  const c=editor.circuit(id);
  const row=button('',()=>editor.selectCircuit(id),{className:'ed-circuit-label'});
  row.append(swatch(preferredColor(editor,id)),el('span',null,c?.name||id),
    el('small',null,c?.channel ? 'CH '+pad(c.channel) : 'DRAFT'));
  return row;
}
let lastCol = null;
let gridColumns = [];
export function markStep(step) {
  if (lastCol===step) return;
  gridColumns[lastCol]?.forEach(cell=>cell.classList.remove('ed-now'));
  gridColumns[step]?.forEach(cell=>cell.classList.add('ed-now'));
  lastCol=step;
}
export function renderStepGrid(editor) {
  const host=byId('step-grid');
  if (!host) return;
  const pattern=editor.pattern;
  const circuits=editor.layout.circuits.filter(c=>c.node===editor.role && !c.accessory);
  const used=new Set([...pattern.steps.flatMap(s=>s.circuits), ...editor.extraRows]);
  if (editor.selectedCircuit && !editor.circuit(editor.selectedCircuit)?.accessory) used.add(editor.selectedCircuit);
  const rows=editor.allRows ? [...new Set([...circuits.map(c=>c.id),...used])] : [...used];
  rows.sort((a,b)=>(editor.circuit(a)?.channel ?? 99)-(editor.circuit(b)?.channel ?? 99));
  gridColumns=pattern.steps.map(()=>[]);lastCol=null;
  const table=el('table','ed-grid');
  table.style.setProperty('--steps',pattern.steps.length);
  table.setAttribute('aria-label','Pattern steps and circuit states');
  const head=table.createTHead().insertRow();
  const nameHeader=el('th','ed-grid-name','Circuit');
  nameHeader.scope='col';
  head.append(nameHeader);
  pattern.steps.forEach((s,i)=>{
    const th=el('th','ed-step-head');
    th.scope='col';
    const b=button(pad(i+1),()=>editor.setStep(i),{className:'ed-step-number',title:'Inspect step '+(i+1)});
    th.append(b);head.append(th);gridColumns[i].push(th);
  });
  const body=table.createTBody();
  rows.forEach(id=>{
    const row=body.insertRow();
    if(id===editor.selectedCircuit) row.className='ed-selected-row';
    const th=el('th');th.scope='row';th.append(lightRow(editor,id));row.append(th);
    pattern.steps.forEach((s,i)=>{
      const on=s.circuits.includes(id);
      const cell=row.insertCell();
      const name=circuitName(editor,id)+', step '+(i+1);
      const b=button('',()=>editor.toggleCell(i,id),{className:'ed-cell '+(on?'ed-on':''),title:name+' · '+(on?'On':'Off')});
      b.setAttribute('aria-label',name);
      b.setAttribute('aria-pressed',String(on));
      b.append(el('i','ed-cell-mark'));cell.append(b);gridColumns[i].push(cell);
    });
  });
  const durations=table.createTFoot().insertRow();
  durations.append(el('th','ed-duration-label','Duration (ms)'));
  pattern.steps.forEach((s,i)=>{
    const cell=durations.insertCell(), input=el('input','ed-duration');
    input.type='number';input.min='1';input.max='65535';input.step='1';input.value=s.duration;
    input.setAttribute('aria-label','Step '+(i+1)+' duration in milliseconds');
    input.onchange=()=>editor.setDuration(i,input.value);
    input.onkeydown=e=>{if(e.key==='Enter') input.blur();};
    cell.append(input);gridColumns[i].push(cell);
  });
  const hidden=circuits.filter(c=>!rows.includes(c.id));
  const add=select('Add circuit to grid',[['','+ Add circuit'],...hidden.map(c=>[c.id,c.name])],'',id=>{
    if(id) {editor.extraRows.add(id);editor.selectedCircuit=id;editor.refresh();}
  });
  add.classList.add('ed-add-row');
  add.disabled=!hidden.length;
  const all=button(editor.allRows?'Show pattern circuits':'Show all circuits',()=>{
    editor.allRows=!editor.allRows;editor.refresh();
  },{className:'ed-text'});
  const wrapper = div('ed-grid-scroll',table);
  const previousScroll = host.querySelector('.ed-grid-scroll')?.scrollLeft ?? 0;
  host.replaceChildren(wrapper,div('ed-grid-controls',add,all));
  wrapper.scrollLeft=previousScroll;
  markStep(editor.step);
}

function boardPanel(editor) {
  const card=pane('Running boards');
  const group=select('Running-board wiring groups',[
    ['single','One circuit per side'],['alternate','Odd / even per side'],['pairs','Front / rear pairs per side']
  ],editor.layout.boardMode,mode=>editor.setBoards(mode));
  const channels=div('ed-fields');
  for (const [id,{color,fixtures}] of editor.runningBoardGroups()) {
    const name=circuitName(editor,id).replace(/^(Driver|Passenger) board ([AB])$/, '$1 $2');
    const options=Object.entries(colors).map(([name,hex])=>[hex,name]);
    if (!options.some(([hex])=>hex===color)) {
      options.unshift(color ? [color,'Custom ('+color+')'] : ['','Mixed colors',true]);
    }
    const input=select(name+' color',options,color,hex=>editor.setBoardColor(id,hex));
    const heads=fixtures.map(f=>f.id.split('.'));
    const sameSide=heads.every(([,side])=>side===heads[0][1]);
    const numbers=heads.map(([,side,i])=>sameSide?i:side+' '+i).join(', ');
    const label=field(name,div('ed-board-color',swatch(color||'transparent'),input));
    label.append(el('small','ed-muted',(sameSide?heads[0][1]+' heads ':'Heads ')+numbers));
    channels.append(label);
  }
  card.append(div('ed-card-body',field('Output grouping',group),channels,
    empty('Heads are numbered front to rear. Each channel switches its chosen color on and off.')));
  return card;
}

function fixturePanel(editor) {
  const card=pane('Lamp placement',button('+ Add light',()=>editor.addFixture()));
  const fixtures=editor.fixtures;
  const id=editor.selectedFixture && editor.findFixture(editor.selectedFixture) ? editor.selectedFixture : fixtures[0]?.id;
  const f=editor.findFixture(id);
  const body=div('ed-card-body');
  card.append(body);
  if (!f) {body.append(empty('Add a light to start placing fixtures.')); return card;}
  const fixtureList=select('Fixture',fixtures.map(f=>[f.id,f.label]),f.id,id=>editor.selectFixture(id));
  const place=button('Adjust on vehicle',()=>{
    editor.selectFixture(f.id);
    editor.options.onPlace?.(f.id);
  });
  body.append(div('ed-flex',field('Fixture',fixtureList),place));
  f.lamps.forEach((lamp,i)=>{
    const opts=editor.layout.circuits.filter(c=>!c.accessory).map(c=>[c.id,boardName(c.node)+' · '+c.name]);
    if (!lamp.circuit) { body.append(empty('Factory signal'));return; }
    const s=select('Lamp '+(i+1)+' circuit',[...opts,['new','+ New independent circuit…']],lamp.circuit,id=>editor.bindLamp(f.id,i,id));
    const color=el('input','ed-color');
    color.type='color';color.value=/^#[\da-f]{6}$/i.test(lamp.color)?lamp.color:'#ffffff';
    color.title='Lamp color';color.setAttribute('aria-label',f.label+' lamp '+(i+1)+' color');
    color.onchange=()=>{
      if (f.id.startsWith('board.')) {
        editor.setBoardColor(lamp.circuit,color.value);
        return;
      }
      const lamps=structuredClone(f.lamps);lamps[i].color=color.value;
      editor.updateFixture(f.id,{lamps});
    };
    body.append(div('ed-flex',field(f.lamps.length===1?'Circuit':'Input '+(i+1)+' · '+(lamp.name||circuitName(editor,lamp.circuit)),s),field('Color',color)));
  });
  const details=el('details','ed-mount-details');
  details.open=Boolean(editor.mountOpen);
  const summary=el('summary',null,'Base mount & shape (all views)');
  details.append(summary);
  details.ontoggle=()=>{if(details.isConnected) editor.mountOpen=details.open;};
  const face=select('Mount side',['front','rear','driver','passenger'].map(v=>[v,v[0].toUpperCase()+v.slice(1)]),f.face,face=>{
    const [x,y,z]=f.anchor, a=[x,y,z];
    if (face==='front' || face==='rear') {a[1]=face==='front'?2.35:-2.35; a[0]=Math.max(-.8,Math.min(.8,x));}
    else {a[0]=face==='driver'?.94:-.94; a[1]=Math.max(-1.6,Math.min(1.6,y));}
    editor.updateFixture(f.id,{face,anchor:a,mount:null,corrections:{}});
  });
  const kinds=['pod','bar','surface','lens','chase'];
  if (!kinds.includes(f.kind)) kinds.push(f.kind);
  const kind=select('Fixture shape',kinds.map(k=>[k,k[0].toUpperCase()+k.slice(1)]),f.kind,kind=>editor.updateFixture(f.id,{kind}));
  details.append(div('ed-fields',field('Mount side',face),field('Shape',kind)));
  const coords=div('ed-coords');
  ['Lateral (m)','Fore / aft (m)','Height (m)','Width (m)','Lens height (m)'].forEach((name,i)=>{
    const input=el('input','ed-number'); input.type='number';input.step='0.01';
    input.value=i<3?f.anchor[i]:i===3?f.width:f.height;
    input.onchange=()=>{
      const n=input.valueAsNumber;
      if(!Number.isFinite(n)|| (i>=3 && n<=0)){editor.refresh();return;}
      if(i<3){const anchor=[...f.anchor];anchor[i]=n;editor.updateFixture(f.id,moveMount(f,anchor));}
      else editor.updateFixture(f.id,i===3?{width:n}:{height:n});
    };
    coords.append(field(name,input));
  });
  details.append(coords);
  body.append(details);
  if(f.custom) body.append(button('Remove light',()=>editor.removeFixture(f.id),{className:'ed-text'}));
  return card;
}

function bindingsPanel(editor) {
  const add=button('+ Circuit',()=>{
    const name=prompt('New circuit name','Proposed circuit')?.trim();
    if(!name)return;
    editor.addCircuit(name,editor.wireNode||editor.role);editor.changed();
  });
  const card=pane('Output assignments',add);
  const node=editor.wireNode||editor.role;
  const circuits=editor.layout.circuits.filter(c=>c.node===node).sort((a,b)=>(a.channel??99)-(b.channel??99));
  const count=circuits.filter(c=>c.channel).length;
  const nodeSelect=select('Filter assignments by board',nodeOptions,node,v=>{editor.wireNode=v;editor.refresh();});
  card.append(div('ed-filter',nodeSelect,el('span','ed-muted',count+' / 26 outputs assigned')));
  const table=el('table','ed-bindings'),head=table.createTHead().insertRow();
  ['Circuit','PCM board','Output'].forEach(t=>head.append(el('th',null,t)));
  const body=table.createTBody();
  circuits.forEach(c=>{
    const tr=body.insertRow();
    const name=tr.insertCell();
    name.append(div('ed-cname', swatch(c.accessory?'#89938c':preferredColor(editor,c.id)),el('span',null,c.name),
      c.accessory?el('small','ed-muted','Accessory'):null));
    const board=select(c.name+' board',nodeOptions,c.node,node=>{editor.wireNode=node;editor.assign(c.id,node,null);});
    const assignments=[['','Unassigned']];
    for(let i=1;i<=26;i++){
      const owner=editor.layout.circuits.find(o=>o.id!==c.id && o.node===node && o.channel===i);
      assignments.push([String(i),pad(i)+(owner?' · '+owner.name:''),Boolean(owner)]);
    }
    const channel=select(c.name+' output',assignments,String(c.channel??''),v=>editor.assign(c.id,node,v));
    tr.insertCell().append(board);tr.insertCell().append(channel);
  });
  card.append(div('ed-table-scroll',table));
  return card;
}

function renderWiring(editor,host) {
  const reference=editor.layout.id==='baseline';
  const actions=div('ed-actions',
    button('Duplicate layout',()=>editor.duplicateLayout()),
    button('Rename draft',()=>editor.renameLayout(),{disabled:reference}),
    button('Delete draft',()=>editor.deleteLayout(),{disabled:reference}));
  const header=div('ed-page-tools',el('span','ed-muted',editor.layout.name),actions);
  const panels=div('ed-wiring',div('ed-stack',boardPanel(editor),fixturePanel(editor)),bindingsPanel(editor));
  host.replaceChildren(header,panels);
}
function renderLibrary(editor,host) {
  const controls=div('ed-page-tools',el('span','ed-muted','Patterns are saved in this browser.'),button('+ New pattern',()=>{
    const current=editor.pattern.id;
    editor.newPattern();
    if (current!==editor.pattern.id) editor.options.onOpenStudio?.();
  }));
  const list=div('ed-library');
  for(const node of ['engine','cargo']){
    const group=pane(boardName(node));
    for(const p of editor.data.patterns.filter(p=>p.node===node)){
      const original=editor.baseline.patterns.some(b=>b.id===p.id);
      const bar=div('ed-mini-wave');
      p.steps.forEach(s=>{
        const segment=el('i',s.circuits.length?'ed-lit':'');
        segment.style.flexGrow=Math.min(s.duration,1000);
        bar.append(segment);
      });
      const open=()=>{editor.setPattern(p.id);editor.options.onOpenStudio?.();};
      const actions=div('ed-actions',button('Open',open));
      if(!original){
        actions.append(button('Rename',()=>{editor.setPattern(p.id);editor.renamePattern();},{className:'ed-text'}),
          button('Delete',()=>editor.deletePattern(p.id),{className:'ed-text'}));
      }
      const item=div('ed-library-row',div('ed-library-info',el('h3',null,p.name),
        el('small','ed-muted',(original?'Firmware preset':'Candidate')+' · '+p.steps.length+' steps · '+cycleDuration(p)+' ms cycle'),
        bar),actions);
      group.append(item);
    }
    list.append(group);
  }
  host.replaceChildren(controls,list);
}
function renderExport(editor,host) {
  const card=pane('Export configuration');
  const body=div('ed-card-body');
  body.append(field('Pattern',select('Pattern to export',editor.data.patterns.map(p=>[p.id,boardName(p.node)+' · '+p.name]),editor.pattern.id,id=>editor.setPattern(id))),
    field('Target slot',select('Target firmware slot',[['fast','Fast'],['slow','Slow']],editor.exportSlot||editor.pattern.slot,value=>{
      editor.exportSlot=value;editor.changed();
    })),div('ed-definition',el('span',null,'Wiring layout'),el('strong',null,editor.layout.name)),
    div('ed-definition',el('span',null,'PCM'),el('strong',null,boardName(editor.role))));
  const additional=el('details','ed-mount-details');
  additional.open=Boolean(editor.slotsOpen);
  additional.ontoggle=()=>{if(additional.isConnected) editor.slotsOpen=additional.open;};
  additional.append(el('summary',null,'Other firmware slots'));
  const fields=div('ed-extra-slots');
  for (const node of ['engine','cargo']) {
    for (const slot of ['fast','slow']) {
      if (node===editor.role && slot===(editor.exportSlot||editor.pattern.slot)) continue;
      const key=node+'.'+slot;
      const label=boardName(node)+' · '+slot;
      const options=[['','Keep firmware pattern'],...editor.data.patterns.filter(p=>p.node===node).map(p=>[p.id,p.name])];
      fields.append(field(label,select(label+' pattern',options,editor.slotPicks[key]||'',id=>{
        if (id) editor.slotPicks[key]=id; else delete editor.slotPicks[key];
        editor.changed();
      })));
    }
  }
  additional.append(fields);
  body.append(additional);
  const action=button(editor.pending?'Working…':'Review changes',()=>editor.requestExport(false),{className:'ed-primary',disabled:editor.pending});
  body.append(action);
  card.append(body);
  const summary=pane('Firmware changes');
  const details=div('ed-card-body');
  if(editor.statusMessage) details.append(el('p','ed-error',editor.statusMessage));
  if(editor.review){
    details.append(el('h3',null,editor.pattern.name+' → '+(editor.exportSlot||editor.pattern.slot)+' slot'));
    for(const [key,p] of Object.entries(editor.exportPayload().slotPatterns)) {
      details.append(el('p','ed-route',p.name+' → '+key+' slot'));
    }
    const changes=editor.review.changes??[];
    if (changes.length) {
      const table=el('table','ed-changes'),head=table.createTHead().insertRow();
      ['Circuit','Current','Proposed'].forEach(t=>head.append(el('th',null,t)));
      const body=table.createTBody();
      for(const change of changes){
        const row=body.insertRow();
        [change.name??change.id,change.before,change.after].forEach(v=>row.insertCell().textContent=v);
      }
      details.append(div('ed-table-scroll',table));
    } else details.append(empty('Output assignments match the firmware baseline.'));
    const routes=Object.entries(editor.routes());
    if(routes.length) {
      details.append(el('h3',null,'Regrouped controls'));
      for(const [origin,ids] of routes) details.append(el('p','ed-route',circuitName(editor,origin)+' → '+ids.map(id=>circuitName(editor,id)).join(' + ')));
    }
    details.append(button(editor.pending?'Building firmware…':'Build & package',()=>editor.requestExport(true),{className:'ed-primary',disabled:editor.pending}));
  } else if (!editor.statusMessage) details.append(empty('Review the selected pattern and wiring assignments before building the firmware package.'));
  const result=editor.exportResult;
  if(result) {
    const ok=result.build?.ok;
    details.append(el('p',ok?'ed-success':'ed-error',ok?'Build passed. Firmware package is ready.':'Firmware build did not pass. See the build log.'));
    if(result.download){
      const link=el('a','ed-download','Download '+(ok?'firmware package':'source package'));
      link.href=result.download;link.download=result.name??'';details.append(link);
    }
    if(result.build?.log){
      const log=el('details','ed-mount-details');log.append(el('summary',null,'Build log'),el('pre','ed-log',result.build.log));
      log.open=!ok;details.append(log);
    }
  }
  summary.append(details);
  host.replaceChildren(div('ed-export',card,summary));
}
export function renderPanels(editor) {
  const panels=[['wiring-editor',renderWiring],['library-editor',renderLibrary],['export-editor',renderExport]];
  for (const [id,render] of panels) {
    const host=byId(id);
    if(host) render(editor,host);
  }
}

