/* Angles Maker — read one cropped figure into the geometry model.
   The model is asked to report only what is drawn: no solving, no filling in
   unknowns. Everything it returns is then cross-checked against itself. */
(function (root) {
  'use strict';
  const AM = root.AM || (root.AM = {});

  const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/interactions';
  const MODEL = 'gemini-3.6-flash';

  const PROMPT = [
    'This is one geometry figure cut from a Thai mathematics workbook chapter on parallel lines.',
    'Report exactly what is DRAWN. Do not solve anything, do not compute unknown angles, and do',
    'not correct the figure. If a value is not written on the figure, do not invent it.',
    '',
    'Coordinates: use a 0-1000 grid, x to the right, y downward, over the image as given.',
    '',
    'points: every labelled point, every place two drawn lines cross, and the end of every line.',
    '  Give each an id. Use the printed letter as the id when there is one (A, B, E, ...);',
    '  otherwise use p1, p2, ... and leave label empty.',
    'lines: each straight stroke, as two point ids it passes through.',
    '  kind is "line" when arrowheads appear at both ends, "ray" when at one end,',
    '  "segment" when at neither. marks is the number of little arrow or tick marks drawn ON',
    '  the line to show which lines are parallel (0 when there are none).',
    'parallelGroups: ids of lines carrying the same parallel marks, grouped together.',
    'angles: each angle that has an arc, a square corner, or a label. Give the vertex point id',
    '  and the two point ids the two arms run towards. label is the text printed at that angle,',
    '  copied character for character: "82°", "x", "y", "x + 50°", "2x". Empty string if the',
    '  angle is marked but carries no text. Set rightAngle true only where a square corner is',
    '  drawn.',
    'notes: anything ambiguous, unreadable, or that you were unsure about.'
  ].join('\n');

  const SCHEMA = {
    type: 'object',
    properties: {
      points: {
        type: 'array',
        items: {
          type: 'object',
          properties: { id: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' },
                        label: { type: 'string' } },
          required: ['id', 'x', 'y']
        }
      },
      lines: {
        type: 'array',
        items: {
          type: 'object',
          properties: { id: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' },
                        kind: { type: 'string', enum: ['line', 'ray', 'segment'] },
                        marks: { type: 'integer' } },
          required: ['id', 'from', 'to', 'kind']
        }
      },
      parallelGroups: { type: 'array', items: { type: 'array', items: { type: 'string' } } },
      angles: {
        type: 'array',
        items: {
          type: 'object',
          properties: { vertex: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' },
                        label: { type: 'string' }, rightAngle: { type: 'boolean' } },
          required: ['vertex', 'from', 'to']
        }
      },
      notes: { type: 'string' }
    },
    required: ['points', 'lines', 'angles']
  };

  /* Finding the figures on a page. Kept as its own call from reading one
     figure's geometry: asking for both at once means twenty diagrams parsed in
     a single pass, and the ones near the bottom of the page suffer for it. */
  const FIND_PROMPT = [
    'This is one page of a Thai mathematics workbook, already straightened and cleaned.',
    'Find every geometry DIAGRAM on the page — the drawings made of straight lines, angles,',
    'triangles and polygons that belong to the questions.',
    '',
    'Return one entry per diagram, with a bounding box on a 0-1000 grid measured over the whole',
    'image, x to the right and y downward. The box must contain the whole drawing including any',
    'letters and angle values printed on it, and must NOT contain the question sentence above it',
    'or the multiple-choice answers beside it.',
    '',
    'question is the printed question number the diagram belongs to, as digits, when one is',
    'visible near it; otherwise an empty string.',
    '',
    'Ignore running text, headings, page numbers, decorative rules, clip-art icons and anything',
    'faintly showing through from the other side of the paper.'
  ].join('\n');

  const FIND_SCHEMA = {
    type: 'object',
    properties: {
      figures: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            question: { type: 'string' },
            x: { type: 'number' }, y: { type: 'number' },
            width: { type: 'number' }, height: { type: 'number' }
          },
          required: ['x', 'y', 'width', 'height']
        }
      }
    },
    required: ['figures']
  };

  function buildFindRequest(base64, options) {
    const o = options || {};
    return {
      model: o.model || MODEL,
      input: [
        { type: 'text', text: o.prompt || FIND_PROMPT },
        { type: 'image', data: base64, mime_type: o.mimeType || 'image/png' }
      ],
      response_format: { type: 'text', mime_type: 'application/json', schema: FIND_SCHEMA }
    };
  }

  function parseFindResponse(body) {
    const seen = [];
    const walk = node => {
      if (typeof node === 'string') { seen.push(node); return; }
      if (Array.isArray(node)) { node.forEach(walk); return; }
      if (node && typeof node === 'object') { for (const k in node) walk(node[k]); }
    };
    walk(body);
    for (const s of seen) {
      const t = s.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
      if (t[0] !== '{') continue;
      try {
        const parsed = JSON.parse(t);
        if (parsed && Array.isArray(parsed.figures)) return parsed;
      } catch (e) { /* keep looking */ }
    }
    if (body && Array.isArray(body.figures)) return body;
    const err = new Error('ไม่พบรูปในคำตอบของ Gemini');
    err.raw = JSON.stringify(body).slice(0, 1200);
    throw err;
  }

  /* 0-1000 grid to pixels, with the boxes sorted into reading order and any
     nonsense dropped rather than handed on. */
  function toBoxes(found, width, height, options) {
    const o = Object.assign({ minSide: 0.02, maxArea: 0.7, pad: 0.02 }, options || {});
    const out = [];
    for (const f of (found && found.figures) || []) {
      const x = (+f.x || 0) / 1000 * width, y = (+f.y || 0) / 1000 * height;
      const w = (+f.width || 0) / 1000 * width, h = (+f.height || 0) / 1000 * height;
      if (!(w > 0 && h > 0)) continue;
      if (w < o.minSide * width && h < o.minSide * height) continue;
      if (w * h > o.maxArea * width * height) continue;
      const pad = Math.round(o.pad * Math.max(w, h));
      const x0 = Math.max(0, Math.round(x - pad)), y0 = Math.max(0, Math.round(y - pad));
      out.push({
        x: x0, y: y0,
        w: Math.min(width, Math.round(x + w + pad)) - x0,
        h: Math.min(height, Math.round(y + h + pad)) - y0,
        question: (f.question || '').replace(/[^\d]/g, '')
      });
    }
    return AM.detect ? AM.detect.readingOrder(out) : out;
  }

  /* A request that never answers is worse than one that fails: the interface
     sits on a spinner with nothing to act on. */
  function withTimeout(o) {
    if (o.signal || !o.timeoutMs || typeof AbortController === 'undefined') {
      return { signal: o.signal, done: () => {} };
    }
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), o.timeoutMs);
    return { signal: ac.signal, done: () => clearTimeout(t) };
  }
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  /* Google's free tier allows on the order of fifteen requests a minute, and a
     page of figures read back to back goes straight through that. A 429 is not
     a failure, it is "wait" — so wait, honouring Retry-After when the server
     sends one, and try again. Only when it keeps saying no is it worth
     bothering the user. */
  async function requestWithRetry(url, init, o) {
    const max = o.retries === undefined ? 4 : o.retries;
    let wait = o.retryBaseMs || 2000;
    for (let attempt = 0; ; attempt++) {
      const guard = withTimeout(o);
      let res;
      try {
        res = await fetch(url, Object.assign({}, init, { signal: guard.signal }));
      } catch (e) {
        throw timeoutError(e, o.timeoutMs);
      } finally {
        guard.done();
      }
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt >= max) return res;

      /* Google states the wait twice and neither is a guess: Retry-After when
         it sends one, and "Please retry in 49.1s" inside the error body. Doing
         our own exponential guessing while ignoring both means giving up after
         30 seconds on a limit that clears in 50. */
      let delay = wait;
      try {
        const ra = res.headers && res.headers.get && parseFloat(res.headers.get('retry-after'));
        if (isFinite(ra) && ra > 0) delay = ra * 1000;
      } catch (e) { /* no headers on this response */ }
      try {
        if (res.clone) {
          const text = await res.clone().text();
          const m = text.match(/retry in ([\d.]+)\s*s/i);
          if (m) delay = Math.max(delay, parseFloat(m[1]) * 1000);
        }
      } catch (e) { /* body not readable twice; the header or the guess stands */ }
      const floor = o.minWaitMs === undefined ? 500 : o.minWaitMs;
      delay = Math.min(Math.max(delay, floor) + (o.retryPadMs === undefined ? 800 : o.retryPadMs),
                       o.maxWaitMs || 75000);

      if (o.onRetry) o.onRetry({ attempt: attempt + 1, max, delayMs: delay, status: res.status });
      const until = Date.now() + delay;
      while (Date.now() < until) {
        await sleep(Math.min(500, until - Date.now()));
        if (o.onCountdown) o.onCountdown({ attempt: attempt + 1, max, remainingMs: until - Date.now() });
      }
      wait = Math.min(wait * 2, 32000);
    }
  }

  function timeoutError(e, ms) {
    if (e && (e.name === 'AbortError' || /abort/i.test(e.message || ''))) {
      return new Error('Gemini ไม่ตอบกลับภายใน ' + Math.round(ms / 1000) + ' วินาที ลองใหม่อีกครั้ง');
    }
    if (e instanceof TypeError) {
      return new Error('ต่ออินเทอร์เน็ตไปยัง Gemini ไม่ได้ ตรวจสอบการเชื่อมต่อแล้วลองใหม่');
    }
    return e;
  }

  async function findFigures(base64, apiKey, options) {
    if (!apiKey) throw new Error('ยังไม่ได้ใส่ Gemini API key');
    const o = options || {};
    const res = await requestWithRetry(o.endpoint || ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(buildFindRequest(base64, o))
    }, o);
    let body = null;
    try { body = await res.json(); } catch (e) { body = null; }
    if (!res.ok) {
      const err = new Error(describeError(res.status, body));
      err.status = res.status;
      err.raw = body ? JSON.stringify(body).slice(0, 1200) : '';
      throw err;
    }
    return toBoxes(parseFindResponse(body), o.width || 1000, o.height || 1000, o);
  }

  function buildRequest(base64, options) {
    const o = options || {};
    return {
      model: o.model || MODEL,
      input: [
        { type: 'text', text: o.prompt || PROMPT },
        { type: 'image', data: base64, mime_type: o.mimeType || 'image/png' }
      ],
      response_format: { type: 'text', mime_type: 'application/json', schema: SCHEMA }
    };
  }

  /* The response envelope is not something to be precious about: find the first
     string in it that parses as the JSON we asked for. If the shape changes,
     this keeps working; if it cannot, the raw body goes into the error so the
     problem is visible rather than mysterious. */
  function parseResponse(body) {
    const seen = [];
    const walk = node => {
      if (typeof node === 'string') { seen.push(node); return; }
      if (Array.isArray(node)) { node.forEach(walk); return; }
      if (node && typeof node === 'object') { for (const k in node) walk(node[k]); }
    };
    walk(body);
    for (const s of seen) {
      const t = s.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
      if (t[0] !== '{') continue;
      try {
        const parsed = JSON.parse(t);
        if (parsed && parsed.points && parsed.lines) return parsed;
      } catch (e) { /* not this one */ }
    }
    if (body && body.points && body.lines) return body;
    const err = new Error('ไม่พบข้อมูลรูปในคำตอบของ Gemini');
    err.raw = JSON.stringify(body).slice(0, 1200);
    throw err;
  }

  /* A label that is a plain number of degrees, as opposed to "x" or "x + 50°". */
  function numericLabel(label) {
    if (!label) return null;
    const m = String(label).trim().match(/^(\d{1,3}(?:\.\d+)?)\s*°?$/);
    if (!m) return null;
    const v = parseFloat(m[1]);
    return v > 0 && v < 360 ? v : null;
  }

  /* Turn the reported reading into a figure, and check the reading against
     itself: the coordinates say what the angle measures, the label says what it
     is supposed to be, and the two should agree. Where they do not, the number
     was probably misread — 82 as 32 is the classic — so the constraint is left
     switched off and the disagreement is reported rather than drawn over. */
  function toFigure(reading, options) {
    const o = Object.assign({ scale: 10, tolerance: 6 }, options || {});
    const G = AM.geometry;
    const fig = G.create();
    const k = o.scale / 1000;

    for (const p of reading.points || []) {
      if (!p || !p.id) continue;
      fig.points[p.id] = { x: (+p.x || 0) * k, y: (+p.y || 0) * k,
                           label: p.label === undefined ? p.id : p.label };
    }
    const known = id => Object.prototype.hasOwnProperty.call(fig.points, id);

    for (const l of reading.lines || []) {
      if (!l || !known(l.from) || !known(l.to) || l.from === l.to) continue;
      fig.lines.push({ id: l.id || ('l' + fig.lines.length), a: l.from, b: l.to,
                       kind: l.kind || 'segment', ticks: Math.max(0, l.marks | 0) });
    }
    const hasLine = id => fig.lines.some(l => l.id === id);

    for (const group of reading.parallelGroups || []) {
      const ids = (group || []).filter(hasLine);
      for (let i = 1; i < ids.length; i++) {
        fig.constraints.push({ type: 'parallel', lines: [ids[0], ids[i]] });
      }
    }

    const conflicts = [];
    for (const a of reading.angles || []) {
      if (!a || !known(a.vertex) || !known(a.from) || !known(a.to)) continue;
      const label = a.label || '';
      const angle = { vertex: a.vertex, from: a.from, to: a.to, label: label };
      fig.angles.push(angle);
      const claimed = a.rightAngle ? 90 : numericLabel(label);
      if (claimed === null) continue;
      const drawn = G.measure(fig, angle);
      const off = drawn === null ? null : Math.abs(drawn - claimed);
      const suspect = off === null || off > o.tolerance;
      if (suspect) {
        conflicts.push({ vertex: a.vertex, label: label, claimed: claimed,
                         drawn: drawn === null ? null : Math.round(drawn * 10) / 10,
                         off: off === null ? null : Math.round(off * 10) / 10 });
      }
      fig.constraints.push({ type: 'angle', vertex: a.vertex, from: a.from, to: a.to,
                             value: claimed, enabled: !suspect, suspect: suspect });
    }

    G.captureSigns(fig);
    fig.notes = reading.notes || '';
    fig.conflicts = conflicts;
    return fig;
  }

  function describeError(status, body) {
    const detail = (body && body.error && body.error.message) || '';
    if (status === 400 && /API key/i.test(detail)) return 'คีย์ไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง';
    if (status === 401 || status === 403) return 'คีย์ใช้ไม่ได้หรือยังไม่ได้เปิดใช้งาน Gemini API';
    if (status === 429) {
      return 'เกินโควตาของ Gemini (429) — บัญชีฟรีจำกัดราว 15 ครั้งต่อนาที ' +
             'ลองใหม่อีกครั้งในหนึ่งนาที อ่านทีละไม่กี่รูป ' +
             'หรือเปิดการเรียกเก็บเงินในโปรเจกต์ Google Cloud เพื่อเพิ่มโควตา';
    }
    if (status >= 500) return 'เซิร์ฟเวอร์ของ Gemini ขัดข้อง ลองใหม่อีกครั้ง';
    return 'เรียก Gemini ไม่สำเร็จ (' + status + ')' + (detail ? ': ' + detail : '');
  }

  async function readFigure(base64, apiKey, options) {
    if (!apiKey) throw new Error('ยังไม่ได้ใส่ Gemini API key');
    const o = options || {};
    const res = await requestWithRetry(o.endpoint || ENDPOINT, {
      method: 'POST',
      /* The key rides in a header, never in the URL, where it would end up in
         logs and history. */
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(buildRequest(base64, o))
    }, o);
    let body = null;
    try { body = await res.json(); } catch (e) { body = null; }
    if (!res.ok) {
      const err = new Error(describeError(res.status, body));
      err.status = res.status;
      err.raw = body ? JSON.stringify(body).slice(0, 1200) : '';
      throw err;
    }
    return toFigure(parseResponse(body), o);
  }

  AM.extract = { readFigure, buildRequest, parseResponse, toFigure, numericLabel,
                 findFigures, buildFindRequest, parseFindResponse, toBoxes, timeoutError,
                 requestWithRetry,
                 describeError, PROMPT, SCHEMA, FIND_PROMPT, FIND_SCHEMA, MODEL, ENDPOINT };
})(typeof globalThis !== 'undefined' ? globalThis : this);
