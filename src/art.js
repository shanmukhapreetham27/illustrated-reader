/* Deterministic SVG illustration engine.
   Art.render(spec) -> SVG markup. The same spec always gives byte-identical
   markup: there is no Math.random and no clock. Texture that looks random (rain,
   leg angles, fabric) comes from a PRNG seeded by the figure id, and every
   coordinate is rounded to 0.1 before it is written out.
   Each drawn element is a <g data-el="key"> matching an element of the spec,
   and each element has a numbered pin that the reader shows on request. */
const Art = (() => {
  'use strict';

  function hash(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h >>> 0;
  }
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const n = v => { const r = Math.round(v * 10) / 10; return Object.is(r, -0) ? '0' : String(r); };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const rad = d => d * Math.PI / 180;
  // Angle in degrees clockwise from 12 o'clock, like a clock hand.
  const polar = (cx, cy, r, deg) => [cx + r * Math.sin(rad(deg)), cy - r * Math.cos(rad(deg))];
  const P = (x, y) => n(x) + ',' + n(y);
  const g = (key, body) => `<g class="el" data-el="${key}">${body}</g>`;
  const stroke = (d, cls = '') => `<path class="k n ${cls}" d="${d}"/>`;

  // ---------------------------------------------------------------- ¶1 bed
  function bed(p, r) {
    const out = [], pins = {};
    out.push('<rect class="plate" width="480" height="320" rx="8"/>');
    out.push('<rect class="w1" y="286" width="480" height="34"/>' + stroke('M0,286 H480', 'k1'));
    out.push('<ellipse class="shade" cx="252" cy="291" rx="196" ry="5"/>');

    out.push(g('bed',
      '<rect class="wood k" x="98" y="250" width="12" height="38"/>' +
      '<rect class="wood k" x="398" y="250" width="12" height="38"/>' +
      '<rect class="wood k" x="52" y="112" width="40" height="176" rx="12"/>' +
      stroke('M72,130 V272', 'k1') +
      '<rect class="wood k" x="414" y="168" width="30" height="120" rx="9"/>' +
      '<rect class="wood k" x="88" y="236" width="330" height="18" rx="3"/>' +
      '<rect class="linen k" x="88" y="206" width="330" height="30" rx="9"/>' +
      '<path class="linen k" d="M98,200 Q100,184 140,184 Q182,184 184,198 Q182,210 140,210 Q100,210 98,200 Z"/>'));
    pins.bed = [72, 98];

    // Body: an ellipse lying on its back. Lower band = shell, upper dome = belly.
    const cx = 268, cy = 172, rx = 116, ry = 38, rimY = 180;
    const half = rx * Math.sqrt(1 - ((rimY - cy) / ry) ** 2);
    const xL = cx - half, xR = cx + half, span = xR - xL;
    const yTop = x => cy - ry * Math.sqrt(Math.max(0, 1 - ((x - cx) / rx) ** 2));
    const yRim = x => { const t = (x - xL) / span; return rimY + 32 * t * (1 - t); };

    out.push(g('back',
      `<path class="shell k" d="M${P(xL, rimY)} A${rx},${ry} 0 0 0 ${P(xR, rimY)} Q${P(cx, rimY + 16)} ${P(xL, rimY)} Z"/>` +
      stroke(`M${P(xL + 22, 193)} Q${P(cx, 214)} ${P(xR - 22, 193)}`, 'sheen')));
    pins.back = [236, 216];

    let arches = '';
    for (let i = 1; i <= 8; i++) {
      const x = xL + i * span / 9, y0 = yRim(x), y1 = yTop(x - 3) + 2;
      arches += stroke(`M${P(x, y0)} Q${P(x - 9, (y0 + y1) / 2)} ${P(x - 3, y1)}`, 'k1');
    }
    out.push(g('belly',
      `<path class="belly k" d="M${P(xL, rimY)} Q${P(cx, rimY + 16)} ${P(xR, rimY)} A${rx},${ry} 0 1 0 ${P(xL, rimY)} Z"/>` +
      arches + stroke(`M${P(xL + 34, 151)} Q${P(cx, 129)} ${P(xR - 40, 150)}`, 'sheen')));
    pins.belly = [256, 158];

    out.push(g('head',
      '<ellipse class="shell k" cx="141" cy="166" rx="17" ry="14" transform="rotate(-28 141 166)"/>' +
      '<circle class="inkf" cx="134" cy="160" r="2.4"/>' +
      stroke('M131,155 Q118,137 99,131 M127,161 Q111,151 92,152', 'k1') +
      stroke('M127,173 l-7,4 M130,177 l-5,7', 'k1')));
    pins.head = [112, 190];

    // Legs: thin two-segment legs waving from the dome; angles from the PRNG.
    const count = p.legs || 8;
    let legs = '';
    const tips = [];
    for (let i = 0; i < count; i++) {
      const x = 170 + i * 21, by = yTop(x) + 5;
      const a1 = -90 + (i - (count - 1) / 2) * 7 + (r() - 0.5) * 26;
      const l1 = 24 + r() * 10;
      const kx = x + l1 * Math.cos(rad(a1)), ky = by + l1 * Math.sin(rad(a1));
      const a2 = a1 + (i % 2 ? 40 : -40) + (r() - 0.5) * 20;
      const l2 = 20 + r() * 10;
      const fx = kx + l2 * Math.cos(rad(a2)), fy = ky + l2 * Math.sin(rad(a2));
      const cx2 = fx + 6 * Math.cos(rad(a2 + 70)), cy2 = fy + 6 * Math.sin(rad(a2 + 70));
      legs += stroke(`M${P(x, by)} L${P(kx, ky)} L${P(fx, fy)} L${P(cx2, cy2)}`, 'leg');
      tips.push([fx, fy]);
    }
    for (const i of [0, 3, 6]) {
      if (!tips[i]) continue;
      const [fx, fy] = tips[i];
      legs += stroke(`M${P(fx + 9, fy - 6)} q5,5 0,11 M${P(fx - 9, fy - 6)} q-5,5 0,11`, 'k1 soft');
    }
    out.push(g('legs', legs));
    pins.legs = [158, 92];

    const by0 = yTop(322);
    out.push(g('bedding',
      `<path class="blanket k" d="M${P(322, by0)} C345,136 372,150 386,176 L412,206 L418,266 Q372,284 318,270 Q306,236 312,206 Q314,170 ${P(322, by0)} Z"/>` +
      stroke('M322,257 Q370,272 414,254', 'hem') +
      stroke('M342,152 Q352,200 344,262 M372,164 Q386,212 388,272', 'k1 soft') +
      stroke('M398,286 l9,7 M378,288 l9,7', 'k1')));
    pins.bedding = [394, 232];
    return { body: out.join(''), pins };
  }

  // ---------------------------------------------------------------- ¶2 room
  function room(p, r, uid) {
    const out = [], pins = {};
    // One-point perspective, vanishing point (240,130), back wall 100..380 x 40..246.
    const defs =
      `<pattern id="${uid}-st" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(35)"><rect width="7" height="7" class="fab2"/><rect width="3" height="7" class="inkf" opacity=".28"/></pattern>` +
      `<pattern id="${uid}-ck" width="10" height="10" patternUnits="userSpaceOnUse"><rect width="10" height="10" class="fab1"/><rect width="5" height="10" class="inkf" opacity=".16"/><rect width="10" height="5" class="inkf" opacity=".16"/></pattern>` +
      `<pattern id="${uid}-dt" width="8" height="8" patternUnits="userSpaceOnUse"><rect width="8" height="8" class="fab3"/><circle cx="4" cy="4" r="1.4" class="facef" opacity=".7"/></pattern>` +
      `<pattern id="${uid}-hb" width="8" height="8" patternUnits="userSpaceOnUse"><rect width="8" height="8" class="fab4"/><path d="M0,8 L4,0 L8,8" class="k n" stroke-width="1" opacity=".35"/></pattern>`;
    out.push('<rect class="plate" width="480" height="320" rx="8"/>');
    out.push(g('small', '<path class="w1 k k1" d="M37.8,0 H442.2 L380,40 H100 Z"/>'));
    pins.small = [240, 20];
    let planks = '';
    for (let x = 135; x < 380; x += 35) {
      const xb = 240 + (x - 240) * (190 / 116);
      planks += stroke(`M${P(x, 246)} L${P(xb, 320)}`, 'k1 soft');
    }
    out.push(g('walls',
      '<path class="w2 k k1" d="M0,0 H37.8 L100,40 V246 L10.7,320 H0 Z"/>' +
      '<path class="w2 k k1" d="M480,0 H442.2 L380,40 V246 L469.3,320 H480 Z"/>' +
      '<rect class="w1 k k1" x="100" y="40" width="280" height="206"/>' +
      '<path class="floor k k1" d="M100,246 H380 L469.3,320 H10.7 Z"/>' + planks));
    pins.walls = [42, 150];

    // Table against the back wall.
    let table =
      '<rect class="wood k" x="156" y="212" width="8" height="34"/><rect class="wood k" x="316" y="212" width="8" height="34"/>' +
      '<path class="wood k" d="M150,194 H330 L342,214 H138 Z"/>' +
      '<rect class="wood k" x="138" y="214" width="204" height="10"/>' +
      '<rect class="wood k" x="144" y="224" width="9" height="40"/><rect class="wood k" x="327" y="224" width="9" height="40"/>';
    // Samples spread on the top, two hanging over the front edge.
    const fills = [`url(#${uid}-st)`, `url(#${uid}-ck)`, `url(#${uid}-dt)`, `url(#${uid}-hb)`];
    const spots = [[170, 197], [205, 199], [246, 196], [282, 198], [310, 200]];
    let samples = '';
    spots.forEach(([x, y], i) => {
      const w = 26 + r() * 10, sk = (r() - 0.5) * 8;
      samples += `<path class="k k1" fill="${fills[i % 4]}" d="M${P(x, y)} h${n(w)} l${n(4 + sk)},12 h${n(-w - 2)} Z"/>`;
    });
    samples += `<path class="k k1" fill="${fills[1]}" d="M214,210 h30 l-1,28 q-14,4 -28,0 Z"/>`;
    samples += `<path class="k k1" fill="${fills[2]}" d="M268,210 h26 l2,22 q-13,5 -27,1 Z"/>`;
    out.push(table);
    out.push(g('samples', samples));
    pins.samples = [300, 250];

    out.push(g('frame',
      '<rect class="ochre k" x="196" y="56" width="88" height="114" rx="3"/>' +
      '<rect class="ochre2 k k1" x="203" y="63" width="74" height="100"/>' +
      [[199, 59], [281, 59], [199, 167], [281, 167]].map(([x, y]) => `<circle class="ochre k k1" cx="${x}" cy="${y}" r="4.5"/>`).join('') +
      '<rect class="facef k k1" x="208" y="68" width="64" height="90"/>' + stroke('M240,56 L232,46 L248,46 Z', 'k1')));
    pins.frame = [294, 66];

    out.push(g('lady',
      '<path class="w3 k k1" d="M226,112 H254 L264,158 H216 Z"/>' +
      '<circle class="facef k k1" cx="240" cy="96" r="9"/>' +
      '<path class="fur k k1" d="M229,92 Q229,76 240,76 Q251,76 251,92 q-2.75,-3 -5.5,0 q-2.75,-3 -5.5,0 q-2.75,-3 -5.5,0 q-2.75,-3 -5.5,0 Z"/>' +
      '<path class="fur k k1" d="M222,110 q4.5,-6 9,0 q4.5,-6 9,0 q4.5,-6 9,0 q4.5,-6 9,0 l-1,8 q-4,4 -8,0 q-4,4 -8,0 q-4,4 -8,0 q-4,4 -8,0 Z"/>' +
      stroke('M253,114 Q262,124 252,130', 'k1')));
    pins.lady = [214, 88];

    out.push(g('muff',
      '<path class="fur k k1" d="M233,126 q4,-5 8,0 q4,-5 8,0 q4,-5 8,0 q5,8 0,17 q-4,5 -8,0 q-4,5 -8,0 q-4,5 -8,0 q-5,-8 0,-17 Z"/>' +
      '<ellipse class="w3 k k1" cx="257" cy="134.5" rx="3" ry="6"/>'));
    pins.muff = [270, 128];
    return { defs, body: out.join(''), pins };
  }

  // -------------------------------------------------------------- ¶3 window
  function windowScene(p, r, uid) {
    const out = [], pins = {};
    const ox = 114, oy = 44, ow = 252, oh = 210;
    const defs = `<clipPath id="${uid}-g"><rect x="${ox}" y="${oy}" width="${ow}" height="${oh}"/></clipPath>`;
    out.push('<rect class="plate" width="480" height="320" rx="8"/>');
    out.push('<rect class="w1" x="0" y="0" width="480" height="320" rx="8"/>');

    let weather = `<rect class="sky" x="${ox}" y="${oy}" width="${ow}" height="${oh}"/>`;
    weather += '<path class="fog" d="M114,92 Q170,76 226,90 T366,84 V122 Q300,112 240,122 T114,118 Z"/>';
    weather += '<path class="fog" d="M114,190 Q180,176 250,192 T366,186 V254 H114 Z"/>';
    let streaks = '';
    for (let i = 0; i < 70; i++) {
      const x = ox + r() * ow, y = oy + r() * oh, len = 10 + r() * 14;
      streaks += `M${P(x, y)} l${n(-len * 0.276)},${n(len * 0.961)} `;
    }
    weather += `<path class="rain n" d="${streaks.trim()}"/>`;
    out.push(g('weather', `<g clip-path="url(#${uid}-g)">${weather}</g>`));
    pins.weather = [306, 104];

    // Drops on the glass, kept off the mullions.
    let drops = '';
    const panes = [[ox, oy, 121, 100], [245, oy, 121, 100], [ox, 154, 121, 100], [245, 154, 121, 100]];
    for (let i = 0; i < 34; i++) {
      const [px, py, pw, ph] = panes[i % 4];
      const x = px + 8 + r() * (pw - 16), y = py + 10 + r() * (ph - 18);
      const rr = 1.8 + r() * r() * 4.6;
      const trail = 3 + r() * 12;
      drops += stroke(`M${P(x, y - rr)} l0,${n(-trail)}`, 'trail');
      drops += `<circle class="drop" cx="${n(x)}" cy="${n(y)}" r="${n(rr)}"/>`;
      drops += `<circle class="facef" cx="${n(x - rr * 0.35)}" cy="${n(y - rr * 0.35)}" r="${n(rr * 0.32)}" opacity=".85"/>`;
      if (i % 9 === 4) drops += stroke(`M${P(x - rr - 2, y)} l-4,-2 M${P(x + rr + 2, y)} l4,-2 M${P(x, y - rr - 3)} l0,-3`, 'trail');
    }
    out.push(g('rain', `<g clip-path="url(#${uid}-g)">${drops}</g>`));
    pins.rain = [180, 208];

    out.push(g('window',
      `<path class="wood k" fill-rule="evenodd" d="M98,28 H382 V270 H98 Z M${ox},${oy} V${oy + oh} H${ox + ow} V${oy} Z"/>` +
      `<rect class="wood k" x="235" y="${oy}" width="10" height="${oh}"/>` +
      `<rect class="wood k" x="${ox}" y="144" width="${ow}" height="10"/>` +
      '<rect class="wood k" x="86" y="270" width="308" height="14" rx="2"/>' +
      '<rect class="shade" x="96" y="284" width="288" height="6"/>'));
    pins.window = [98, 150];
    return { defs, body: out.join(''), pins };
  }

  // ------------------------------------------------------- ¶5 desk (imagined)
  function desk(p, r) {
    const out = [], pins = {};
    out.push('<rect class="plate" width="480" height="320" rx="8"/>');
    out.push('<rect class="facef k dash" x="10" y="10" width="460" height="300" rx="26"/>');
    out.push('<text class="lbl caps" x="34" y="42">Imagined</text>');
    out.push(stroke('M40,292 H440', 'k1'));

    out.push(g('fall',
      stroke('M372,46 q14,12 6,30 M386,40 q18,16 8,40', 'k1') +
      stroke('M352,108 l14,-6 M354,118 l15,-2', 'k1 soft')));
    pins.fall = [402, 34];

    out.push(g('talk',
      '<path class="w3 k" d="M302,112 L292,78 Q312,64 338,72 L352,112 Z"/>' +
      '<circle class="facef k" cx="284" cy="62" r="15"/>' +
      stroke('M271,58 q-2,4 0,8', 'k1') + '<circle class="inkf" cx="278" cy="58" r="1.8"/>' +
      stroke('M268,70 l-6,4', 'k1') +
      stroke('M258,82 l-16,12 M262,92 l-15,16 M253,74 l-19,6', 'k1')));
    pins.talk = [234, 64];

    out.push(g('ear',
      stroke('M330,84 Q318,58 300,54', '') +
      '<path class="facef k k1" d="M298,48 q6,-2 7,5 q1,7 -6,9 q-5,-4 -1,-14 Z"/>'));
    pins.ear = [312, 30];

    out.push(g('desk',
      '<path class="wood k" d="M262,112 H410 L402,124 H270 Z"/>' +
      '<rect class="wood k" x="270" y="124" width="132" height="168"/>' +
      '<rect class="w2 k k1" x="284" y="140" width="104" height="58" rx="2"/>' +
      '<rect class="w2 k k1" x="284" y="212" width="104" height="66" rx="2"/>' +
      '<path class="facef k k1" d="M318,104 l30,-3 l2,10 l-30,3 Z"/>'));
    pins.desk = [414, 206];

    out.push(g('close',
      '<path class="w3 k" d="M206,206 Q222,198 238,206 L248,282 H198 Z"/>' +
      stroke('M226,292 V282 M214,292 V282', '') +
      '<circle class="facef k" cx="226" cy="190" r="12"/>' +
      '<path class="w3 k k1" d="M213,184 q13,-14 26,0 Z"/><path class="k n k1" d="M209,184 H243"/>' +
      stroke('M238,214 Q256,226 262,238', '') +
      '<rect class="ochre k" x="176" y="246" width="30" height="22" rx="3"/>' + stroke('M186,246 v-5 h10 v5', 'k1') +
      stroke('M208,216 Q196,232 192,246', '')));
    pins.close = [174, 196];
    return { body: out.join(''), pins };
  }

  // ---------------------------------------------------------------- ¶6 clock
  function clock(p) {
    const out = [], pins = {};
    const t = s => { const [h, m] = String(s).split(':').map(Number); return { hour: ((h % 12) + m / 60) * 30, min: m * 6 }; };
    const now = t(p.now || '6:45'), earlier = t(p.earlier || '6:30'), alarm = t(p.alarm || '4:00');
    const cx = 240, cy = 112;
    out.push('<rect class="plate" width="480" height="320" rx="8"/>');
    out.push('<rect class="w1" y="290" width="480" height="30"/>' + stroke('M0,290 H480', 'k1'));

    out.push(g('chest',
      '<rect class="wood k" x="100" y="180" width="280" height="12" rx="2"/>' +
      '<rect class="wood k" x="112" y="192" width="256" height="92"/>' +
      [200, 229, 258].map(y => `<rect class="wood2 k k1" x="122" y="${y}" width="236" height="24" rx="2"/>` +
        `<circle class="ochre k k1" cx="190" cy="${y + 12}" r="3.5"/><circle class="ochre k k1" cx="290" cy="${y + 12}" r="3.5"/>`).join('') +
      '<rect class="wood k" x="118" y="284" width="14" height="6"/><rect class="wood k" x="348" y="284" width="14" height="6"/>'));
    pins.chest = [384, 238];

    let face = '';
    for (let i = 0; i < 60; i++) {
      const [x1, y1] = polar(cx, cy, 46, i * 6), [x2, y2] = polar(cx, cy, i % 5 ? 42.5 : 38, i * 6);
      face += `M${P(x1, y1)} L${P(x2, y2)} `;
    }
    const nums = [[12, 0], [3, 90], [6, 180], [9, 270]].map(([v, a]) => {
      const [x, y] = polar(cx, cy, 29, a);
      return `<text class="lbl num" x="${n(x)}" y="${n(y + 5)}" text-anchor="middle">${v}</text>`;
    }).join('');
    const [b1x, b1y] = polar(cx, cy, 58, -36), [b2x, b2y] = polar(cx, cy, 58, 36);
    out.push(g('clock',
      stroke(`M${P(cx - 22, cy + 50)} L${P(cx - 32, cy + 68)} M${P(cx + 22, cy + 50)} L${P(cx + 32, cy + 68)}`, 'k3') +
      `<circle class="w3 k" cx="${n(b1x)}" cy="${n(b1y)}" r="16"/><circle class="w3 k" cx="${n(b2x)}" cy="${n(b2y)}" r="16"/>` +
      stroke(`M${P(cx, cy - 56)} V${n(cy - 70)}`, 'k3') + `<circle class="w3 k" cx="${cx}" cy="${cy - 72}" r="4"/>` +
      `<circle class="w3 k" cx="${cx}" cy="${cy}" r="56"/><circle class="facef k k1" cx="${cx}" cy="${cy}" r="48"/>` +
      `<path class="k n tick" d="${face.trim()}"/>` + nums +
      stroke('M158,82 q-8,10 0,20 M148,76 q-12,16 0,32 M322,82 q8,10 0,20 M332,76 q12,16 0,32', 'k1 soft')));
    pins.clock = [312, 50];

    const hand = (deg, len, cls) => { const [x, y] = polar(cx, cy, len, deg); return stroke(`M${P(cx, cy)} L${P(x, y)}`, cls); };
    const [g1x, g1y] = polar(cx, cy, 43, earlier.min + 6), [g2x, g2y] = polar(cx, cy, 43, now.min - 6);
    out.push(g('halfpast',
      hand(earlier.min, 38, 'ghost') +
      stroke(`M${P(g1x, g1y)} A43,43 0 0 1 ${P(g2x, g2y)}`, 'k1 soft') +
      (() => { const [ax, ay] = polar(cx, cy, 43, now.min - 6), [bx, by] = polar(cx, cy, 39, now.min - 13), [dx, dy] = polar(cx, cy, 47, now.min - 13);
        return stroke(`M${P(bx, by)} L${P(ax, ay)} L${P(dx, dy)}`, 'k1 soft'); })()));
    pins.halfpast = [262, 176];

    const [atx, aty] = polar(cx, cy, 34, alarm.hour);
    out.push(g('alarm',
      stroke(`M${P(cx, cy)} L${P(atx, aty)}`, 'alarmhand') +
      `<circle class="ochre k k1" cx="${n(atx)}" cy="${n(aty)}" r="4"/>`));
    pins.alarm = [290, 148];

    out.push(g('quarter',
      hand(now.hour, 25, 'k3') + hand(now.min, 40, 'k') + `<circle class="inkf" cx="${cx}" cy="${cy}" r="4"/>`));
    pins.quarter = [182, 126];
    return { body: out.join(''), pins };
  }

  // ---------------------------------------------------------- ¶7 floor plan
  function doors(p) {
    const out = [], pins = {};
    out.push('<rect class="plate" width="480" height="320" rx="8"/>');
    out.push('<rect class="floor" x="120" y="70" width="240" height="200"/>');
    // Walls (centre lines x 115/365, y 65/275) with gaps for three doors and a window.
    out.push(stroke('M110,65 H216 M256,65 H370 M115,60 V180 M115,220 V280 M365,60 V150 M365,190 V280 M110,275 H250 M330,275 H370', 'wall'));
    out.push(stroke('M250,271 H330 M250,279 H330', 'k1') + '<text class="lbl small" x="290" y="300" text-anchor="middle">window</text>');

    const door = (x1, y1, x2, y2, arc) => stroke(`M${x1},${y1} L${x2},${y2}`, 'door') + stroke(arc, 'k1 soft dash');
    const lock = (x, y) => `<circle class="ochre k k1" cx="${x}" cy="${y}" r="5"/>` + stroke(`M${x},${y + 1} v5`, 'k1');
    const person = (x, y, letter, name, tx, ty, anchor) =>
      `<circle class="facef k" cx="${x}" cy="${y}" r="14"/><text class="lbl" x="${x}" y="${y + 5}" text-anchor="middle">${letter}</text>` +
      `<text class="lbl small" x="${tx}" y="${ty}" text-anchor="${anchor}">${name}</text>`;

    out.push(g('bed',
      '<rect class="linen k" x="138" y="80" width="66" height="122" rx="5"/>' +
      '<rect class="w1 k k1" x="146" y="86" width="50" height="18" rx="6"/>' +
      '<ellipse class="belly k" cx="171" cy="146" rx="21" ry="32"/>' +
      stroke('M152,134 H190 M151,146 H191 M152,158 H190 M155,170 H187', 'k1') +
      '<circle class="shell k k1" cx="171" cy="110" r="7"/>' +
      stroke('M150,128 l-8,-4 M149,142 l-9,0 M150,156 l-8,4 M192,128 l8,-4 M193,142 l9,0 M192,156 l8,4', 'k1') +
      '<rect class="blanket k k1" x="140" y="168" width="62" height="32" rx="4"/>'));
    pins.bed = [212, 196];

    out.push(g('mother',
      door(216, 65, 256, 65, 'M216,65 A40,40 0 0 0 256,105') + lock(250, 76) +
      person(236, 30, 'M', 'Mother', 258, 26, 'start') +
      stroke('M226,48 q10,5 20,0', 'k1')));
    pins.mother = [306, 40];

    out.push(g('father',
      door(115, 180, 115, 220, 'M115,180 A40,40 0 0 1 155,220') + lock(126, 214) +
      person(70, 200, 'F', 'Father', 70, 234, 'middle') +
      stroke('M90,190 q8,10 0,20 M98,186 q10,14 0,28', 'k3')));
    pins.father = [40, 168];

    out.push(g('sister',
      door(365, 150, 365, 190, 'M365,150 A40,40 0 0 0 325,190') + lock(354, 184) +
      person(410, 170, 'S', 'Sister', 410, 204, 'middle') +
      stroke('M390,162 q-6,8 0,16 M383,158 q-8,12 0,24', 'k1 dash')));
    pins.sister = [446, 140];

    out.push(g('locked',
      '<rect class="ochre k k1" x="296" y="216" width="22" height="16" rx="3"/>' + stroke('M300,216 v-6 a7,7 0 0 1 14,0 v6', 'k1') +
      '<text class="lbl small" x="307" y="252" text-anchor="middle">all locked</text>'));
    pins.locked = [334, 208];
    return { body: out.join(''), pins };
  }

  const SCENES = { bed, room, window: windowScene, desk, clock, doors };

  function pin(x, y, num, key) {
    return `<g class="pin" data-k="${key}"><circle class="pin-c" cx="${n(x)}" cy="${n(y)}" r="11"/>` +
      `<text class="pin-t" x="${n(x)}" y="${n(y + 4.3)}" text-anchor="middle">${num}</text></g>`;
  }

  function render(spec) {
    const scene = SCENES[spec.scene];
    if (!scene) throw new Error('unknown scene ' + spec.scene);
    const r = rng(hash(spec.id + ':' + spec.scene));
    const { defs = '', body, pins } = scene(spec.params || {}, r, 'art-' + spec.id);
    const marks = spec.elements.map(e => {
      const at = pins[e.key];
      if (!at) throw new Error(`scene ${spec.scene} has no element ${e.key}`);
      return pin(at[0], at[1], e.n, e.key);
    }).join('');
    return `<svg class="art" viewBox="0 0 480 320" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${esc(spec.title)}">` +
      (defs ? `<defs>${defs}</defs>` : '') + body + `<g class="pins">${marks}</g></svg>`;
  }

  function fingerprint(spec) { return hash(render(spec)).toString(16).padStart(8, '0'); }

  return { render, fingerprint, hash, scenes: Object.keys(SCENES) };
})();
if (typeof module !== 'undefined') module.exports = Art;
