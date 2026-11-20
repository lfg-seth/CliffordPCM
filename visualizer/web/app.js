import { createEditor } from './editor.js';
import { createViewer } from './viewer.js';
import { projectFixture } from './viewer-geometry.js';

const $ = id => document.getElementById(id);
const strokes = {
  studio: [[2,4,18,4,18,16,2,16,2,4],[5,11,8,11,10,7,12,13,14,10,16,10]],
  wiring: [[3,4,7,4,7,8,3,8,3,4],[13,12,17,12,17,16,13,16,13,12],[7,6,11,6,11,14,13,14]],
  library: [[3,4,6,4,6,16,3,16,3,4],[9,4,12,4,12,16,9,16,9,4],[14,5,17,15]],
  export: [[3,11,3,17,17,17,17,11],[10,12,10,3],[6,7,10,3,14,7]],
  orbit: [[3,10,5,6,10,4,15,6,17,10,15,14,10,16,5,14,3,10],[2,12,6,12,14,8,18,8]],
  adjust: [[3,5,17,5],[3,10,17,10],[3,15,17,15],[7,3,7,7],[13,8,13,12],[8,13,8,17]],
  steps: [[3,4,3,16,17,16],[6,12,9,12,9,8,13,8,13,5,17,5]],
  move: [[10,2,10,18],[2,10,18,10],[7,5,10,2,13,5],[7,15,10,18,13,15],[5,7,2,10,5,13],[15,7,18,10,15,13]],
  left: [[12,5,7,10,12,15]], right: [[8,5,13,10,8,15]],
  previous: [[4,4,4,16],[15,4,7,10,15,16,15,4]], next: [[16,4,16,16],[5,4,13,10,5,16,5,4]],
  play: [[6,3,16,10,6,17,6,3]], pause: [[7,4,7,16],[13,4,13,16]],
  layers: [[2,8,10,4,18,8,10,12,2,8],[3,12,10,16,17,12]],
  copy: [[7,7,16,7,16,16,7,16,7,7],[12,4,4,4,4,12]],
};
function drawIcon(host, name) {
  const canvas = document.createElement('canvas');
  const scale = Math.max(1, devicePixelRatio);
  canvas.width = canvas.height = Math.round(18 * scale);
  canvas.style.width = canvas.style.height = '17px';
  canvas.setAttribute('aria-hidden', 'true');
  const ctx = canvas.getContext('2d');
  ctx.scale(canvas.width / 20,canvas.height / 20);
  ctx.strokeStyle = getComputedStyle(host).color;
  ctx.lineWidth = 1.6;
  ctx.lineJoin = ctx.lineCap = 'round';
  for (const [x,y,...coords] of strokes[name]) {
    ctx.beginPath();
    ctx.moveTo(x,y);
    for (let i = 0; i < coords.length; i += 2) ctx.lineTo(coords[i],coords[i+1]);
    ctx.stroke();
  }
  host.replaceChildren(canvas);
}
document.querySelectorAll('[data-icon]').forEach(el => drawIcon(el,el.dataset.icon));

const names = {studio:'Pattern studio',wiring:'Wiring layouts',library:'Pattern library',export:'Firmware export'};
const angles = ['Front','Driver front quarter','Driver front quarter','Driver side','Driver rear quarter',
  'Driver rear quarter','Rear','Passenger rear quarter','Passenger rear quarter','Passenger side','Passenger front quarter','Passenger front quarter'];
let editor, viewer, snapshot;
let camera = {heading:1,ring:0};
let placing = false;
let toastTimer, lastActive, lastPlay;
function notify(message) {
  $('toast').textContent = message;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('toast').hidden = true, 5500);
}
function openPage(key) {
  if (!Object.hasOwn(names,key)) key = 'studio';
  document.querySelectorAll('.workspace-page').forEach(p => p.hidden = p.id !== key+'-page');
  document.querySelectorAll('[data-page]').forEach(button => {
    const current = button.dataset.page === key;
    button.classList.toggle('current',current);
    if (current) button.setAttribute('aria-current','page');
    else button.removeAttribute('aria-current');
  });
  $('page-title').textContent = names[key];
  document.title = names[key]+' · Clifford PCM';
  if (location.hash !== '#'+key) history.replaceState(null,'','#'+key);
}
function viewAngle(view) {
  camera = view;
  $('angle-value').textContent = (view.heading*30)+'°';
  $('angle-label').textContent = angles[view.heading];
  $('view-counter').textContent = 'VIEW '+String(view.heading+1).padStart(2,'0')+' / 12';
  $('elevation').value = view.ring;
}
function setPlacement(enabled) {
  placing = enabled;
  viewer.setState({placement:enabled});
  $('placement').setAttribute('aria-pressed',String(enabled));
  $('placement-tip').hidden = !enabled;
}
function populate(id, items, selected) {
  const select = $(id);
  select.replaceChildren(...items.map(item => new Option(item.name,item.id)));
  select.value = selected;
}
function selection(view) {
  const fixture = view.fixtures.find(f => f.id === view.selectedFixture);
  const circuit = view.layout.circuits.find(c => c.id === view.selectedCircuit);
  const panel = $('selection-detail');
  panel.replaceChildren();
  if (!(fixture || circuit)) {
    panel.textContent = 'Select a light on the vehicle or a circuit in the grid.';
    return;
  }
  const name = document.createElement('strong');
  name.textContent = fixture?.label || circuit.name;
  panel.append(name);
  if (circuit) {
    const count = view.fixtures.filter(f => f.lamps.some(l => l.circuit === circuit.id)).length;
    const meta = document.createElement('small');
    meta.textContent = (circuit.channel == null ? 'Unassigned output' : (circuit.node === 'engine' ? 'Engine' : 'Cargo')+' CH '+circuit.channel)
      +' · '+(count ? count+' '+(count === 1 ? 'fixture' : 'fixtures') : 'No fixture placed');
    panel.append(meta);
  }
  if (fixture?.lamps.filter(l => l.circuit).length > 1) {
    const channels = document.createElement('select');
    channels.setAttribute('aria-label','Selected light circuit');
    for (const lamp of fixture.lamps) {
      const c = view.layout.circuits.find(c => c.id === lamp.circuit);
      if (c) channels.add(new Option(c.name,c.id));
    }
    channels.value = circuit?.id || '';
    channels.onchange = () => editor.selectCircuit(channels.value);
    panel.append(channels);
  }
}
function refresh(view) {
  snapshot = view;
  populate('layout-select',view.layouts,view.layout.id);
  populate('pattern-select',view.patterns.filter(p => p.node === view.role),view.pattern.id);
  $('role').value = view.role;
  $('speed').value = view.speed;
  $('step-count').textContent = view.pattern.steps.length+' / 16';
  $('loop-length').textContent = (view.cycles/1000).toFixed(2)+' s';
  $('add-step').disabled = view.pattern.steps.length >= 16;
  $('delete-step').disabled = view.pattern.steps.length <= 1;
  const other = view.role === 'engine' ? 'cargo' : 'engine';
  $('companion').checked = view.playingNodes.includes(other);
  $('companion-label').textContent = 'Play '+other+' pattern';
  selection(view);
  viewer.setState({fixtures:view.fixtures,selected:view.selectedFixture,selectedCircuit:view.selectedCircuit,placement:placing,speed:view.speed});
}
function frame({active,step,playing}) {
  // A frame can sample the same PCM step many times between transitions.
  const key = [...active].sort().join('|');
  if (key !== lastActive) {
    lastActive = key;
    viewer.setState({active:[...active]});
  }
  $('step-position').textContent = 'Step '+(step+1)+' of '+(snapshot?.pattern.steps.length ?? '–');
  if (playing !== lastPlay) {
    lastPlay = playing;
    $('play').querySelector('span').textContent = playing ? 'Pause' : 'Play';
    drawIcon($('play').querySelector('i'),playing ? 'pause' : 'play');
  }
}
async function start() {
  viewer = createViewer($('vehicle'),{
    onSelect:id => editor?.selectFixture(id),
    onEdit:(id,patch) => {
      if (!editor) return;
      editor.updateFixture(id,patch);
      if (!snapshot.dirty) notify('Saved this photo adjustment to '+snapshot.layout.name+'.');
    },
    onView:viewAngle
  });
  editor = await createEditor({onChange:refresh,onFrame:frame,notify,
    onPlace:id => {
      openPage('studio');
      const fixture = snapshot.fixtures.find(f => f.id === id);
      if (fixture && !projectFixture(fixture,camera.heading,camera.ring)) {
        const facing = {front:0,rear:6,driver:3,passenger:9};
        viewer.setView(facing[fixture.face] ?? 0,camera.ring);
      }
      setPlacement(true);
      $('vehicle').focus();
    },
    onOpenStudio:() => openPage('studio')
  });
  viewAngle(camera);
  $('load-state').hidden = true;
  openPage(location.hash.slice(1));
  document.querySelectorAll('[data-page]').forEach(b => b.onclick = () => openPage(b.dataset.page));
  window.addEventListener('hashchange',() => openPage(location.hash.slice(1)));
  $('angle-prev').onclick = () => viewer.rotate(-1);
  $('angle-next').onclick = () => viewer.rotate(1);
  $('zoom-in').onclick = () => viewer.zoom(1.15);
  $('zoom-out').onclick = () => viewer.zoom(1/1.15);
  $('zoom-reset').onclick = () => viewer.resetZoom();
  const lightingControls = [
    ['beam-fade-on','fade-on-value','fadeOnMs',' ms'],
    ['beam-fade-off','fade-off-value','fadeOffMs',' ms'],
    ['haze-reach','haze-value','hazeReach','%'],
    ['haze-intensity','intensity-value','hazeIntensity','%']
  ];
  for (const [id,readout,setting,unit] of lightingControls) {
    const slider = $(id);
    const key = 'clifford.pcm.preview.'+id;
    try {
      const saved = localStorage.getItem(key);
      if (saved && Number.isFinite(Number(saved))) slider.value = saved;
    } catch { /* Use the displayed defaults when browser storage is unavailable. */ }
    function update() {
      const amount = slider.valueAsNumber;
      const label = amount+unit;
      $(readout).textContent = label;
      slider.setAttribute('aria-valuetext',label);
      viewer.setState({[setting]:unit==='%' ? amount/100 : amount});
    }
    slider.addEventListener('input',update);
    slider.addEventListener('change',() => {
      try { localStorage.setItem(key,slider.value); } catch { /* Still applied for this session. */ }
    });
    update();
  }
  $('elevation').onchange = e => viewer.setView(camera.heading,Number(e.target.value));
  $('placement').onclick = () => setPlacement(!placing);
  $('play').onclick = () => editor.togglePlay();
  $('step-prev').onclick = () => editor.prev();
  $('step-next').onclick = () => editor.next();
  $('add-step').onclick = () => editor.addStep();
  $('delete-step').onclick = () => editor.removeStep();
  $('save-as').onclick = () => editor.saveAs();
  $('speed').onchange = e => editor.setSpeed(Number(e.target.value));
  $('companion').onchange = () => editor.toggleCompanion();
  $('role').onchange = e => editor.setRole(e.target.value);
  $('pattern-select').onchange = e => editor.setPattern(e.target.value);
  $('layout-select').onchange = e => editor.setLayout(e.target.value);
  window.addEventListener('keydown',e => {
    if ($('studio-page').hidden || e.target.closest('input,select,textarea,button,a,[contenteditable]') || e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.code === 'Space') {e.preventDefault();if (!e.repeat) editor.togglePlay();}
  });
  editor.refresh();
}
start().catch(error => {
  console.error(error);
  $('load-state').hidden = false;
  $('load-state').textContent = 'Could not open the workspace. '+error.message;
});
