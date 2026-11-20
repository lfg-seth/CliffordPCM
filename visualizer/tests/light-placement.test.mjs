import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createEditor} from '../web/editor.js';
import {defaultFixtures,moveMount,projectFixture,resizeLens} from '../web/viewer-geometry.js';

test('numeric mount edits keep existing photo offsets', () => {
  const fixture = defaultFixtures().find(f=>f.id==='head.driver');
  const corrections = {};
  for (const [ring,heading] of [[0,1],[1,2]]) {
    const p = projectFixture(fixture,heading,ring);
    corrections[ring+':'+heading] = [(p.x+5)/500,(p.y-3)/300];
  }
  const calibrated = {...fixture,corrections};
  const moved = {...calibrated,...moveMount(calibrated,[.72,2.26,1.12])};
  for (const [ring,heading] of [[0,1],[1,2]]) {
    const raw = projectFixture({...moved,corrections:{}},heading,ring);
    const corrected = projectFixture(moved,heading,ring);
    assert.ok(Math.abs(corrected.x-raw.x-5)<.001 && Math.abs(corrected.y-raw.y+3)<.001);
    assert.notEqual(corrected.y,projectFixture(calibrated,heading,ring).y);
  }
});

test('corner resize follows both axes and fixes the opposite corner at any tilt', () => {
  const tilt=.31, cos=Math.cos(tilt), sin=Math.sin(tilt);
  const p={x:155,y:91,w:16,h:8,tilt};
  for(const sx of [-1,1]) for(const sy of [-1,1]) {
    const corner=(r,a,b)=>[r.x+(a*r.w*cos-b*r.h*sin)/2,r.y+(a*r.w*sin+b*r.h*cos)/2];
    const dx=3.5, dy=-2.5;
    const resized=resizeLens(p,{sx,sy},dx,dy);
    const delta=(a,b)=>corner(resized,a,b).map((n,i)=>n-corner(p,a,b)[i]);
    const [mx,my]=delta(sx,sy), [fx,fy]=delta(-sx,-sy);
    assert.ok(Math.hypot(mx-dx,my-dy)<1e-9);
    assert.ok(Math.hypot(fx,fy)<1e-9);
    // Crossing the fixed corner must keep the dimensions positive.
    const collapsed=resizeLens(p,{sx,sy},100*(-sx*cos+sy*sin),100*(-sx*sin-sy*cos));
    assert.ok(collapsed.w>0 && collapsed.h>0);
    const [x,y]=corner(collapsed,-sx,-sy);
    const [beforeX,beforeY]=corner(p,-sx,-sy);
    assert.ok(Math.hypot(x-beforeX,y-beforeY)<1e-9);
  }
});

test('lens and fog overlays change position and size in just one photo', () => {
  for (const id of ['head.driver','fog.driver']) {
    const lamp=defaultFixtures().find(f=>f.id===id);
    const edited={...lamp,corrections:{'0:1':[.32,.43]},viewSizes:{'0:1':[.08,.06]}};
    assert.deepEqual(projectFixture(edited,1,0),{x:160,y:129,w:40,h:18,tilt:0});
    for(let ring=0;ring<2;ring++) for(let heading=0;heading<12;heading++) {
      if (ring!==0 || heading!==1) {
        assert.deepEqual(projectFixture(edited,heading,ring),projectFixture(lamp,heading,ring));
      }
    }
  }
});

test('current-wiring mounts survive reload and draft placement stays independent', async () => {
  const memory = new Map();
  globalThis.localStorage = {getItem:key=>memory.get(key),setItem:(key,value)=>memory.set(key,value)};
  globalThis.document = {getElementById:()=>null};
  globalThis.fetch = async () => ({ok:true,json:async()=>({
    circuits:[],patterns:['engine','cargo'].map(node=>({
      node,id:node+'.fast',steps:[{duration:20,circuits:[]}]
    }))
  })});
  let editor = await createEditor();
  const vehicle = [0.15,2.34,0.68], trial = [0.2,2.34,0.81];
  const correction = {'1:0':[0.51,0.55]};
  editor.updateFixture('head.driver',{anchor:vehicle,corrections:correction,viewSizes:{'1:0':[.03,.04]}});
  assert.equal(editor.layout.id,'baseline');
  editor = await createEditor();
  assert.deepEqual(editor.findFixture('head.driver').anchor,vehicle);
  assert.deepEqual(editor.findFixture('head.driver').corrections,correction);
  assert.deepEqual(editor.findFixture('head.driver').viewSizes,{'1:0':[.03,.04]});
  const draft = editor.copyLayout('Alternative mounts');
  assert.deepEqual(editor.findFixture('head.driver').anchor,vehicle);
  editor.updateFixture('head.driver',{anchor:trial,viewSizes:{'1:0':[.15,.06]}});
  editor = await createEditor();
  assert.equal(editor.layout.id,draft.id);
  assert.deepEqual(editor.findFixture('head.driver').anchor,trial);
  assert.deepEqual(editor.findFixture('head.driver').viewSizes,{'1:0':[.15,.06]});
  globalThis.confirm = () => false;
  editor.deleteLayout();
  assert.equal(editor.layout.id,draft.id);
  globalThis.confirm = () => true;
  editor.deleteLayout();
  editor = await createEditor();
  assert.equal(editor.layout.id,'baseline');
  assert.equal(editor.data.layouts.length,1);
  assert.deepEqual(editor.findFixture('head.driver').anchor,vehicle);
  assert.deepEqual(editor.findFixture('head.driver').corrections,correction);
  assert.deepEqual(editor.findFixture('head.driver').viewSizes,{'1:0':[.03,.04]});
});
