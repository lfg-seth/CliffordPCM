import assert from 'node:assert/strict';
import test from 'node:test';
import {cycleDuration, phaseAt} from '../web/editor.js';

const high = 'engine.DRIVER_HIGHBEAM';
const turn = 'engine.DRIVER_AMBER';
const fog = 'engine.FOGS';

test('a continuously commanded high beam stays on through every service tick and loop', () => {
  const pattern = {steps:[{duration:50, circuits:[high]}]};
  assert.equal(cycleDuration(pattern), 55);
  for (let ms = 0; ms < 2 * cycleDuration(pattern); ms++) {
    assert.deepEqual(phaseAt(pattern, ms).active, [high], 'elapsed ' + ms + ' ms');
  }
});

test('handoff keeps only shared circuits and preserves explicit dark steps', () => {
  const pattern = {steps:[
    {duration:13,circuits:[high, turn]},
    {duration:10,circuits:[high, fog]},
    {duration:5,circuits:[]},
    {duration:5,circuits:[high, fog]},
  ]};
  assert.equal(cycleDuration(pattern), 55);
  for (const [ms, active] of [
    [0,[high,turn]], [14,[high,turn]], [15,[high]], [19,[high]],
    [20,[high,fog]], [30,[]], [35,[]], [44,[]], [45,[high,fog]],
    [50,[high]], [54,[high]], [55,[high,turn]],
  ]) assert.deepEqual(phaseAt(pattern, ms).active, active, 'elapsed ' + ms + ' ms');
});
