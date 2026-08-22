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
  let nextId = 1;

  const state = {
    pages: [],
    activeId: null,
    selected: null,
    undo: [],
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
    if (!page.boxes.length) {
      toast('ไม่พบรูปในหน้านี้ — ลากกรอบสี่เหลี่ยมคลุมรูปที่ต้องการเพื่อเพิ่มเอง', 7000);
    }
  }

  const makeBox = (b, manual) => ({
    id: nextId++, x: b.x, y: b.y, w: b.w, h: b.h, label: b.label || '', manual: !!manual
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
    state.pages = state.pages.filter(p => p.id !== id);
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
    $('#viewport').hidden = !has;
    $('#side').hidden = !has;
    if (!has) return;

    const d = page.deskewed;
    const canvas = $('#page-canvas');
    canvas.width = d.w; canvas.height = d.h;
    canvas.getContext('2d').putImageData(
      new ImageData(AM.image.grayToRGBA(d.gray, d.w, d.h), d.w, d.h), 0, 0);

    const vp = $('#viewport');
    const availW = vp.clientWidth - 40, availH = vp.clientHeight - 40;
    const width = Math.min(availW, availH * (d.w / d.h));
    const wrap = $('#canvas-wrap');
    wrap.style.width = Math.max(120, width) + 'px';
    renderBoxes();
    renderList();
  }

  function renderBoxes() {
    const page = active();
    const ov = $('#overlay');
    ov.innerHTML = '';
    const d = page.deskewed;
    page.boxes.forEach((b, i) => {
      const n = el('div', 'box' + (state.selected === b.id ? ' sel' : ''));
      n.style.left = (100 * b.x / d.w) + '%';
      n.style.top = (100 * b.y / d.h) + '%';
      n.style.width = (100 * b.w / d.w) + '%';
      n.style.height = (100 * b.h / d.h) + '%';
      n.dataset.id = b.id;
      n.appendChild(el('span', 'tag', nameFor(page, b, i)));
      ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].forEach(k => {
        const h = el('div', 'h ' + k);
        h.dataset.handle = k;
        n.appendChild(h);
      });
      ov.appendChild(n);
    });
  }

  /* Numbering runs across every loaded page, so three photos of one exercise
     give a single q01..q20 sequence. */
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
    return state.settings.prefix + String(figureIndex(page, box)).padStart(2, '0');
  }

  function renderList() {
    const page = active();
    const list = $('#fig-list');
    list.innerHTML = '';
    $('#fig-count').textContent = state.pages.reduce((n, p) => n + p.boxes.length, 0);
    if (!page.boxes.length) {
      list.appendChild(el('div', 'empty', 'ยังไม่พบรูปในหน้านี้ ลากกรอบสี่เหลี่ยมคลุมรูปที่ต้องการ'));
      return;
    }
    page.boxes.forEach(b => {
      const row = el('div', 'fig' + (state.selected === b.id ? ' sel' : ''));
      row.appendChild(previewCanvas(page, b));
      const name = el('div', 'name');
      const input = el('input');
      input.value = nameFor(page, b);
      input.onchange = () => {
        b.label = AM.util.sanitizeName(input.value, '');
        input.value = nameFor(page, b);
        renderBoxes();
      };
      input.onclick = ev => ev.stopPropagation();
      name.appendChild(input);
      row.appendChild(name);
      const dl = el('button', 'dl', '↓');
      dl.title = 'ดาวน์โหลดรูปนี้';
      dl.onclick = ev => { ev.stopPropagation(); exportOne(page, b); };
      row.appendChild(dl);
      row.onclick = () => { state.selected = b.id; renderBoxes(); renderList(); };
      list.appendChild(row);
    });
  }

  /* Previews come from the analysis-scale page, so nothing at full resolution
     has to be decoded just to draw a 54px thumbnail. */
  function previewCanvas(page, box) {
    const d = page.deskewed;
    const c = el('canvas');
    c.width = 108; c.height = 76;
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
        state.selected = null;
        renderBoxes(); renderList(); renderPages();
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
        renderBoxes();
      } else if (ev.key === 'Escape') {
        state.selected = null; renderBoxes(); renderList();
      }
    });
  }

  /* ---------- export ---------- */

  async function ensureFullRes(page) {
    if (fullRes && fullRes.pageId === page.id && fullRes.angle === page.angle) return fullRes;
    fullRes = null;
    const src = await sourceBitmap(page);
    const size = AM.util.rotatedSize(src.width, src.height, page.angle);
    const c = el('canvas');
    c.width = size.w; c.height = size.h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, size.w, size.h);
    /* Same centre-to-centre convention as image.rotateGray, which is what makes
       box / scale a valid crop rectangle here. */
    ctx.translate(size.w / 2, size.h / 2);
    ctx.rotate(page.angle);
    ctx.drawImage(src, -src.width / 2, -src.height / 2);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (src.close) src.close();
    fullRes = { pageId: page.id, angle: page.angle, canvas: c, ctx, w: size.w, h: size.h };
    return fullRes;
  }

  async function renderFigure(page, box) {
    const fr = await ensureFullRes(page);
    const b = AM.pipeline.boxToFullRes(box, page.scale);
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

  function saveBytes(bytes, filename) {
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
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
      saveBytes(bytes, AM.util.sanitizeName(nameFor(page, box), 'figure') + '.png');
    } catch (e) {
      toast('บันทึกรูปนี้ไม่สำเร็จ: ' + (e && e.message), 7000);
    }
    status(null);
  }

  async function exportZip() {
    const total = state.pages.reduce((n, p) => n + p.boxes.length, 0);
    if (!total) { toast('ยังไม่มีรูปให้บันทึก', 4000); return; }
    const entries = [];
    const taken = new Set();
    let done = 0;
    for (const page of state.pages) {
      if (!page.ready || !page.boxes.length) continue;
      for (const box of page.boxes) {
        status('กำลังบันทึกรูปที่ ' + (++done) + ' จาก ' + total + '…');
        await new Promise(r => setTimeout(r, 0));   // let the status paint
        try {
          const bytes = await renderFigure(page, box);
          const name = AM.util.uniqueName(
            AM.util.sanitizeName(nameFor(page, box), 'figure') + '.png', taken);
          entries.push({ name, data: bytes });
        } catch (e) {
          toast('ข้ามไปหนึ่งรูป: ' + (e && e.message), 6000);
        }
      }
      if (fullRes && fullRes.pageId === page.id) fullRes = null;   // release between pages
    }
    status(null);
    if (!entries.length) return;
    saveBytes(AM.zip.makeZip(entries), (state.settings.prefix || 'figures') + '-รูปทั้งหมด.zip');
  }

  /* ---------- controls ---------- */

  function syncControls() {
    const page = active();
    if (!page) return;
    const deg = page.angle * 180 / Math.PI;
    $('#in-angle').value = deg.toFixed(1);
    $('#out-angle').textContent = deg.toFixed(1) + '°';
    const th = page.textHeightOverride || 0;
    $('#in-th').value = th;
    $('#out-th').textContent = th ? th + ' พิกเซล'
      : 'อัตโนมัติ (' + (page.autoTextHeight || 0) + ' พิกเซล)';
  }

  function initControls() {
    $('#btn-add').onclick = $('#btn-add2').onclick = () => $('#file-input').click();
    $('#file-input').onchange = ev => { addFiles(ev.target.files); ev.target.value = ''; };
    $('#btn-demo').onclick = addDemo;
    $('#btn-redetect').onclick = () => processActive(true);
    $('#btn-clear').onclick = () => {
      const page = active();
      if (!page) return;
      pushUndo();
      page.boxes = [];
      renderBoxes(); renderList(); renderPages();
    };
    $('#btn-zip').onclick = exportZip;

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

    const th = $('#in-th');
    th.oninput = () => {
      $('#out-th').textContent = +th.value ? th.value + ' พิกเซล'
        : 'อัตโนมัติ (' + ((active() || {}).autoTextHeight || 0) + ' พิกเซล)';
    };
    th.onchange = () => {
      const page = active();
      if (!page) return;
      page.textHeightOverride = +th.value || 0;
      processActive(true);
    };

    $('#in-mode').onchange = ev => { state.settings.mode = ev.target.value; };
    const width = $('#in-width');
    const showWidth = () => {
      $('#out-width').textContent = +width.value ? width.value + ' พิกเซล' : 'ขนาดเดิม';
    };
    width.oninput = () => { state.settings.width = +width.value; showWidth(); };
    showWidth();
    $('#in-bolder').onchange = ev => { state.settings.bolder = ev.target.checked; };
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
  AM.app = { state, active, renderFigure, exportOne, exportZip, addDemo, processActive, nameFor };

  initControls();
  initEditing();
  if (/[?&]demo/.test(location.search)) addDemo();
})();
