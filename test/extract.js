/* Angles Maker — reading a figure with Gemini.
   The network call itself needs a key and is not exercised here; everything
   around it is: the request shape, the tolerant response parsing, the
   conversion into geometry, and the cross-check that catches a misread number. */
require('../js/core/geometry.js');
require('../js/core/svg.js');
require('../js/core/extract.js');
const E = AM.extract, G = AM.geometry;

let failures = 0, checks = 0;
const check = (name, ok, detail) => {
  checks++; if (!ok) failures++;
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? '   ' + detail : ''));
};

/* Two parallels cut by a transversal. The coordinates really do make the angle
   at E about 82 degrees, so a correct reading agrees with itself. */
const READING = {
  points: [{ id: 'A', x: 60, y: 300 }, { id: 'B', x: 940, y: 300 },
           { id: 'C', x: 60, y: 760 }, { id: 'D', x: 940, y: 760 },
           { id: 'E', x: 400, y: 300 }, { id: 'F', x: 465, y: 760 }],
  lines: [{ id: 'l1', from: 'A', to: 'B', kind: 'line', marks: 1 },
          { id: 'l2', from: 'C', to: 'D', kind: 'line', marks: 1 },
          { id: 't', from: 'E', to: 'F', kind: 'line', marks: 0 }],
  parallelGroups: [['l1', 'l2']],
  angles: [{ vertex: 'E', from: 'B', to: 'F', label: '82°' }],
  notes: ''
};

console.log('request');
{
  const r = E.buildRequest('QkFTRTY0', { mimeType: 'image/png' });
  check('asks for gemini-3.6-flash', r.model === 'gemini-3.6-flash', r.model);
  check('sends the crop as an inline image part',
        r.input[1].type === 'image' && r.input[1].data === 'QkFTRTY0' &&
        r.input[1].mime_type === 'image/png');
  check('demands JSON against a schema',
        r.response_format.mime_type === 'application/json' &&
        r.response_format.schema.required.includes('points'));
  check('the prompt forbids solving',
        /do not solve/i.test(r.input[0].text) && /do not invent/i.test(r.input[0].text));
}

console.log('\nresponse parsing');
{
  const wrapped = { output: [{ type: 'text', text: JSON.stringify(READING) }] };
  check('finds the payload inside an envelope', E.parseResponse(wrapped).points.length === 6);
  const fenced = { candidates: [{ content: { parts: [{ text: '```json\n' + JSON.stringify(READING) + '\n```' }] } }] };
  check('survives a markdown code fence', E.parseResponse(fenced).lines.length === 3);
  check('accepts a bare object', E.parseResponse(READING).angles.length === 1);
  let threw = null;
  try { E.parseResponse({ output: [{ text: 'sorry, I cannot help with that' }] }); }
  catch (e) { threw = e; }
  check('a response with no figure in it raises, and keeps the body for inspection',
        !!threw && !!threw.raw, threw && threw.raw.slice(0, 40));
}

console.log('\nconversion to geometry');
{
  const fig = E.toFigure(READING);
  check('points carry over', Object.keys(fig.points).length === 6);
  check('lines carry over with their parallel marks',
        fig.lines.length === 3 && fig.lines[0].ticks === 1);
  check('the parallel group becomes a constraint',
        fig.constraints.filter(c => c.type === 'parallel').length === 1);
  const drawn = G.measure(fig, fig.angles[0]);
  check('the drawn angle matches the label, so nothing is flagged',
        fig.conflicts.length === 0, 'drawn ' + drawn.toFixed(1) + '°, label 82°');
  check('the angle constraint is switched on',
        fig.constraints.some(c => c.type === 'angle' && c.enabled !== false));
  const r = G.solve(fig);
  check('the figure solves as read', r.ok, 'residual ' + r.residual.toExponential(1));
  const svg = AM.svg.render(fig);
  check('and renders', svg.startsWith('<svg') && svg.includes('82°'));
}

console.log('\ncatching a misread number');
{
  /* Same coordinates — the drawing is plainly about 82 degrees — but the label
     has come back as 32. One of the two readings is wrong, and the app must not
     quietly redraw the figure to match the wrong one. */
  const misread = JSON.parse(JSON.stringify(READING));
  misread.angles[0].label = '32°';
  const fig = E.toFigure(misread);
  check('the disagreement is reported', fig.conflicts.length === 1,
        fig.conflicts[0] && ('label says ' + fig.conflicts[0].claimed +
        '°, drawing measures ' + fig.conflicts[0].drawn + '°'));
  const c = fig.constraints.find(x => x.type === 'angle');
  check('its constraint is left switched off', c && c.enabled === false && c.suspect === true);
  const before = G.measure(fig, fig.angles[0]);
  G.solve(fig);
  const after = G.measure(fig, fig.angles[0]);
  check('solving does not bend the figure to the suspect value',
        Math.abs(after - before) < 0.5 && Math.abs(after - 32) > 20,
        'still ' + after.toFixed(1) + '°, not 32°');

  /* A small disagreement is just drawing slop and should pass. */
  const close = JSON.parse(JSON.stringify(READING));
  close.angles[0].label = '84°';
  check('a couple of degrees of slack is tolerated',
        E.toFigure(close).conflicts.length === 0);
}

console.log('\nthe call itself');
(async () => {
  let seen = null;
  globalThis.fetch = async (url, init) => {
    seen = { url, init };
    return { ok: true, status: 200,
             json: async () => ({ output: [{ type: 'text', text: JSON.stringify(READING) }] }) };
  };
  const fig = await E.readFigure('QUJD', 'test-key-123');
  check('the key travels in a header, never in the URL',
        seen.init.headers['x-goog-api-key'] === 'test-key-123' &&
        !/test-key-123/.test(seen.url), seen.url);
  check('a figure comes back', Object.keys(fig.points).length === 6);

  globalThis.fetch = async () => ({ ok: false, status: 429,
    json: async () => ({ error: { message: 'Resource exhausted' } }) });
  let msg = '';
  try { await E.readFigure('QUJD', 'k'); } catch (e) { msg = e.message; }
  check('quota errors are explained in Thai, not as a bare 429', /โควตา/.test(msg), msg);

  let missing = '';
  try { await E.readFigure('QUJD', ''); } catch (e) { missing = e.message; }
  check('a missing key is caught before any request', /API key/.test(missing), missing);

  console.log('\n' + (failures ? failures + ' of ' + checks + ' checks FAILED'
                               : 'all ' + checks + ' checks passed'));
  process.exit(failures ? 1 : 0);
})();
