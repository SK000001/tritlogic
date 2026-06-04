// I2 — guided, interactive in-canvas tutorials.
//
// Each tutorial is an ordered list of steps. A step shows an instruction and
// optionally:
//   • check(api)  — inspects the LIVE circuit; when it returns true the step is
//                   marked done (Next lights up). Steps with no check are purely
//                   informational and Next is always enabled.
//   • target      — a CSS selector for the UI element the user should act on; the
//                   driver pulses it so the next action is obvious.
//   • onEnter(api)— a hook run when the step is shown (load a preset, clear the
//                   canvas) to set the stage.
//
// The driver + the `api` object live in app.js; this file is pure data (closures
// over the api it is handed at runtime), so it loads with no DOM/engine deps.

export const TUTORIALS = {
  'first-gate': {
    name: 'Your first ternary gate',
    tagline: 'Toggle inputs through −1 / 0 / +1 and watch MIN & MAX respond.',
    steps: [
      {
        text: 'Balanced ternary uses <b>three</b> values: ' +
              '<span style="color:var(--t-neg)">T = −1</span>, ' +
              '<span style="color:var(--t-zero)">0</span>, and ' +
              '<span style="color:var(--t-pos)">+1</span>. We just loaded a ' +
              '<b>MIN</b> gate (ternary AND) and a <b>MAX</b> gate (ternary OR), ' +
              'each fed by two inputs, <b>a</b> and <b>b</b>.',
        onEnter: (api) => api.loadExample('min-max'),
      },
      {
        text: 'Click the input labelled <b>a</b> (top-left) until it shows ' +
              '<span style="color:var(--t-pos)">+1</span> (green). Each click ' +
              'cycles it T → 0 → +1.',
        check: (api) => { const a = api.byName('a'); return !!a && a.state.value === 1; },
      },
      {
        text: 'Now click input <b>b</b> until it shows ' +
              '<span style="color:var(--t-neg)">T</span> (−1, red).',
        check: (api) => { const b = api.byName('b'); return !!b && b.state.value === -1; },
      },
      {
        text: 'Look at the two probes. <b>MIN</b>(+1, −1) = ' +
              '<span style="color:var(--t-neg)">−1</span> — MIN returns the ' +
              '<i>smaller</i> value. <b>MAX</b>(+1, −1) = ' +
              '<span style="color:var(--t-pos)">+1</span> — MAX returns the ' +
              '<i>larger</i>. They are the ternary versions of AND and OR.',
      },
      {
        text: 'One more: set <b>both</b> inputs to ' +
              '<span style="color:var(--t-pos)">+1</span> and confirm both probes ' +
              'read +1 — when the inputs agree, so do MIN and MAX. That\'s your ' +
              'first ternary gates. Click <b>Finish</b>.',
        check: (api) => {
          const a = api.byName('a'), b = api.byName('b');
          return !!a && !!b && a.state.value === 1 && b.state.value === 1;
        },
      },
    ],
  },

  'build-inverter': {
    name: 'Build a ternary inverter',
    tagline: 'Place an input, a NEG gate, and a probe — then wire them up.',
    steps: [
      {
        text: 'Let\'s build a ternary <b>NOT</b> gate (called <b>NEG</b>, or STI) ' +
              'from scratch, on a blank canvas.',
        onEnter: (api) => api.clearCanvas(),
      },
      {
        text: 'Place an <b>Input</b>: click <b>Input</b> in the palette (under ' +
              '<i>Sources</i>), then click anywhere on the canvas to drop it.',
        target: '.pal-item[data-type="INPUT"]',
        check: (api) => api.countType('INPUT') >= 1,
      },
      {
        text: 'Place a <b>NEG</b> inverter: click <b>NEG</b> in the palette (under ' +
              '<i>Inverters</i>), then click the canvas to the <i>right</i> of your input.',
        target: '.pal-item[data-type="STI"]',
        check: (api) => api.countType('STI') >= 1,
      },
      {
        text: 'Place a <b>Probe</b> to read the result: click <b>Probe</b> (under ' +
              '<i>Sinks</i>), then click the canvas to the right of the NEG.',
        target: '.pal-item[data-type="OUTPUT"]',
        check: (api) => api.countType('OUTPUT') >= 1,
      },
      {
        text: 'Now wire it up. With the <b>Select</b> tool, drag from the ' +
              '<b>Input\'s</b> right-side pin to the <b>NEG\'s</b> left pin — then ' +
              'from the <b>NEG\'s</b> output to the <b>Probe</b>. (Click one pin then ' +
              'the other works too.)',
        target: '.pal-item[data-tool="select"]',
        check: (api) => api.wireBetween('INPUT', 'STI') && api.wireBetween('STI', 'OUTPUT'),
      },
      {
        text: 'Click your <b>Input</b> to set it to ' +
              '<span style="color:var(--t-pos)">+1</span>: NEG inverts it, so the ' +
              'Probe reads <span style="color:var(--t-neg)">−1</span>. Try −1 (→ +1) ' +
              'and 0 (stays 0). You built a working ternary inverter — click <b>Finish</b>.',
        check: (api) => {
          const i = api.firstType('INPUT'), o = api.firstType('OUTPUT');
          if (!i || !o) return false;
          const ov = api.inVal(o, 'in');
          return i.state.value !== 0 && ov !== null && ov === -i.state.value;
        },
      },
    ],
  },

  'run-cpu': {
    name: 'Run a ternary CPU',
    tagline: 'Load CPU2, assemble a tiny program, and watch the accumulator run.',
    steps: [
      {
        text: 'Finally, run a whole <b>ternary CPU</b>. We just loaded <b>CPU2</b> — ' +
              'a 9-instruction accumulator processor with its own assembler and debugger.',
        onEnter: (api) => api.loadExample('cpu2'),
      },
      {
        text: 'Open the <b>Assemble</b> dialog from the toolbar. It lets you write a ' +
              'short ternary-assembly program and load it into the CPU\'s instruction ' +
              'memory (IMEM).',
        target: '#btn-asm',
        check: (api) => api.modalOpen('asm-modal'),
      },
      {
        text: 'A sample program is pre-filled (it climbs the accumulator with ADDI). ' +
              'Click <b>Assemble &amp; Load into IMEM</b>, then <b>close</b> the dialog.',
      },
      {
        text: 'Press <b>▶ Play</b> in the toolbar and watch the accumulator climb. ' +
              'Open <b>Debug</b> to single-step and see PC / ACC / the decoded ' +
              'instruction live. You\'ve run a ternary processor — click <b>Finish</b>.',
        target: '#btn-play',
      },
    ],
  },
};

// Grouped list for the picker UI. Keys must exist in TUTORIALS.
export const TUTORIAL_LIST = [
  ['Start here', ['first-gate', 'build-inverter']],
  ['Go further', ['run-cpu']],
];
