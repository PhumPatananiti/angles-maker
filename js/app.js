/* Angles Maker — UI. Everything happens locally: no network, no upload. */
(function () {
  'use strict';
  const AM = globalThis.AM;
  const $ = s => document.querySelector(s);
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  const ANALYSIS_W = 1600;
  /* iOS Safari refuses to allocate very large canvases and hands back a blank
     one rather than an error. A 12 MP phone photo is already ~15 MP once
     rotated upright, and a 48 MP one is far past any limit. Cap the export
     canvas: figures are written at most 2000px wide, so cropping from a page
     of this size loses nothing visible. */
  const MAX_EXPORT_PIXELS = 12e6;
  let nextId = 1;

  const state = {
    pages: [],
    activeId: null,
    selected: null,
    undo: [],
    manual: false,
    settings: { mode: 'gray', width: 900, bolder: false, prefix: 'q', dpi: 300 }
  };
  /* Only ever one full-resolution deskewed page in memory: a 12 MP photo is
     48 MB as pixels and caching a handful of them ends the session. */
  let fullRes = null;

  const active = () => state.pages.find(p => p.id === state.activeId) || null;

  function toast(html, ms) {
    const t = $('#toast');
    t.innerHTML = html;
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { t.hidden = true; }, ms || 5000);
  }
  function status(msg) {
    const s = $('#status');
    if (!msg) { s.hidden = true; return; }
    s.textContent = msg;
    s.hidden = false;
  }

  /* ---------- loading ---------- */

  function addFiles(files) {
    /* Only PDFs are refused up front. A HEIC is offered to the decoder — Safari
       reads them — and the decode failure path explains the fix if it cannot. */
    const list = Array.from(files).filter(f => !/\.pdf$/i.test(f.name) || warn(f));
    for (const file of list) {
      state.pages.push({
        id: nextId++, name: file.name.replace(/\.[^.]+$/, ''), file,
        boxes: [], angle: 0, ready: false
      });
    }
    if (!state.activeId && state.pages.length) state.activeId = state.pages[0].id;
    renderPages();
    processActive();
  }
  function warn(f) {
    toast('<b>' + f.name + '</b> เป็นไฟล์ PDF ไม่ใช่ไฟล์รูป กรุณาบันทึกหน้านั้นเป็นไฟล์รูปก่อน', 9000);
    return false;
  }

  function addDemo() {
    /* Bigger than the analysis width on purpose, so the demo exercises the same
       downscale-then-crop-at-full-resolution path a real photo takes. */
    const page = AM.synth.makePage({ seed: 7, width: 2000, height: 2600, textHeight: 38 });
    state.pages.push({
      id: nextId++, name: 'demo-page', demo: page, boxes: [], angle: 0, ready: false
    });
    state.activeId = state.pages[state.pages.length - 1].id;
    renderPages();
    processActive();
  }

  async function sourceBitmap(page) {
    if (page.demo) {
      const c = el('canvas');
      c.width = page.demo.width; c.height = page.demo.height;
      c.getContext('2d').putImageData(
        new ImageData(page.demo.rgba, page.demo.width, page.demo.height), 0, 0);
      return c;
    }
    try {
      return await createImageBitmap(page.file);
    } catch (e) {
      throw new Error('decode');
    }
  }

  async function analyse(page, opts) {
    const src = await sourceBitmap(page);
    const sw = src.width, sh = src.height;
    const scale = Math.min(1, ANALYSIS_W / Math.max(sw, sh));
    const w = Math.max(1, Math.round(sw * scale)), h = Math.max(1, Math.round(sh * scale));
    const c = el('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, w, h);
    if (src.close) src.close();

    const rgba = ctx.getImageData(0, 0, w, h).data;
    const res = AM.pipeline.analyzePage(rgba, w, h, Object.assign({
      analysisWidth: 0,
      forcedAngle: page.angleForced ? page.angle : null,
      detect: page.textHeightOverride ? { textHeight: page.textHeightOverride } : null
    }, opts || {}));

    page.scale = w / sw;              // analysis px per original px
    page.naturalWidth = sw;
    page.angle = res.skew.radians;
    page.autoTextHeight = res.textHeight;
    page.deskewed = { gray: res.deskewed.flat, w: res.deskewed.width, h: res.deskewed.height };
    page.textRects = res.textRects || [];
    page.ready = true;
    return res;
  }

  async function processActive(keepManual) {
    const page = active();
    if (!page) return;
    status('กำลังอ่านหน้ากระดาษ…');
    try {
      const manual = keepManual ? page.boxes.filter(b => b.manual) : [];
      const prev = page.deskewed;
      const res = await analyse(page);
      /* Manual boxes were drawn in the old deskewed frame; if the angle moved,
         move them with it rather than leaving them behind. */
      const moved = prev ? rotateBoxes(manual, page.angle - (page.lastAngle || 0),
                                       prev.w, prev.h, page.deskewed.w, page.deskewed.h) : manual;
      page.lastAngle = page.angle;
      page.boxes = res.boxes.map(b => makeBox(b, false)).concat(moved);
      sortBoxes(page);
      page.thumb = makeThumb(page);
    } catch (e) {
      status(null);
      if (e && e.message === 'decode') {
        toast('เปิดไฟล์ <b>' + (page.file ? page.file.name : 'รูปนี้') +
              '</b> ไม่ได้ ถ้าเป็นรูปจาก iPhone มักเป็นไฟล์ HEIC ให้แปลงเป็น JPG ก่อน ' +
              'โดยเปิด Terminal แล้วพิมพ์<br>' +
              '<code>sips -s format jpeg in.HEIC --out out.jpg</code>', 14000);
      } else {
        toast('อ่านหน้ากระดาษนี้ไม่สำเร็จ: ' + (e && e.message), 8000);
      }
      state.pages = state.pages.filter(p => p.id !== page.id);
      state.activeId = state.pages.length ? state.pages[0].id : null;
      renderPages(); renderAll();
      return;
    }
    status(null);
    syncControls();
    renderPages();
    renderAll();
    schedulePrepare(0);
    if (getKey() && !page.searched) findWithAI(page);
  }

  const makeBox = (b, manual) => ({
    id: nextId++, x: b.x, y: b.y, w: b.w, h: b.h, label: b.label || '',
    manual: !!manual, selected: true
  });

  function rotateBoxes(boxes, delta, ow, oh, nw, nh) {
    if (!boxes.length) return boxes;
    const cos = Math.cos(delta), sin = Math.sin(delta);
    return boxes.map(b => {
      const cx = b.x + b.w / 2 - ow / 2, cy = b.y + b.h / 2 - oh / 2;
      const nx = cos * cx - sin * cy + nw / 2, ny = sin * cx + cos * cy + nh / 2;
      return Object.assign({}, b, { x: nx - b.w / 2, y: ny - b.h / 2 });
    });
  }

  function sortBoxes(page) {
    page.boxes = AM.detect.readingOrder(page.boxes);
  }

  /* ---------- rendering ---------- */

  function grayToCanvas(gray, w, h) {
    const c = el('canvas'); c.width = w; c.height = h;
    c.getContext('2d').putImageData(new ImageData(AM.image.grayToRGBA(gray, w, h), w, h), 0, 0);
    return c;
  }

  function makeThumb(page) {
    const d = page.deskewed;
    const c = el('canvas');
    const s = 64 / d.h;
    c.width = Math.max(1, Math.round(d.w * s)); c.height = 64;
    c.getContext('2d').drawImage(grayToCanvas(d.gray, d.w, d.h), 0, 0, c.width, c.height);
    return c.toDataURL('image/png');
  }

  function renderPages() {
    const wrap = $('#pages');
    wrap.innerHTML = '';
    wrap.hidden = state.pages.length < 1;
    state.pages.forEach((p, i) => {
      const b = el('button', 'thumb' + (p.id === state.activeId ? ' active' : ''));
      const img = el('img');
      img.src = p.thumb || '';
      img.alt = 'หน้า ' + (i + 1);
      b.appendChild(img);
      b.appendChild(el('span', 'badge', String(p.boxes.length)));
      const x = el('span', 'x', '×');
      x.title = 'เอาหน้านี้ออก';
      x.onclick = ev => { ev.stopPropagation(); removePage(p.id); };
      b.appendChild(x);
      b.onclick = () => selectPage(p.id);
      wrap.appendChild(b);
    });
  }

  function removePage(id) {
    const gone = state.pages.find(p => p.id === id);
    if (gone) for (const b of gone.boxes) invalidateBox(b);
    state.pages = state.pages.filter(p => p.id !== id);
    updateZipButton();
    if (fullRes && fullRes.pageId === id) fullRes = null;
    if (state.activeId === id) state.activeId = state.pages.length ? state.pages[0].id : null;
    renderPages();
    if (state.activeId && !active().ready) processActive(); else renderAll();
  }

  function selectPage(id) {
    if (state.activeId === id) return;
    state.activeId = id;
    state.selected = null;
    state.undo = [];
    if (fullRes && fullRes.pageId !== id) fullRes = null;   // release 48 MB
    renderPages();
    if (!active().ready) processActive(); else { syncControls(); renderAll(); }
  }

  function renderAll() {
    const page = active();
    const has = !!(page && page.ready);
    $('#drop').hidden = has;
    $('#workspace').hidden = !has;
    $('#side').hidden = !has;
    if (!has) return;

    const d = page.deskewed;
    const canvas = $('#page-canvas');
    canvas.width = d.w; canvas.height = d.h;
    canvas.getContext('2d').putImageData(
      new ImageData(AM.image.grayToRGBA(d.gray, d.w, d.h), d.w, d.h), 0, 0);

    const view = $('#page-view');
    const availW = view.clientWidth - 28, availH = view.clientHeight - 28;
    const width = Math.min(availW, availH * (d.w / d.h));
    $('#canvas-wrap').style.width = Math.max(100, width) + 'px';
    renderBoxes();
    renderGallery();
  }

  function renderBoxes() {
    const page = active();
    if (!page) return;
    const ov = $('#overlay');
    ov.innerHTML = '';
    ov.style.pointerEvents = state.manual ? 'auto' : 'none';
    const d = page.deskewed;
    page.boxes.forEach(b => {
      const n = el('div', 'box' + (state.selected === b.id ? ' sel' : '') +
                             (b.selected === false ? ' off' : ''));
      n.style.left = (100 * b.x / d.w) + '%';
      n.style.top = (100 * b.y / d.h) + '%';
      n.style.width = (100 * b.w / d.w) + '%';
      n.style.height = (100 * b.h / d.h) + '%';
      n.dataset.id = b.id;
      n.appendChild(el('span', 'tag', nameFor(page, b)));
      if (state.manual) {
        ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].forEach(k => {
          const h = el('div', 'h ' + k);
          h.dataset.handle = k;
          n.appendChild(h);
        });
      }
      ov.appendChild(n);
    });
  }

  /* Numbering runs across every loaded page, so three photos of one exercise
     give a single q01..q20 sequence. A question number read off the page wins,
     since that is what the teacher will be typing next to it. */
  function figureIndex(page, box) {
    let n = 0;
    for (const p of state.pages) {
      for (const b of p.boxes) {
        n++;
        if (b === box) return n;
      }
    }
    return n;
  }
  function nameFor(page, box) {
    if (box.label) return box.label;
    if (box.question) return state.settings.prefix + box.question.padStart(2, '0');
    return state.settings.prefix + String(figureIndex(page, box)).padStart(2, '0');
  }

  /* ---------- the gallery: pick figures, then shape them ---------- */

  function renderGallery() {
    const page = active();
    const wrap = $('#gallery');
    wrap.innerHTML = '';
    const total = state.pages.reduce((n, p) => n + p.boxes.length, 0);
    $('#fig-count').textContent = total;
    if (!page) return;

    if (!page.boxes.length) {
      const empty = el('div', 'gallery-empty');
      empty.textContent = page.searched
        ? 'ไม่พบรูปมุมในหน้านี้ — เปิด “เพิ่มกรอบเองได้” แล้วลากกรอบคลุมรูปที่ต้องการ'
        : 'ใส่ Gemini API key แล้วกด “ค้นหารูปใหม่” เพื่อให้ AI หารูปมุมในหน้านี้';
      wrap.appendChild(empty);
      return;
    }

    page.boxes.forEach(box => {
      const card = el('div', 'card' + (box.selected === false ? ' off' : ''));

      const head = el('label', 'card-head');
      const tick = el('input');
      tick.type = 'checkbox';
      tick.checked = box.selected !== false;
      tick.onchange = () => { box.selected = tick.checked; renderGallery(); renderBoxes(); };
      head.appendChild(tick);
      head.appendChild(el('span', 'card-name', nameFor(page, box)));
      const st = el('span', 'card-state ' + (box.figure ? 'done' : box.reading ? 'busy' : ''));
      st.textContent = box.figure ? 'แก้ค่าได้' : box.reading ? 'กำลังอ่าน…' : 'ยังไม่ได้อ่าน';
      head.appendChild(st);
      card.appendChild(head);

      const body = el('div', 'card-body');
      const crop = el('figure', 'card-crop');
      crop.appendChild(el('figcaption', null, 'ต้นฉบับ'));
      if (box.url) {
        const img = el('img');
        img.src = box.url;
        img.alt = '';
        crop.appendChild(img);
      } else {
        crop.appendChild(previewCanvas(page, box));
      }
      body.appendChild(crop);

      if (box.figure) {
        const built = el('figure', 'card-built');
        built.appendChild(el('figcaption', null, 'สร้างใหม่ — ลากจุดเพื่อขยับเส้น'));
        const holder = el('div', 'svg-holder');
        holder.innerHTML = AM.svg.render(box.figure, { width: 300, interactive: true });
        attachPointDrag(holder, page, box);
        built.appendChild(holder);
        body.appendChild(built);
      }
      card.appendChild(body);

      if (box.figure) {
        card.appendChild(angleEditor(page, box));
        for (const c of box.figure.conflicts || []) {
          const d = el('div', 'conflict');
          d.textContent = 'มุมที่จุด ' + c.vertex + ': ป้ายอ่านได้ ' + c.claimed +
            '° แต่รูปวัดได้ ' + (c.drawn === null ? 'ไม่ทราบ' : c.drawn + '°') +
            ' — เทียบกับต้นฉบับก่อนใช้';
          card.appendChild(d);
        }
        if (box.figure.notes) {
          card.appendChild(el('div', 'ok-note', 'หมายเหตุจาก AI: ' + box.figure.notes));
        }
        const actions = el('div', 'row');
        const dl = el('button', 'primary', 'ดาวน์โหลด SVG');
        dl.onclick = () => downloadSvg(page, box);
        actions.appendChild(dl);
        const again = el('button', 'ghost', 'อ่านใหม่');
        again.onclick = () => readWithAI(page, box);
        actions.appendChild(again);
        card.appendChild(actions);
      }
      wrap.appendChild(card);
    });
  }

  /* Every angle the figure knows about, as an editable value. Typing a number
     re-solves the whole figure, so the drawing and the label cannot disagree. */
  function angleEditor(page, box) {
    const fig = box.figure;
    const wrap = el('div', 'angles');
    fig.angles.forEach((a, i) => {
      const row = el('label', 'angle-row');
      row.appendChild(el('span', 'angle-at', 'มุมที่ ' + a.vertex));
      const input = el('input');
      input.type = 'text';
      input.value = a.label || '';
      input.placeholder = 'เช่น 82° หรือ x';
      input.onchange = () => setAngleLabel(page, box, i, input.value);
      row.appendChild(input);
      const measured = AM.geometry.measure(fig, a);
      row.appendChild(el('span', 'angle-measured',
                         measured === null ? '' : Math.round(measured * 10) / 10 + '°'));
      wrap.appendChild(row);
    });
    return wrap;
  }

  function constraintFor(fig, angle) {
    return fig.constraints.find(c => c.type === 'angle' && c.vertex === angle.vertex &&
                                     c.from === angle.from && c.to === angle.to);
  }

  function setAngleLabel(page, box, index, text) {
    const fig = box.figure;
    const angle = fig.angles[index];
    angle.label = text;
    const value = AM.extract.numericLabel(text);
    let c = constraintFor(fig, angle);
    if (value === null) {
      /* "x" or "x + 50°" is a caption, not a measurement — stop driving the
         geometry from it and leave the drawing where it is. */
      if (c) c.enabled = false;
    } else {
      if (!c) {
        c = { type: 'angle', vertex: angle.vertex, from: angle.from, to: angle.to, value: value };
        fig.constraints.push(c);
        AM.geometry.captureSigns(fig);
      }
      c.value = value;
      c.enabled = true;
      c.suspect = false;
      const r = AM.geometry.solve(fig);
      if (!r.ok) {
        toast('ค่ามุมชุดนี้ขัดกันเอง รูปจึงยังไม่ตรงทุกมุม', 6000);
      }
      fig.conflicts = (fig.conflicts || []).filter(x => x.vertex !== angle.vertex);
    }
    invalidateBox(box);
    schedulePrepare();
    renderGallery();
  }

  /* Dragging a point is the other half of customising: it changes the lines
     themselves. The dragged point is pinned while the solver settles the rest,
     so the constraints still hold when the finger lifts. */
  function attachPointDrag(holder, page, box) {
    const svg = holder.querySelector('svg');
    if (!svg) return;
    svg.addEventListener('pointerdown', ev => {
      const target = ev.target;
      const id = target && target.dataset ? target.dataset.point : null;
      if (!id) return;
      ev.preventDefault();
      svg.setPointerCapture(ev.pointerId);
      const fig = box.figure;
      const b = AM.geometry.bounds(fig);
      const rect = svg.getBoundingClientRect();
      const vb = svg.viewBox.baseVal;
      const pad = 46;
      const scale = (vb.width - pad * 2) / b.w;
      const toFigure = e => ({
        x: b.x + ((e.clientX - rect.left) / rect.width * vb.width - pad) / scale,
        y: b.y + ((e.clientY - rect.top) / rect.height * vb.height - pad) / scale
      });
      const point = fig.points[id];
      const wasFixed = point.fixed;
      const move = e => {
        const p = toFigure(e);
        point.x = p.x; point.y = p.y;
        point.fixed = true;
        AM.geometry.solve(fig);
        point.fixed = wasFixed;
        holder.innerHTML = AM.svg.render(fig, { width: 300, interactive: true });
        attachPointDrag(holder, page, box);
      };
      const up = () => {
        svg.removeEventListener('pointermove', move);
        svg.removeEventListener('pointerup', up);
        invalidateBox(box);
        schedulePrepare();
        renderGallery();
      };
      svg.addEventListener('pointermove', move);
      svg.addEventListener('pointerup', up);
    });
  }

  function downloadSvg(page, box) {
    const svg = AM.svg.render(box.figure, { width: 640 });
    saveBytes(new TextEncoder().encode(svg),
              AM.util.sanitizeName(nameFor(page, box), 'figure') + '.svg', 'image/svg+xml');
  }

  function downloadAllSvg() {
    const entries = [];
    const taken = new Set();
    for (const p of state.pages) {
      for (const b of p.boxes) {
        if (!b.figure || b.selected === false) continue;
        const name = AM.util.uniqueName(
          AM.util.sanitizeName(nameFor(p, b), 'figure') + '.svg', taken);
        entries.push({ name, data: new TextEncoder().encode(AM.svg.render(b.figure, { width: 640 })) });
      }
    }
    if (!entries.length) { toast('ยังไม่มีรูปที่อ่านแล้ว กด “อ่านมุมที่เลือก” ก่อน', 5000); return; }
    const stem = AM.util.sanitizeName(state.settings.prefix || 'figures', 'figures')
      .replace(/[^\x20-\x7E]/g, '') || 'figures';
    saveBytes(AM.zip.makeZip(entries), stem + '-svg.zip', 'application/zip');
  }

  const renderList = renderGallery;

  /* Previews come from the analysis-scale page, so nothing at full resolution
     has to be decoded just to draw a thumbnail. */
  function previewCanvas(page, box) {
    const d = page.deskewed;
    const c = el('canvas');
    c.width = 240; c.height = 170;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    const src = grayToCanvas(d.gray, d.w, d.h);
    const s = Math.min(c.width / box.w, c.height / box.h);
    const dw = box.w * s, dh = box.h * s;
    ctx.drawImage(src, box.x, box.y, box.w, box.h,
                  (c.width - dw) / 2, (c.height - dh) / 2, dw, dh);
    return c;
  }

  /* ---------- editing ---------- */

  function pushUndo() {
    const page = active();
    if (!page) return;
    state.undo.push(JSON.stringify(page.boxes));
    if (state.undo.length > 60) state.undo.shift();
  }
  function undo() {
    const page = active();
    if (!page || !state.undo.length) return;
    page.boxes = JSON.parse(state.undo.pop());
    for (const b of page.boxes) { b.png = null; b.url = null; }
    schedulePrepare();
    renderBoxes(); renderList(); renderPages();
  }

  function overlayPoint(ev) {
    const page = active(), d = page.deskewed;
    const r = $('#overlay').getBoundingClientRect();
    return {
      x: (ev.clientX - r.left) / r.width * d.w,
      y: (ev.clientY - r.top) / r.height * d.h,
      scale: d.w / r.width
    };
  }

  function initEditing() {
    const ov = $('#overlay');
    ov.addEventListener('pointerdown', ev => {
      const page = active();
      if (!page) return;
      const d = page.deskewed;
      const start = overlayPoint(ev);
      const boxNode = ev.target.closest('.box');
      const handle = ev.target.dataset ? ev.target.dataset.handle : null;
      ov.setPointerCapture(ev.pointerId);
      ev.preventDefault();
      pushUndo();

      let box, mode;
      if (boxNode) {
        box = page.boxes.find(b => b.id === +boxNode.dataset.id);
        mode = handle || 'move';
        state.selected = box.id;
      } else {
        box = makeBox({ x: start.x, y: start.y, w: 1, h: 1 }, true);
        page.boxes.push(box);
        mode = 'se';
        state.selected = box.id;
      }
      const o = { x: box.x, y: box.y, w: box.w, h: box.h };
      renderBoxes(); renderList();

      const move = e2 => {
        const p = overlayPoint(e2);
        const dx = p.x - start.x, dy = p.y - start.y;
        if (mode === 'move') {
          box.x = o.x + dx; box.y = o.y + dy;
        } else {
          let x0 = o.x, y0 = o.y, x1 = o.x + o.w, y1 = o.y + o.h;
          if (mode.includes('w')) x0 = o.x + dx;
          if (mode.includes('e')) x1 = o.x + o.w + dx;
          if (mode.includes('n')) y0 = o.y + dy;
          if (mode.includes('s')) y1 = o.y + o.h + dy;
          box.x = Math.min(x0, x1); box.y = Math.min(y0, y1);
          box.w = Math.abs(x1 - x0); box.h = Math.abs(y1 - y0);
        }
        box.x = AM.util.clamp(box.x, 0, d.w - 4);
        box.y = AM.util.clamp(box.y, 0, d.h - 4);
        box.w = AM.util.clamp(box.w, 4, d.w - box.x);
        box.h = AM.util.clamp(box.h, 4, d.h - box.y);
        box.manual = true;
        renderBoxes();
      };
      const up = () => {
        ov.removeEventListener('pointermove', move);
        ov.removeEventListener('pointerup', up);
        if (box.w < 8 || box.h < 8) {
          page.boxes = page.boxes.filter(b => b !== box);
          state.undo.pop();
        } else {
          touchBox(box);
        }
        sortBoxes(page);
        renderBoxes(); renderList(); renderPages();
      };
      ov.addEventListener('pointermove', move);
      ov.addEventListener('pointerup', up);
    });

    document.addEventListener('keydown', ev => {
      const page = active();
      if (!page) return;
      if (ev.target.tagName === 'INPUT' || ev.target.tagName === 'SELECT') return;
      const box = page.boxes.find(b => b.id === state.selected);
      if ((ev.key === 'Backspace' || ev.key === 'Delete') && box) {
        ev.preventDefault(); pushUndo();
        page.boxes = page.boxes.filter(b => b !== box);
        invalidateBox(box);
        state.selected = null;
        renderBoxes(); renderList(); renderPages(); updateZipButton();
      } else if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'z') {
        ev.preventDefault(); undo();
      } else if (box && ev.key.startsWith('Arrow')) {
        ev.preventDefault(); pushUndo();
        const step = ev.shiftKey ? 10 : 2;
        if (ev.key === 'ArrowLeft') box.x -= step;
        if (ev.key === 'ArrowRight') box.x += step;
        if (ev.key === 'ArrowUp') box.y -= step;
        if (ev.key === 'ArrowDown') box.y += step;
        box.manual = true;
        touchBox(box);
        renderBoxes();
      } else if (ev.key === 'Escape') {
        state.selected = null; renderBoxes(); renderList();
      }
    });
  }

  /* ---------- preparing downloads ---------- */

  /* Safari on iOS refuses to start a download from a handler that has already
     awaited something: by the time the anchor is clicked the user gesture is
     gone, and nothing happens — silently. So every figure is rendered to PNG
     bytes in the background, and a control only becomes a real link once its
     bytes exist. The tap itself then does no async work at all. */
  let preparing = false, prepareTimer = 0;

  function invalidateBox(box) {
    if (box.url) URL.revokeObjectURL(box.url);
    box.url = null;
    box.png = null;
  }
  function invalidateAll() {
    for (const p of state.pages) for (const b of p.boxes) invalidateBox(b);
  }
  function touchBox(box) {
    invalidateBox(box);
    schedulePrepare();
  }

  function countPending() {
    let n = 0;
    for (const p of state.pages) for (const b of p.boxes) if (!b.png) n++;
    return n;
  }

  function updateZipButton() {
    const total = state.pages.reduce((n, p) => n + p.boxes.length, 0);
    const pending = countPending();
    const btn = $('#btn-zip');
    if (!btn) return;
    btn.disabled = !total || pending > 0;
    btn.textContent = !total ? 'ยังไม่มีรูปให้บันทึก'
      : pending ? 'กำลังเตรียมไฟล์ ' + (total - pending) + '/' + total + '…'
      : 'ดาวน์โหลดทั้งหมด (.zip)';
  }

  function schedulePrepare(delay) {
    clearTimeout(prepareTimer);
    updateZipButton();
    prepareTimer = setTimeout(prepareDownloads, delay === undefined ? 400 : delay);
  }

  async function prepareDownloads() {
    if (preparing) return;
    preparing = true;
    try {
      for (const page of state.pages) {
        if (!page.ready) continue;
        const need = page.boxes.filter(b => !b.png);
        if (!need.length) continue;
        for (const box of need) {
          if (!page.boxes.includes(box)) continue;      // deleted while we worked
          try {
            box.png = await renderFigure(page, box);
            box.url = URL.createObjectURL(new Blob([box.png], { type: 'image/png' }));
          } catch (e) {
            box.png = null;
          }
          updateZipButton();
          if (page.id === state.activeId) renderList();
          await new Promise(r => setTimeout(r, 0));     // let the page stay responsive
        }
        if (fullRes && fullRes.pageId === page.id && page.id !== state.activeId) fullRes = null;
      }
    } finally {
      preparing = false;
      updateZipButton();
      if (countPending()) schedulePrepare(600);
    }
  }

  /* ---------- export ---------- */

  async function ensureFullRes(page) {
    if (fullRes && fullRes.pageId === page.id && fullRes.angle === page.angle) return fullRes;
    fullRes = null;
    const src = await sourceBitmap(page);
    const area = src.width * src.height;
    const shrink = area > MAX_EXPORT_PIXELS ? Math.sqrt(MAX_EXPORT_PIXELS / area) : 1;
    const dw = Math.round(src.width * shrink), dh = Math.round(src.height * shrink);
    const size = AM.util.rotatedSize(dw, dh, page.angle);
    const c = el('canvas');
    c.width = size.w; c.height = size.h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, size.w, size.h);
    ctx.imageSmoothingQuality = 'high';
    /* Same centre-to-centre convention as image.rotateGray, which is what makes
       box / boxScale a valid crop rectangle here. */
    ctx.translate(size.w / 2, size.h / 2);
    ctx.rotate(page.angle);
    ctx.drawImage(src, -dw / 2, -dh / 2, dw, dh);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (src.close) src.close();
    if (!c.width || !ctx.getImageData(0, 0, 1, 1)) throw new Error('canvas');
    fullRes = { pageId: page.id, angle: page.angle, canvas: c, ctx,
                w: size.w, h: size.h, boxScale: page.scale / shrink };
    return fullRes;
  }

  async function renderFigure(page, box) {
    const fr = await ensureFullRes(page);
    const b = AM.pipeline.boxToFullRes(box, fr.boxScale);
    const x = AM.util.clamp(b.x, 0, fr.w - 2), y = AM.util.clamp(b.y, 0, fr.h - 2);
    const w = Math.max(2, Math.min(b.w, fr.w - x)), h = Math.max(2, Math.min(b.h, fr.h - y));
    const img = fr.ctx.getImageData(x, y, w, h);
    const s = state.settings;
    const cleaned = AM.clean.cleanCrop(img.data, w, h, { mode: s.mode, bolder: s.bolder });

    const src = el('canvas');
    src.width = cleaned.width; src.height = cleaned.height;
    src.getContext('2d').putImageData(
      new ImageData(cleaned.data, cleaned.width, cleaned.height), 0, 0);

    let outW = cleaned.width, outH = cleaned.height;
    if (s.width) {
      outW = s.width;
      outH = Math.max(1, Math.round(cleaned.height * (s.width / cleaned.width)));
    }
    const out = el('canvas');
    out.width = outW; out.height = outH;
    const octx = out.getContext('2d');
    octx.imageSmoothingQuality = 'high';
    if (s.mode !== 'transparent') { octx.fillStyle = '#fff'; octx.fillRect(0, 0, outW, outH); }
    octx.drawImage(src, 0, 0, outW, outH);

    const blob = await new Promise(res => out.toBlob(res, 'image/png'));
    const bytes = AM.pngmeta.setPngDpi(new Uint8Array(await blob.arrayBuffer()), s.dpi);
    return bytes;
  }

  function saveBytes(bytes, filename, mime) {
    const url = URL.createObjectURL(new Blob([bytes], { type: mime || 'application/octet-stream' }));
    const a = el('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  async function exportOne(page, box) {
    status('กำลังบันทึก…');
    try {
      const bytes = await renderFigure(page, box);
      saveBytes(bytes, AM.util.sanitizeName(nameFor(page, box), 'figure') + '.png', 'image/png');
    } catch (e) {
      toast('บันทึกรูปนี้ไม่สำเร็จ: ' + (e && e.message), 7000);
    }
    status(null);
  }

  /* Deliberately not async: the archive is built from bytes that are already
     in hand, so the whole thing happens inside the tap that asked for it. */
  function exportZip() {
    const entries = [];
    const taken = new Set();
    for (const page of state.pages) {
      for (const box of page.boxes) {
        if (!box.png) continue;
        const name = AM.util.uniqueName(
          AM.util.sanitizeName(nameFor(page, box), 'figure') + '.png', taken);
        entries.push({ name, data: box.png });
      }
    }
    if (!entries.length) { toast('ยังไม่มีรูปให้บันทึก', 4000); return; }
    /* An ASCII archive name: a Thai one survives macOS and iOS but can arrive
       as mojibake on Windows. The files inside keep their chosen names. */
    const stem = AM.util.sanitizeName(state.settings.prefix || 'figures', 'figures')
      .replace(/[^\x20-\x7E]/g, '') || 'figures';
    saveBytes(AM.zip.makeZip(entries), stem + '-figures.zip', 'application/zip');
  }

  /* ---------- reading a figure with Gemini ---------- */

  /* The key lives in this browser and nowhere else: not in the repository, not
     on the server that serves the page, and never in a URL. */
  const KEY_STORE = 'anglesMaker.geminiKey';
  const getKey = () => { try { return localStorage.getItem(KEY_STORE) || ''; } catch (e) { return ''; } };
  const setKey = v => {
    try { v ? localStorage.setItem(KEY_STORE, v) : localStorage.removeItem(KEY_STORE); }
    catch (e) { toast('เบราว์เซอร์นี้เก็บคีย์ไว้ไม่ได้ (โหมดส่วนตัว?)', 6000); }
  };

  function syncKeyPanel() {
    const key = getKey();
    $('#key-unset').hidden = !!key;
    $('#key-set').hidden = !key;
    $('#ai-state').textContent = key ? 'พร้อม' : 'ปิด';
    if (key) $('#key-mask').textContent = key.slice(0, 6) + '…' + key.slice(-4);
  }

  function bytesToBase64(bytes) {
    let s = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(s);
  }

  async function readWithAI(page, box) {
    const key = getKey();
    if (!key) { toast('ใส่ Gemini API key ก่อน', 4000); return; }
    box.reading = true;
    renderGallery();
    try {
      if (!box.png) box.png = await renderFigure(page, box);
      /* The cleaned, deskewed crop is what the model sees — the same image that
         would otherwise have been pasted into Word. */
      const fig = await AM.extract.readFigure(bytesToBase64(box.png), key);
      AM.geometry.solve(fig);
      box.figure = fig;
    } catch (e) {
      toast('อ่านรูป ' + nameFor(page, box) + ' ไม่สำเร็จ: ' + (e && e.message), 9000);
      if (e && e.raw) console.warn('Gemini response:', e.raw);
    }
    box.reading = false;
    renderGallery();
  }

  async function readSelected() {
    const page = active();
    if (!page) return;
    const list = page.boxes.filter(b => b.selected !== false && !b.figure);
    if (!list.length) { toast('ไม่มีรูปที่เลือกไว้และยังไม่ได้อ่าน', 4000); return; }
    for (let i = 0; i < list.length; i++) {
      status('กำลังอ่านมุม ' + (i + 1) + ' จาก ' + list.length + '…');
      await readWithAI(page, list[i]);
    }
    status(null);
  }

  /* The deskewed page as base64, small enough to keep the request cheap and
     large enough that a 30px angle label survives. */
  function pageBase64(page, maxWidth) {
    const d = page.deskewed;
    const src = grayToCanvas(d.gray, d.w, d.h);
    const scale = Math.min(1, (maxWidth || 1100) / Math.max(d.w, d.h));
    const c = el('canvas');
    c.width = Math.round(d.w * scale);
    c.height = Math.round(d.h * scale);
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(src, 0, 0, c.width, c.height);
    return c.toDataURL('image/png').split(',')[1];
  }

  /* Detection is the model's job now. The offline detector still runs first so
     something is on screen immediately and the app is not useless without a
     key, but where a key exists the model's reading replaces it. */
  async function findWithAI(page) {
    const key = getKey();
    if (!key) return;
    status('กำลังให้ AI หารูปมุมในหน้านี้…');
    try {
      const d = page.deskewed;
      const boxes = await AM.extract.findFigures(pageBase64(page, 1100), key,
                                                 { width: d.w, height: d.h });
      if (boxes.length) {
        for (const b of page.boxes) invalidateBox(b);
        page.boxes = boxes.map(b => {
          const box = makeBox(b, false);
          box.question = b.question || '';
          box.selected = true;
          return box;
        });
        sortBoxes(page);
      } else {
        toast('AI ไม่พบรูปมุมในหน้านี้', 6000);
      }
      page.searched = true;
    } catch (e) {
      toast('ค้นหารูปไม่สำเร็จ: ' + (e && e.message), 9000);
      if (e && e.raw) console.warn('Gemini response:', e.raw);
    }
    status(null);
    renderPages();
    renderAll();
    schedulePrepare(0);
  }

  /* ---------- controls ---------- */

  function syncControls() {
    const page = active();
    if (!page) return;
    const deg = page.angle * 180 / Math.PI;
    $('#in-angle').value = deg.toFixed(1);
    $('#out-angle').textContent = deg.toFixed(1) + '°';

  }

  function initControls() {
    $('#btn-add').onclick = $('#btn-add2').onclick = () => $('#file-input').click();
    $('#file-input').onchange = ev => { addFiles(ev.target.files); ev.target.value = ''; };
    $('#btn-demo').onclick = addDemo;
    $('#btn-find').onclick = () => { const p = active(); if (p) findWithAI(p); };
    $('#btn-read').onclick = readSelected;
    $('#btn-svg-all').onclick = downloadAllSvg;
    $('#btn-all').onclick = () => {
      const p = active(); if (!p) return;
      p.boxes.forEach(b => { b.selected = true; });
      renderGallery(); renderBoxes();
    };
    $('#btn-none').onclick = () => {
      const p = active(); if (!p) return;
      p.boxes.forEach(b => { b.selected = false; });
      renderGallery(); renderBoxes();
    };
    $('#in-manual').onchange = ev => { state.manual = ev.target.checked; renderBoxes(); };
    $('#btn-zip').onclick = exportZip;

    syncKeyPanel();
    $('#btn-key-save').onclick = () => {
      const v = $('#in-key').value.trim();
      if (!v) { toast('ยังไม่ได้ใส่คีย์', 3000); return; }
      setKey(v);
      $('#in-key').value = '';
      syncKeyPanel();
      toast('บันทึกคีย์แล้ว เก็บไว้ในเบราว์เซอร์เครื่องนี้เท่านั้น', 5000);
    };
    $('#btn-key-clear').onclick = () => { setKey(''); syncKeyPanel(); };
    $('#btn-read').onclick = () => {
      const page = active();
      if (!page) return;
      const box = page.boxes.find(b => b.id === state.selected) || page.boxes[0];
      if (!box) { toast('เลือกรูปที่ต้องการก่อน', 3000); return; }
      readWithAI(page, box);
    };

    const angle = $('#in-angle');
    angle.oninput = () => { $('#out-angle').textContent = (+angle.value).toFixed(1) + '°'; };
    angle.onchange = () => {
      const page = active();
      if (!page) return;
      page.angleForced = true;
      page.angle = +angle.value * Math.PI / 180;
      fullRes = null;
      processActive(true);
    };

    $('#in-mode').onchange = ev => {
      state.settings.mode = ev.target.value;
      invalidateAll(); schedulePrepare(); renderList();
    };
    const width = $('#in-width');
    const showWidth = () => {
      $('#out-width').textContent = +width.value ? width.value + ' พิกเซล' : 'ขนาดเดิม';
    };
    width.oninput = () => { state.settings.width = +width.value; showWidth(); };
    width.onchange = () => { invalidateAll(); schedulePrepare(); renderList(); };
    showWidth();
    $('#in-bolder').onchange = ev => {
      state.settings.bolder = ev.target.checked;
      invalidateAll(); schedulePrepare(); renderList();
    };
    $('#in-prefix').oninput = ev => {
      /* Strip only what a filesystem rejects. A \w class here would be ASCII-only
         and would quietly delete every Thai character the user typed. */
      state.settings.prefix = ev.target.value.replace(/[\/\\:*?"<>|]/g, '');
      renderBoxes(); renderList();
    };

    let dragDepth = 0;
    window.addEventListener('dragover', ev => ev.preventDefault());
    window.addEventListener('dragenter', ev => {
      ev.preventDefault(); dragDepth++; document.body.classList.add('dragging');
    });
    window.addEventListener('dragleave', () => {
      if (--dragDepth <= 0) document.body.classList.remove('dragging');
    });
    window.addEventListener('drop', ev => {
      ev.preventDefault(); dragDepth = 0;
      document.body.classList.remove('dragging');
      if (ev.dataTransfer && ev.dataTransfer.files.length) addFiles(ev.dataTransfer.files);
    });
    window.addEventListener('resize', () => { if (active() && active().ready) renderAll(); });
  }

  /* A small handle for scripting and for the test pass; the UI does not use it. */
  AM.app = { state, active, renderFigure, exportOne, exportZip, addDemo, processActive, nameFor,
             readWithAI, readSelected, findWithAI, downloadSvg, downloadAllSvg,
             setAngleLabel, renderGallery, getKey, bytesToBase64, pageBase64 };

  initControls();
  initEditing();
  if (/[?&]demo/.test(location.search)) addDemo();
})();
