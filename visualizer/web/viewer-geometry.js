const amber = '#ffab53', red = '#f15f53', white = '#eff7ff';
const halogenTint = '#ffa757'; // Warm filament at approximately 2700 K on an sRGB display.
const lamp = (circuit, color, level = 1) => ({circuit, color, level});

export function defaultFixtures() {
  const fixtures = [];
  function add(id, label, anchor, face, kind, width, height, lamps, mount) {
    fixtures.push({id, label, anchor, face, kind, width, height, lamps, mount});
  }
  for (const [side, sign, title] of [['driver', 1, 'Driver'], ['passenger', -1, 'Passenger']]) {
    const front = sign === 1 ? 'DRIVER' : 'PASS';
    const rear = sign === 1 ? 'DRIVE' : 'PASS';
    for (const [group, x] of [['outer', .50], ['inner', .26]]) {
      const circuit = 'engine.GRILL_' + group.toUpperCase();
      add('pod.' + side + '.' + group, title + ' ' + group + ' grille pod',
        [sign*x, 2.34, .77], 'front', 'pod', group === 'outer' ? .19 : .15, group === 'outer' ? .18 : .14,
        [lamp(circuit+'_HIGH', white), lamp(circuit+'_LOW', white, .5), lamp('engine.GRILL_AMBER', amber, .35)]);
    }
    for (const [colorName, color, x] of [['amber', amber, .68], ['white', white, .61]]) {
      add('bumper.'+side+'.'+colorName, title+' bumper '+colorName, [sign*x, 2.34, .53], 'front', 'surface',
        .047, .083, [lamp('proposed.'+side+'.'+colorName, color)]);
    }
    add('head.'+side,title+' high beam',[sign*.73,2.26,1.02],'front','lens',.14,.105,
      [{...lamp('engine.'+front+'_HIGHBEAM',halogenTint),bulb:'halogen'}],'beam');
    add('turn.front.'+side,title+' front turn',[sign*.88,2.25,1.035],'front','lens',.087,.09,
      [lamp('engine.'+front+'_AMBER',amber)],'frontTurn');
    add('fog.'+side,title+' fog lamp',[sign*.77,2.31,.60],'front','round',.10,.10,
      [lamp('engine.FOGS',white)],'fog');
    for (const [fn, circuit, color, z] of [['brake','BRAKE',red,.98],['reverse','REV',white,1.08],['turn','TURN',amber,1.19]]) {
      add('tail.'+side+'.'+fn, title+' rear '+fn,[sign*.88,-2.30,z],'rear','lens',.14,.055,
        [lamp('cargo.'+rear+'_'+circuit,color)],'tail');
    }
    for (let i=1;i<=4;i++) {
      add('board.'+side+'.'+i,title+' running board '+i,[sign*.98,1.00-(i-1)*.62,.45],side,'surface',
        .115,.045,[lamp('board.'+side+'.A',amber)]);
    }
  }
  add('bar','Grille light bar',[0,2.34,.53],'front','bar',1.08,.063,[lamp('engine.LIGHTBAR',white)]);
  add('chase','Rear chase light',[0,-2.26,1.86],'rear','chase',.28,.064,
    [lamp('cargo.CHASE_AMBER',amber),lamp('cargo.CHASE_WHITE',white)],'chase');
  return fixtures;
}

// Pixel landmarks on the 500 x 300 reference crop. Mirrored views share
// the same subject geometry. Each elevation has its own measured landmarks.
const landmarks = [
  {
    grille: [[250,143,139,0],[98,148,84,0],[43,151,25,0]],
    beam: [[331,108,169,108],[166,119,61,117],[83,121],[39,125]],
    frontTurn:[[355,107,145,107],[202,118,55,117],[118,119],[51,121],[63,123]],
    fog:[[343,149,157,149],[178,157,52,151],[92,157]],
    tail: [null,[393,115],[440,114],[459,110],[405,108],[283,101,439,101],[145,101,355,101]],
    chase:[null,null,null,null,[437,58],[361,44],[250,30]],
    board:[null,[279,181,349,174],[217,181,351,176],[156,181,326,181],[127,180,270,184],[145,174,205,181]],
  },
  {
    grille: [[250,169,138,0],[99,164,85,12],[44,149,27,10]],
    beam:[[330,136,170,136],[166,137,60,119],[82,127],[35,113]],
    frontTurn:[[354,130,146,130],[202,137,55,117],[119,123],[50,109],[57,96]],
    fog:[[343,170,157,170],[181,180,52,149],[92,161]],
    tail:[null,[394,74],[444,85],[462,102],[408,123],[284,134,442,119],[143,125,357,125]],
    chase:[null,null,null,null,[438,52],[359,58],[250,50]],
    board:[null,[279,177,347,148],[219,181,351,161],[152,174,328,174],[126,163,270,185],[145,149,202,176]],
  }
];

function mix(a,b,t) { return a+(b-a)*t; }
const clamp = (x,low,high) => Math.max(low,Math.min(high,x));

export function isLens(fixture) {
  return fixture.kind==='lens' || fixture.kind==='round';
}

export function projectFixture(f,heading,ring) {
  const mirrored = heading>6;
  const m = mirrored ? 12-heading : heading;
  const d = landmarks[ring], yaw = m*Math.PI/6;
  const [worldX,y,z] = f.anchor;
  const x = mirrored ? -worldX : worldX;
  const near = x>=0;
  const face = f.face === 'rear' ? 'rear' : f.face === 'front' ? 'front' : 'side';
  let px,py,normal = 1,tilt = 0, visible = true;
  const lens = d[f.mount]?.[m];
  const depthScale = 1 + .11*Math.cos(yaw)*(face==='rear'?-1:1);
  const unit = 100*depthScale;
  if (['beam','frontTurn','fog','tail'].includes(f.mount)) {
    if ((f.mount==='fog' && !near && m!==0) || !lens || (!near && !Number.isFinite(lens[2]))) return null;
    const originX = {beam:.73,frontTurn:.88,fog:.77,tail:.88}[f.mount];
    const originZ = {beam:1.02,frontTurn:1.035,fog:.60,tail:1.09}[f.mount];
    const baselineY = {beam:2.26,frontTurn:2.25,fog:2.31,tail:-2.30}[f.mount];
    px = lens[near?0:2]+(x-(near?originX:-originX))*unit*Math.cos(yaw)-(y-baselineY)*unit*Math.sin(yaw);
    const verticalScale = f.mount==='tail' && m<3 ? .3+.15*m : 1;
    py = lens[near?1:3]-(z-originZ)*unit*verticalScale;
    normal = Math.max(.38,Math.abs(Math.cos(yaw)));
    // Only the rear lens edge is seen when looking towards the vehicle's nose.
    if (f.mount==='tail' && m<3) normal=.24;
  } else if (face === 'side') {
    const facingSide = mirrored ? 'passenger' : 'driver';
    if (f.face!==facingSide || !d.board[m]) return null;
    const [fx,fy,rx,ry] = d.board[m], t=(1.12-y)/2.12;
    px=mix(fx,rx,t)+(x-.98)*unit*Math.cos(yaw);
    py=mix(fy,ry,t)-(z-.45)*unit;
    tilt=Math.atan2(ry-fy,rx-fx);
    if (tilt>Math.PI/2) tilt-=Math.PI;
    if (tilt< -Math.PI/2) tilt+=Math.PI;
    normal=Math.max(.24,Math.sin(yaw));
  } else if (face === 'front') {
    if (!d.grille[m]) return null;
    const [cx,cy,span,dy] = d.grille[m];
    px=cx+x*span/1.24-(y-2.34)*unit*Math.sin(yaw);
    py=cy+x*dy/1.24-(z-.70)*unit;
    normal=span/139;
    tilt=Math.atan2(dy,span);
    // The bumper corner on the far side of the vehicle is obscured obliquely.
    visible=!(m===2 && x<-.32) && !(m===1 && x<-.6);
  } else {
    if (!d.chase[m]) return null;
    const [cx,cy]=d.chase[m];
    px=cx+x*unit*Math.cos(yaw)-(y+2.26)*unit*Math.sin(yaw);
    py=cy-(z-1.86)*unit;
    normal=Math.max(.27,-Math.cos(yaw));
    tilt=(m===4 ? .095 : m===5 ? .055 : 0)*(ring ? -1:1);
  }
  if (!visible) return null;
  if (mirrored) { px=500-px; tilt=-tilt; }
  const view = ring+':'+heading;
  const position = f.corrections?.[view];
  if (position) [px,py]=[position[0]*500,position[1]*300];
  const size = isLens(f) ? f.viewSizes?.[view] : null;
  const w = size ? size[0]*500 : f.width*unit*normal;
  const h = size ? size[1]*300 : f.height*unit;
  return {x:px,y:py,w:Math.max(1.3,w),h:Math.max(1.2,h),tilt};
}

// Older per-photo adjustments are absolute points. Keep their calibrated offsets
// from the mount projection when moving the mount itself.
export function moveMount(f,anchor) {
  const before={...f,corrections:{}};
  const after={...before,anchor};
  const corrections={...f.corrections};
  for (const [view,point] of Object.entries(corrections)) {
    const [ring,heading]=view.split(':').map(Number);
    const origin=projectFixture(before,heading,ring), dest=projectFixture(after,heading,ring);
    if (origin && dest) {
      corrections[view]=[point[0]+(dest.x-origin.x)/500, point[1]+(dest.y-origin.y)/300];
    }
  }
  return {anchor,corrections};
}

// Resolve the drag along the tilted lens axes. Moving the center by half the
// accepted change keeps the diagonally opposite corner fixed even at the limits.
export function resizeLens(p,{sx,sy},dx,dy) {
  const cos=Math.cos(p.tilt), sin=Math.sin(p.tilt);
  const w=clamp(p.w+sx*(dx*cos+dy*sin),1.3,500);
  const h=clamp(p.h+sy*(dy*cos-dx*sin),1.2,300);
  const xShift=sx*(w-p.w)/2, yShift=sy*(h-p.h)/2;
  return {x:p.x+xShift*cos-yShift*sin,y:p.y+xShift*sin+yShift*cos,w,h};
}

export {clamp};

