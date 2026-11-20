import { defaultFixtures } from './viewer-geometry.js';
import { renderPanels, renderStepGrid, markStep } from './editor-panels.js';

const STORAGE = 'clifford.pcm.studio.v1';
const mountFields = ['anchor','corrections','viewSizes','face','mount','kind','width','height'];
export const colors = { Amber: '#ffab53', Red: '#f15f53', White: '#eff7ff' };
export const boardName = node => node === 'engine' ? 'Engine bay' : 'Cargo bay';
const clone = value => structuredClone(value);
const uid = prefix => prefix + '.' + crypto.randomUUID();
const durationOn = duration => Math.max(5, Math.ceil(duration / 5) * 5);
export const cycleDuration = pattern => pattern.steps.reduce((n,s) => n + durationOn(s.duration) + 5, 0);

export function phaseAt(pattern, elapsed) {
  let time = elapsed % cycleDuration(pattern);
  for (const [step, entry] of pattern.steps.entries()) {
    const on = durationOn(entry.duration);
    if (time < on) return {step, active:entry.circuits};
    if (time < on + 5) {
      const next = pattern.steps[(step + 1) % pattern.steps.length];
      return {step, active:entry.circuits.filter(id => next.circuits.includes(id))};
    }
    time -= on + 5;
  }
  return { step: 0, active: [] };
}

function seedLayout(baseline, fixtures) {
  const circuits = clone(baseline.circuits);
  for (const fixture of fixtures) {
    for (const lamp of fixture.lamps) {
      if (!lamp.circuit || circuits.some(c => c.id === lamp.circuit)) continue;
      const board = fixture.id.startsWith('board.');
      const name = board ? (fixture.face === 'driver' ? 'Driver board A' : 'Passenger board A') : fixture.label;
      const node = board || fixture.face === 'rear' ? 'cargo' : 'engine';
      circuits.push({id: lamp.circuit, name, node, channel: null, accessory: false});
    }
  }
  return {id:'baseline',name:'Current wiring',circuits,fixtures,boardMode:'single'};
}

export async function createEditor(options = {}) {
  const response = await fetch('/api/baseline');
  if (!response.ok) throw new Error('Could not read project firmware assignments.');
  const baseline = await response.json();
  const fixtures = defaultFixtures();
  const original = seedLayout(baseline, fixtures);
  const seed = {version:1, layouts:[clone(original)], patterns:clone(baseline.patterns),
    role:'engine', layout:'baseline', selected:{engine:'engine.fast', cargo:'cargo.fast'}};
  let data = seed;
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE));
    if (stored?.version === 1 && stored.layouts?.some(l => l.id === stored.layout && Array.isArray(l.fixtures)) &&
      stored.patterns?.some(p => p.id === stored.selected?.[stored.role])) data = stored;
  } catch { options.notify?.('Saved workspace could not be opened. Loaded the firmware defaults.'); }
  // Always read the recovered presets and reference layout from this checkout.
  data.patterns = [...clone(baseline.patterns), ...data.patterns.filter(p => !baseline.patterns.some(b => b.id === p.id))];
  data.layouts = [clone(original), ...data.layouts.filter(l => l.id !== 'baseline')];
  // Refresh firmware bindings from the checkout but restore the user's vehicle calibration.
  for (const fixture of data.layouts[0].fixtures) {
    const saved = data.vehicleMounts?.[fixture.id];
    if (!saved) continue;
    for (const field of mountFields) {
      if (Object.hasOwn(saved,field)) fixture[field] = clone(saved[field]);
    }
  }
  // Older drafts stored the factory beams as ordinary white lamps. Keep any custom tint or rewiring.
  const factoryBeams = fixtures.filter(f => f.lamps[0].bulb === 'halogen');
  for (const layout of data.layouts) {
    for (const beam of factoryBeams) {
      const savedLamp = layout.fixtures.find(f => f.id === beam.id)?.lamps[0];
      if (savedLamp && !savedLamp.bulb) {
        savedLamp.bulb = 'halogen';
        if (savedLamp.color === colors.White) savedLamp.color = beam.lamps[0].color;
      }
    }
  }
  return new Editor(data, baseline, original, options);
}

class Editor {
  constructor(data, baseline, original, options) {
    this.data = data;
    this.baseline = baseline;
    this.original = original;
    this.options = options;
    this.selectedFixture = null;
    this.selectedCircuit = null;
    this.steps = {engine:0,cargo:0};
    this.clocks = {};
    this.speed = 1;
    this.allRows = false;
    this.extraRows = new Set();
    this.gridNode = null;
    this.exportSlot = null;
    this.slotPicks = {};
    this.exportResult = null;
    this.review = null;
    this.pending = false;
    this.generation = 0;
    this.routedPresets = new Map();
    this.frameId = null;
    this.statusMessage = '';
    this.storageFailed = false;
  }
  get role() { return this.data.role; }
  get layout() { return this.data.layouts.find(l => l.id === this.data.layout); }
  get pattern() { return this.patternFor(this.role); }
  patternFor(role) {
    const pattern = this.data.patterns.find(p => p.id === this.data.selected[role]);
    return this.resolvePreset(pattern);
  }
  resolvePreset(pattern) {
    if (this.layout.id === 'baseline' || !this.baseline.patterns.some(p=>p.id===pattern.id)) return pattern;
    if (!this.routedPresets.has(pattern.id)) {
      const routes = this.routes();
      const steps = pattern.steps.map(step => ({...step,
        circuits:[...new Set(step.circuits.flatMap(id=>routes[id]??[id]))]}));
      this.routedPresets.set(pattern.id,{...pattern,steps});
    }
    return this.routedPresets.get(pattern.id);
  }
  get playing() { return Boolean(this.clocks[this.role]); }
  get step() { return this.steps[this.role]; }
  get fixtures() { return this.layout.fixtures; }
  findFixture(id) { return this.fixtures.find(f => f.id === id); }
  circuit(id) { return this.layout.circuits.find(c => c.id === id); }
  notify(text) { this.options.notify?.(text); }
  view() {
    return {layout:this.layout, layouts:this.data.layouts, pattern:this.pattern, patterns:this.data.patterns,
      role:this.role, fixtures:this.fixtures, selectedCircuit:this.selectedCircuit, selectedFixture:this.selectedFixture,
      active:this.sample().active, step:this.step, playing:this.playing, dirty:this.storageFailed, speed:this.speed,
      cycles:cycleDuration(this.pattern), playingNodes:Object.keys(this.clocks),
      companionPlaying:Boolean(this.clocks[this.role==='engine'?'cargo':'engine'])};
  }
  refresh() {
    renderStepGrid(this);
    renderPanels(this);
    this.options.onChange?.(this.view());
    this.emitFrame();
  }
  save() {
    try { localStorage.setItem(STORAGE, JSON.stringify(this.data)); this.storageFailed = false; }
    catch { this.storageFailed = true; this.notify('Browser storage is full or unavailable. Changes are only in this session.'); }
  }
  changed() {
    this.review = this.exportResult = null;
    this.routedPresets.clear();
    this.statusMessage = '';
    this.generation++;
    this.save();
    this.refresh();
  }
  draftLayout() {
    if (this.layout.id !== 'baseline') return this.layout;
    return this.copyLayout('Wiring draft');
  }
  copyLayout(name) {
    const layout = {...clone(this.layout), id:uid('layout'),name:this.uniqueName(this.data.layouts,name)};
    this.data.layouts.push(layout);
    this.data.layout = layout.id;
    return layout;
  }
  uniqueName(items, name) {
    let candidate = name, n = 2;
    while (items.some(i => i.name === candidate)) candidate = name + ' ' + n++;
    return candidate;
  }
  duplicateLayout() {
    const name = prompt('Name this wiring layout', this.uniqueName(this.data.layouts, this.layout.name + ' copy'))?.trim();
    if (name) { this.copyLayout(name); this.changed(); }
  }
  renameLayout() {
    const layout = this.layout;
    if (layout.id === 'baseline') return;
    const name = prompt('Rename wiring draft',layout.name)?.trim();
    if (!name || name === layout.name) return;
    layout.name = this.uniqueName(this.data.layouts.filter(l => l.id !== layout.id),name);
    this.changed();
  }
  deleteLayout() {
    const layout = this.layout;
    if (layout.id === 'baseline') return;
    const remaining = this.data.layouts.filter(l => l.id !== layout.id);
    const otherCircuits = new Set(remaining.flatMap(l => l.circuits.map(c => c.id)));
    const exclusive = new Set(layout.circuits.map(c => c.id).filter(id => !otherCircuits.has(id)));
    const affected = this.data.patterns.filter(p => p.steps.some(s => s.circuits.some(id => exclusive.has(id))));
    let message = 'Delete wiring draft “'+layout.name+'” and its fixture placements?';
    if (affected.length) {
      message += '\n\nThese saved patterns use circuits found only in this draft. They will need those circuits reassigned before export.\n'+
        affected.map(p => '• '+p.name).join('\n');
    }
    if (!confirm(message)) return;
    this.data.layouts = remaining;
    this.setLayout('baseline');
  }
  setLayout(id) {
    if (!this.data.layouts.some(l => l.id === id)) return;
    this.stopAll();
    this.data.layout = id;
    this.selectedCircuit = this.selectedFixture = null;
    this.extraRows.clear();
    this.changed();
  }
  draftPattern() {
    if (this.baseline.patterns.some(p => p.id === this.pattern.id)) {
      const next = {...clone(this.pattern), id:uid('pattern'), name:this.uniqueName(this.data.patterns,this.pattern.name + ' edit')};
      this.data.patterns.push(next);
      this.data.selected[this.role] = next.id;
    }
    return this.pattern;
  }
  newPattern() { this.copyPattern(true); }
  saveAs() { this.copyPattern(false); }
  copyPattern(blank) {
    const suggested = blank ? 'New sequence' : this.pattern.name + ' copy';
    const name = prompt('Pattern name', this.uniqueName(this.data.patterns,suggested))?.trim();
    if (!name) return;
    const pattern = {...clone(this.pattern), id:uid('pattern'), name};
    if (blank) pattern.steps = [{duration:100, circuits:[]}];
    this.data.patterns.push(pattern);
    this.setPattern(pattern.id);
  }
  renamePattern() {
    const name = prompt('Pattern name',this.pattern.name)?.trim();
    if (name) { this.draftPattern().name = name; this.changed(); }
  }
  deletePattern(id) {
    const pattern = this.data.patterns.find(p => p.id === id);
    if (!pattern || this.baseline.patterns.some(p => p.id === id) || !confirm('Delete “' + pattern.name + '”?')) return;
    delete this.clocks[pattern.node];
    this.data.patterns = this.data.patterns.filter(p => p.id !== id);
    if (this.data.selected[pattern.node] === id) this.data.selected[pattern.node] = pattern.node + '.fast';
    this.steps[pattern.node] = 0;
    this.changed();
  }
  setPattern(id) {
    const pattern = this.data.patterns.find(p => p.id === id);
    if (!pattern) return;
    delete this.clocks[pattern.node];
    this.data.role = pattern.node;
    this.data.selected[pattern.node] = id;
    this.steps[pattern.node] = 0;
    this.selectedCircuit = this.selectedFixture = null;
    this.extraRows.clear();
    this.allRows = false;
    this.exportSlot = null;
    this.changed();
  }
  setRole(role) {
    if (!['engine','cargo'].includes(role) || role === this.role) return;
    this.data.role = role;
    this.selectedCircuit = this.selectedFixture = null;
    this.extraRows.clear();
    this.allRows = false;
    this.exportSlot = null;
    this.changed();
  }
  editGrid(fn) {
    delete this.clocks[this.role];
    fn(this.draftPattern());
    this.steps[this.role] = Math.min(this.step, this.pattern.steps.length - 1);
    this.changed();
  }
  addStep() {
    if (this.pattern.steps.length >= 16) return this.notify('The PCM supports 16 steps per pattern.');
    this.editGrid(p => { p.steps.splice(this.step + 1, 0, {duration:p.steps[this.step].duration,circuits:[]}); this.steps[this.role]++; });
  }
  removeStep() {
    if (this.pattern.steps.length === 1) return this.notify('A pattern needs at least one step.');
    this.editGrid(p => p.steps.splice(this.step,1));
  }
  toggleCell(i,id) {
    this.selectedCircuit = id;
    this.extraRows.add(id);
    this.steps[this.role] = i;
    this.editGrid(p => {
      const step = p.steps[i];
      step.circuits = step.circuits.includes(id) ? step.circuits.filter(c=>c!==id) : [...step.circuits,id];
    });
  }
  setDuration(i,value) {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1 || n > 65535) {
      this.notify('Enter a whole duration from 1 to 65,535 milliseconds.'); this.refresh(); return;
    }
    this.steps[this.role] = i;
    this.editGrid(p => p.steps[i].duration = n);
  }
  setStep(i) {
    if (!Number.isInteger(i)) return;
    delete this.clocks[this.role];
    this.steps[this.role] = (i + this.pattern.steps.length) % this.pattern.steps.length;
    this.refresh();
  }
  next() { this.setStep(this.step + 1); }
  prev() { this.setStep(this.step - 1); }
  play() {
    if (this.playing) return;
    const offset = this.pattern.steps.slice(0,this.step).reduce((sum,s)=>sum+durationOn(s.duration)+5,0);
    this.clocks[this.role] = {start:performance.now(),offset};
    this.refresh();
    if (!this.frameId) this.frameId = requestAnimationFrame(t=>this.tick(t));
  }
  pause() { delete this.clocks[this.role]; this.refresh(); }
  togglePlay() { this.playing ? this.pause() : this.play(); }
  toggleCompanion() {
    const role=this.role==='engine'?'cargo':'engine';
    if (this.clocks[role]) delete this.clocks[role];
    else this.clocks[role]={start:performance.now(),offset:0};
    this.refresh();
    if (!this.frameId && Object.keys(this.clocks).length) this.frameId=requestAnimationFrame(t=>this.tick(t));
  }
  stopAll() { this.clocks = {}; }
  setSpeed(value) {
    const speed = Number(value);
    if (!Number.isFinite(speed) || speed <= 0) return;
    const now = performance.now();
    for (const clock of Object.values(this.clocks)) {
      clock.offset += (now-clock.start)*this.speed;
      clock.start = now;
    }
    this.speed = speed;
    this.refresh();
  }
  sample(now = performance.now()) {
    const active = new Set();
    for (const role of ['engine','cargo']) {
      const clock = this.clocks[role];
      if (!clock) continue;
      const phase = phaseAt(this.patternFor(role), clock.offset + Math.max(0,now-clock.start)*this.speed);
      this.steps[role] = phase.step;
      phase.active.forEach(id=>active.add(id));
    }
    if (!this.playing) this.pattern.steps[this.step]?.circuits.forEach(id=>active.add(id));
    return {active, step:this.step, playing:this.playing};
  }
  emitFrame(now) {
    const frame = this.sample(now);
    markStep(frame.step);
    this.options.onFrame?.(frame);
  }
  tick(now) {
    this.frameId = null;
    this.emitFrame(now);
    if (Object.keys(this.clocks).length) this.frameId = requestAnimationFrame(t=>this.tick(t));
  }
  selectCircuit(id) {
    if (!this.circuit(id)) return;
    if (this.role !== this.circuit(id).node) this.setRole(this.circuit(id).node);
    this.selectedCircuit = id;
    this.selectedFixture = this.fixtures.find(f=>f.id === this.selectedFixture && f.lamps.some(l=>l.circuit===id))?.id ??
      this.fixtures.find(f=>f.lamps.some(l=>l.circuit===id))?.id ?? null;
    this.refresh();
  }
  selectFixture(id) {
    const fixture = this.findFixture(id);
    if (!fixture) { this.selectedFixture = this.selectedCircuit = null; this.refresh(); return; }
    const active = this.sample().active;
    const lamp = fixture.lamps.find(l=>active.has(l.circuit)) ?? fixture.lamps.find(l=>l.circuit===this.selectedCircuit) ?? fixture.lamps[0];
    const circuit = this.circuit(lamp?.circuit);
    if (circuit && circuit.node !== this.role) this.setRole(circuit.node);
    this.selectedFixture = id;
    this.selectedCircuit = circuit?.id ?? null;
    this.refresh();
  }
  updateFixture(id,patch) {
    if (!this.findFixture(id)) return;
    if (this.layout.id === 'baseline' && Object.keys(patch).every(key=>mountFields.includes(key))) {
      const saved = this.data.vehicleMounts ??= {};
      saved[id] = {...saved[id], ...clone(patch)};
    } else {
      this.draftLayout();
    }
    Object.assign(this.findFixture(id), clone(patch));
    this.changed();
  }
  assign(id,node,channel) {
    if (!['engine','cargo'].includes(node)) return;
    const n = channel === null || channel === '' ? null : Number(channel);
    if (n !== null && (!Number.isInteger(n) || n < 1 || n > 26)) return;
    const existing = this.layout.circuits.find(c=>c.id!==id && c.node===node && c.channel===n && n!==null);
    if (existing) { this.notify('Output ' + n + ' is assigned to ' + existing.name + '.'); this.refresh(); return; }
    this.draftLayout();
    Object.assign(this.circuit(id),{node,channel:n});
    this.changed();
  }
  addCircuit(name,node) {
    this.draftLayout();
    const circuit = {id:uid('circuit'),name,node,channel:null,accessory:false};
    this.layout.circuits.push(circuit);
    return circuit;
  }
  addFixture() {
    const name = prompt('Name the proposed light','Surface light')?.trim();
    if (!name) return;
    const circuit = this.addCircuit(name,this.role);
    const f = {id:uid('fixture'),label:name,face:this.role==='engine'?'front':'rear',kind:'surface',
      anchor:[0,this.role==='engine'?2.35:-2.35,0.78],width:0.14,height:0.05,lamps:[{circuit:circuit.id,color:colors.Amber}],custom:true};
    this.layout.fixtures.push(f);
    this.selectedFixture=f.id; this.selectedCircuit=circuit.id;
    this.changed();
    this.options.onPlace?.(f.id);
  }
  removeFixture(id) {
    const f = this.findFixture(id);
    if (!f?.custom || !confirm('Remove “'+ f.label +'” from this layout?')) return;
    this.draftLayout();
    this.layout.fixtures = this.fixtures.filter(f=>f.id!==id);
    this.selectedFixture = this.selectedCircuit = null;
    this.changed();
  }
  bindLamp(fixtureId,index,circuitId) {
    const old = this.findFixture(fixtureId)?.lamps[index];
    const oldCircuit = this.circuit(old?.circuit);
    if (!old) return;
    if (circuitId === 'new') {
      const name = prompt('New circuit name',this.findFixture(fixtureId).label)?.trim();
      if (!name) { this.refresh(); return; }
      circuitId = this.addCircuit(name,oldCircuit?.node ?? this.role).id;
    } else if (!this.circuit(circuitId) || this.circuit(circuitId).accessory) return;
    this.draftLayout();
    const lamp = this.findFixture(fixtureId).lamps[index];
    if (fixtureId.startsWith('board.')) {
      const group = this.runningBoardGroups().get(circuitId);
      lamp.color = group?.color || this.circuit(circuitId).designColor || lamp.color;
    }
    lamp.circuit = circuitId;
    this.selectedCircuit = circuitId;
    this.changed();
  }
  runningBoardGroups() {
    const groups = new Map();
    for (const fixture of this.fixtures) {
      if (!fixture.id.startsWith('board.')) continue;
      const lamp = fixture.lamps[0];
      const group = groups.get(lamp.circuit);
      if (group) {
        group.fixtures.push(fixture);
        if (group.color !== lamp.color) group.color = null;
      } else {
        groups.set(lamp.circuit, {color:lamp.color, fixtures:[fixture]});
      }
    }
    return groups;
  }
  setBoardColor(id,color) {
    if (!/^#[a-f\d]{6}$/i.test(color)) return;
    this.draftLayout();
    const group = this.runningBoardGroups().get(id);
    if (!group) return;
    delete this.layout.boardColor;
    this.circuit(id).designColor = color;
    for (const fixture of group.fixtures) fixture.lamps[0].color = color;
    this.changed();
  }
  setBoards(mode) {
    this.draftLayout();
    const layout = this.layout;
    // Keep a channel's color when a grouping temporarily leaves it without heads.
    // Older layouts already store the actual colors on the lamps.
    for (const [id,group] of this.runningBoardGroups()) this.circuit(id).designColor = group.color;
    for (const side of ['driver','passenger']) {
      for (let i=1; i<=4; i++) {
        const fixture = this.findFixture('board.'+side+'.'+i);
        if (!fixture) continue;
        const inGroupB = (mode === 'alternate' && i % 2 === 0) || (mode === 'pairs' && i > 2);
        const group = inGroupB ? 'B' : 'A';
        const id = 'board.'+side+'.'+group;
        let circuit = this.circuit(id);
        if (!circuit) {
          circuit = {id,name:(side==='driver'?'Driver':'Passenger')+' board '+group,node:'cargo',channel:null,accessory:false};
          layout.circuits.push(circuit);
        }
        const lamp = fixture.lamps[0];
        lamp.circuit = id;
        lamp.color = circuit.designColor || lamp.color;
      }
    }
    layout.boardMode=mode;
    delete layout.boardColor;
    if (mode==='single') {
      for (const side of ['driver','passenger']) {
        const spare = this.circuit('board.'+side+'.B');
        if (spare && !this.fixtures.some(f=>f.lamps.some(l=>l.circuit===spare.id))) spare.channel=null;
      }
    }
    this.changed();
  }
  routes() {
    const routes = {};
    for (const original of this.original.fixtures) {
      const fixture = this.findFixture(original.id);
      if (!fixture) continue;
      original.lamps.forEach((lamp,i)=>{
        if (!this.baseline.circuits.some(c=>c.id===lamp.circuit) || !fixture.lamps[i]?.circuit) return;
        const list = routes[lamp.circuit] ??= [];
        const target = fixture.lamps[i].circuit;
        if (!list.includes(target)) list.push(target);
      });
    }
    return Object.fromEntries(Object.entries(routes).filter(([id,targets])=>targets.length!==1||targets[0]!==id));
  }
  exportPayload() {
    const slot = this.exportSlot || this.pattern.slot;
    const slotPatterns = {};
    for (const [key,id] of Object.entries(this.slotPicks)) {
      if (key === this.role+'.'+slot) continue;
      const pattern=this.data.patterns.find(p=>p.id===id);
      if (pattern) slotPatterns[key]=this.resolvePreset(pattern);
    }
    return {circuits:this.layout.circuits, pattern:this.pattern, slot:this.exportSlot || this.pattern.slot,
      routes:this.routes(),layout:this.layout,slotPatterns};
  }
  async requestExport(build) {
    if (this.pending) return;
    this.pending = true;
    this.statusMessage = '';
    this.exportResult = null;
    const generation = this.generation;
    const payload = this.exportPayload();
    try {
      renderPanels(this);
      const res = await fetch('/api/' + (build?'export':'review'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
      const result = await res.json();
      if (generation !== this.generation) return;
      if (!res.ok) throw new Error(result.error || 'Export validation failed.');
      if (build) this.exportResult = result; else this.review = result;
    } catch (error) {
      if (generation === this.generation) this.statusMessage = error.message;
    } finally {
      this.pending = false;
      renderPanels(this);
    }
  }
}

