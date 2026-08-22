/* Angles Maker — find the figures on a deskewed page.
   Component shape, not stroke orientation: every transversal in this workbook is
   oblique, and run-length in a fixed set of directions cannot see them. */
(function (root) {
  'use strict';
  const AM = root.AM || (root.AM = {});
  const U = () => AM.util;

  const DEFAULTS = {
    glyphMaxHeight: 1.9,     // x text height
    glyphMaxWidth: 6,
    textLineMinWidth: 6,
    ruleThin: 0.35,
    ruleLong: 2.5,
    bigMin: 2.2,
    maxFill: 0.35,           // above this it is a solid blob, not line art
    runFraction: 0.55,       // unbroken stroke / width, separates a rule from a text line
    blobFill: 0.85,          // a solid filled region is never line art
    textDilate: 0.5,         // x text height — horizontal, builds text lines
    markAttach: 0.5,         // x text height — how far above or below a text line a
                             //   loose mark can sit and still belong to it
    markMaxHeight: 0.8,      // x text height — anything taller is a glyph, not a mark
    textLineMaxHeight: 2.2,  // x text height
    groupDilate: 0.6,        // x text height — tight, keeps the answer column out
    mergeGap: 3.0,           // x text height — generous, rejoins split figures
    strayTextDistance: 1.2,  // x text height
    minDarkness: 0.42,       // rejects bleed-through from the reverse page
    minBoxWidth: 3.0,
    minBoxHeight: 1.5,
    minBoxLongSide: 5.0,
    maxPageFraction: 0.62,   // a "figure" bigger than this is a merge failure
    pad: 0.04,
    minPadPx: 6
  };

  function estimateTextHeight(comps, pageH) {
    const hi = Math.max(12, pageH * 0.05);
    const heights = [];
    for (const c of comps) {
      if (c.area < 4) continue;
      if (c.h < 3 || c.h > hi) continue;
      if (c.w > hi * 8) continue;
      heights.push(c.h);
    }
    if (heights.length < 12) return Math.max(8, Math.round(pageH * 0.012));
    /* 70th percentile, not the median: Thai vowel and tone marks are numerous
       and tiny, and they drag a median well below the real glyph height. */
    return U().clamp(Math.round(U().percentile(heights, 0.7)), 5, Math.round(pageH * 0.05));
  }

  function classify(c, th, o) {
    const diag = Math.sqrt(c.w * c.w + c.h * c.h);
    if (diag < 0.35 * th) return 'speck';
    /* A solidly filled region — the chapter banner, the dark surround beyond the
       page edge, a thumb over the lens — is never a drawing. Checked first,
       because a full-height dark band is otherwise a perfect "vertical rule". */
    if (c.fill > o.blobFill && c.area > 4 * th * th) return 'blob';
    const thin = o.ruleThin * th, long = o.ruleLong * th;
    if ((c.h <= thin && c.w >= long) || (c.w <= thin && c.h >= long)) return 'rule';
    if (c.h >= o.bigMin * th && c.w >= o.bigMin * th && c.fill <= o.maxFill) return 'big';
    /* Wide and flat: either a line of text, or a drawn line whose arrowheads or
       tick marks have made its bounding box several pixels tall. The drawn line
       is one unbroken run; text is broken between glyphs. */
    if (c.w > o.textLineMinWidth * th && c.h <= o.glyphMaxHeight * th) {
      return (c.maxRunH || 0) >= o.runFraction * c.w && c.fill <= 0.6 ? 'rule' : 'textline';
    }
    if (c.h > o.textLineMinWidth * th && c.w <= o.glyphMaxHeight * th) {
      return (c.maxRunV || 0) >= o.runFraction * c.h && c.fill <= 0.6 ? 'rule' : 'other';
    }
    if (c.h <= o.glyphMaxHeight * th && c.w <= o.glyphMaxWidth * th) return 'glyph';
    return 'other';
  }

  const isSeed = k => k === 'rule' || k === 'big';

  function groupsOf(labels, groupLabels, comps) {
    let maxId = 0;
    for (const c of comps) if (c.id > maxId) maxId = c.id;
    const wanted = new Uint8Array(maxId + 1);
    for (const c of comps) wanted[c.id] = 1;
    const compToGroup = new Int32Array(maxId + 1).fill(-1);
    for (let i = 0; i < labels.length; i++) {
      const c = labels[i];
      if (c < 0 || !wanted[c]) continue;
      if (compToGroup[c] === -1) compToGroup[c] = groupLabels[i];
    }
    const map = new Map();
    for (const c of comps) {
      const g = compToGroup[c.id];
      if (g < 0) continue;
      if (!map.has(g)) map.set(g, []);
      map.get(g).push(c);
    }
    return map;
  }

  /* A line of running text always separates two questions and never appears
     inside one figure, so it is a reliable "do not merge across this" marker.
     Without it, any gap threshold generous enough to rejoin the five separate
     lines of a ladder figure also welds consecutive questions together. */
  function textLineBetween(a, b, textRects) {
    if (!textRects || !textRects.length) return false;
    const top = a.y < b.y ? a : b, bottom = a.y < b.y ? b : a;
    const bandTop = top.y + top.h, bandBottom = bottom.y;
    if (bandBottom <= bandTop) return false;
    const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x + a.w, b.x + b.w);
    for (const r of textRects) {
      if (r.y + r.h <= bandTop + 2 || r.y >= bandBottom - 2) continue;
      if (r.x + r.w <= x0 || r.x >= x1) continue;
      return true;
    }
    return false;
  }

  function mergeBoxes(boxes, gap, textRects) {
    let changed = true;
    let list = boxes.slice();
    while (changed) {
      changed = false;
      outer:
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          if (textLineBetween(list[i].rect, list[j].rect, textRects)) continue;
          if (U().rectGap(list[i].rect, list[j].rect) <= gap) {
            const merged = {
              rect: U().unionRect(list[i].rect, list[j].rect),
              area: list[i].area + list[j].area,
              darkSum: list[i].darkSum + list[j].darkSum
            };
            list.splice(j, 1);
            list.splice(i, 1, merged);
            changed = true;
            break outer;
          }
        }
      }
    }
    return list;
  }

  /* Padding makes a figure breathe, but padding that reaches into the line of
     text above or below drags the tops of glyphs into the exported PNG. Give
     each side only as much room as there is before the next line of text. */
  function padAllowance(raw, textRects, pad) {
    const a = { top: pad, bottom: pad, left: pad, right: pad };
    if (!textRects) return a;
    for (const t of textRects) {
      const overlapsX = t.x < raw.x + raw.w && raw.x < t.x + t.w;
      const overlapsY = t.y < raw.y + raw.h && raw.y < t.y + t.h;
      if (overlapsX) {
        if (t.y + t.h <= raw.y) a.top = Math.min(a.top, Math.max(0, raw.y - (t.y + t.h) - 1));
        if (t.y >= raw.y + raw.h) a.bottom = Math.min(a.bottom, Math.max(0, t.y - (raw.y + raw.h) - 1));
      }
      if (overlapsY) {
        if (t.x + t.w <= raw.x) a.left = Math.min(a.left, Math.max(0, raw.x - (t.x + t.w) - 1));
        if (t.x >= raw.x + raw.w) a.right = Math.min(a.right, Math.max(0, t.x - (raw.x + raw.w) - 1));
      }
    }
    return a;
  }

  function readingOrder(boxes) {
    const sorted = boxes.slice().sort((a, b) => a.y - b.y);
    const out = [];
    while (sorted.length) {
      const first = sorted.shift();
      const band = [first];
      const bottom = first.y + first.h;
      for (let i = 0; i < sorted.length;) {
        const b = sorted[i];
        const overlap = Math.min(bottom, b.y + b.h) - Math.max(first.y, b.y);
        if (overlap > 0.5 * Math.min(first.h, b.h)) { band.push(b); sorted.splice(i, 1); }
        else i++;
      }
      band.sort((a, b) => a.x - b.x);
      out.push.apply(out, band);
    }
    return out;
  }

  /* Find whole lines of running text and take them out of play.
     Excluding components already classified as `textline` is not enough: a line
     of text is several hundred separate glyph components, and the figure
     grouping happily swallows them one by one. So chain glyphs horizontally
     first, and drop any chain that is line-of-text shaped and contains no
     drawn stroke. */
  function findTextComponents(mask, w, h, labels, comps, th, o) {
    const img = AM.image;
    const rH = Math.max(1, Math.round(o.textDilate * th));
    /* Horizontal only. Dilating vertically far enough to catch Thai vowel and
       tone marks also welds neighbouring lines together whenever the leading is
       tight, and a chain two lines tall stops looking like text at all. */
    const chained = img.morphXY(mask, w, h, rH, 0, 1);
    const chains = img.connectedComponents(chained, w, h, null);
    const groups = groupsOf(labels, chains.labels, comps);
    let maxId = 0;
    for (const c of comps) if (c.id > maxId) maxId = c.id;
    const isText = new Uint8Array(maxId + 1);
    const rects = [];
    for (const members of groups.values()) {
      let rect = members[0].rect;
      let hasStroke = false;
      for (const c of members) {
        rect = U().unionRect(rect, c.rect);
        if (isSeed(c.kind)) hasStroke = true;
      }
      if (hasStroke) continue;
      if (rect.w > o.textLineMinWidth * th && rect.h <= o.textLineMaxHeight * th) {
        for (const c of members) isText[c.id] = 1;
        rects.push(rect);
      }
    }

    /* Now pick up the marks that ride above and below a line — Thai sara and
       tone marks, which are separate components and are never reached by
       horizontal chaining. Bounded to small components, so unlike a vertical
       dilation this can never swallow the next line. */
    const attach = o.markAttach * th, maxH = o.markMaxHeight * th;
    const loose = comps.filter(c => !isText[c.id] && c.h <= maxH && c.w <= 2 * th);
    for (let i = 0; i < rects.length; i++) {
      const t = rects[i];
      for (const m of loose) {
        if (isText[m.id]) continue;
        if (m.x1 < t.x || m.x0 > t.x + t.w) continue;
        const above = t.y - (m.y0 + m.h);
        const below = m.y0 - (t.y + t.h);
        if (Math.max(above, below) > attach) continue;
        isText[m.id] = 1;
        rects[i] = U().unionRect(t, m.rect);
      }
    }
    return { isText, rects };
  }

  /* gray: flattened, deskewed. mask: binarised, deskewed. Same dimensions. */
  function detectFigures(gray, mask, w, h, options) {
    const o = Object.assign({}, DEFAULTS, options || {});
    const img = AM.image;
    const { labels, comps } = img.connectedComponents(mask, w, h, gray);
    const th = o.textHeight || estimateTextHeight(comps, h);
    for (const c of comps) c.kind = classify(c, th, o);

    const text = findTextComponents(mask, w, h, labels, comps, th, o);
    const isText = text.isText;
    for (const c of comps) if (isText[c.id]) c.isText = true;
    const figureMask = new Uint8Array(w * h);
    for (let i = 0; i < mask.length; i++) {
      if (mask[i] && labels[i] >= 0 && !isText[labels[i]]) figureMask[i] = 1;
    }

    const dil = img.dilateMask(figureMask, w, h, Math.max(1, Math.round(o.groupDilate * th)));
    const groupCC = img.connectedComponents(dil, w, h, null);
    const groups = groupsOf(labels, groupCC.labels, comps.filter(c => !c.isText));

    const candidates = [];
    for (const members of groups.values()) {
      const seeds = members.filter(c => isSeed(c.kind));
      if (!seeds.length) continue;
      let seedRect = seeds[0].rect;
      for (const s of seeds) seedRect = U().unionRect(seedRect, s.rect);

      let rect = seedRect, area = 0, darkSum = 0;
      for (const c of members) {
        if (c.kind === 'textline' || c.isText) continue;
        rect = U().unionRect(rect, c.rect);
        area += c.area;
        darkSum += c.darkSum;
      }
      candidates.push({ rect, area, darkSum });
    }

    const merged = mergeBoxes(candidates, o.mergeGap * th, text.rects);

    const pageArea = w * h;
    const kept = [];
    const rejected = [];
    for (const c of merged) {
      const r = c.rect;
      const darkness = c.area ? c.darkSum / c.area / 255 : 0;
      const reason =
        (r.w < o.minBoxWidth * th || r.h < o.minBoxHeight * th) ? 'too small' :
        (Math.max(r.w, r.h) < o.minBoxLongSide * th) ? 'too small' :
        (darkness < o.minDarkness) ? 'too faint (bleed-through)' :
        (c.area / (r.w * r.h) > 0.5) ? 'solid blob' :
        (r.w * r.h > o.maxPageFraction * pageArea) ? 'covers the page' : null;
      if (reason) { rejected.push({ rect: r, reason, darkness }); continue; }
      const pad = Math.max(o.minPadPx, Math.round(o.pad * Math.max(r.w, r.h)));
      const a = padAllowance(r, text.rects, pad);
      const x0 = Math.max(0, r.x - a.left), y0 = Math.max(0, r.y - a.top);
      kept.push({
        x: x0, y: y0,
        w: Math.min(w, r.x + r.w + a.right) - x0,
        h: Math.min(h, r.y + r.h + a.bottom) - y0,
        darkness
      });
    }
    return { boxes: readingOrder(kept), textHeight: th, comps, rejected,
             textRects: text.rects, options: o };
  }

  AM.detect = { detectFigures, estimateTextHeight, classify, mergeBoxes, readingOrder,
                findTextComponents, padAllowance, DEFAULTS };
})(typeof globalThis !== 'undefined' ? globalThis : this);
