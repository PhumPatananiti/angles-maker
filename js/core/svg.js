/* Angles Maker — draw a figure as SVG.
   Vector out, because Word 2016+ places SVG crisply at any size and can turn it
   into editable shapes on demand; a PNG can do neither. */
(function (root) {
  'use strict';
  const AM = root.AM || (root.AM = {});

  const esc = s => String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const f = n => (Math.round(n * 100) / 100).toString();

  const DEFAULTS = {
    width: 640, padding: 46, stroke: 2, color: '#111', fontSize: 17,
    fontFamily: "'Times New Roman', 'Sarabun', serif",
    arrow: 9, arcRadius: 30, showPoints: true, pointRadius: 3.2, background: 'none'
  };

  /* Clip an infinite line through p in direction d against the drawing box,
     which is how a "line" and a "ray" get their ends.
     Each call states one half-plane as t*den <= num; the lower bounds need the
     numerator negated as well as the denominator, or the range comes back
     inverted and the line renders as a stub a few pixels long. */
  function clipToBox(p, d, box) {
    let tMin = -Infinity, tMax = Infinity;
    const slab = (num, den) => {
      if (Math.abs(den) < 1e-9) return num >= 0;
      const t = num / den;
      if (den > 0) { if (t < tMax) tMax = t; } else if (t > tMin) tMin = t;
      return true;
    };
    if (!slab(box.x1 - p.x, d.x) || !slab(p.x - box.x0, -d.x)) return null;
    if (!slab(box.y1 - p.y, d.y) || !slab(p.y - box.y0, -d.y)) return null;
    if (tMin > tMax) return null;
    return { tMin, tMax };
  }

  function arrowHead(x, y, angle, size, color) {
    const a1 = angle + Math.PI - 0.38, a2 = angle + Math.PI + 0.38;
    return '<path d="M' + f(x) + ' ' + f(y) +
      'L' + f(x + Math.cos(a1) * size) + ' ' + f(y + Math.sin(a1) * size) +
      'L' + f(x + Math.cos(a2) * size) + ' ' + f(y + Math.sin(a2) * size) +
      'Z" fill="' + color + '"/>';
  }

  function render(figure, options) {
    const o = Object.assign({}, DEFAULTS, options || {});
    const G = AM.geometry;
    /* A caller may pin the bounds — during a drag the figure must not rescale
       under the finger, or the point runs away from the pointer. */
    const b = o.bounds || G.bounds(figure);

    const scale = (o.width - o.padding * 2) / b.w;
    const height = Math.round(b.h * scale + o.padding * 2);
    const X = px => (px - b.x) * scale + o.padding;
    const Y = py => (py - b.y) * scale + o.padding;
    const P = id => {
      const p = figure.points[id];
      return p ? { x: X(p.x), y: Y(p.y) } : null;
    };
    const box = { x0: 3, y0: 3, x1: o.width - 3, y1: height - 3 };

    const out = [];
    out.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + o.width + ' ' + height +
             '" width="' + o.width + '" height="' + height + '" role="img">');
    if (o.background && o.background !== 'none') {
      out.push('<rect width="100%" height="100%" fill="' + o.background + '"/>');
    }
    out.push('<g stroke-linecap="round" stroke-linejoin="round">');

    /* lines */
    for (const l of figure.lines || []) {
      const a = P(l.a), c = P(l.b);
      if (!a || !c) continue;
      const len = Math.hypot(c.x - a.x, c.y - a.y) || 1e-9;
      const d = { x: (c.x - a.x) / len, y: (c.y - a.y) / len };
      const kind = l.kind || 'segment';
      let from = a, to = c;
      if (kind !== 'segment') {
        const clip = clipToBox(a, d, box);
        if (clip) {
          const tStart = kind === 'line' ? clip.tMin : 0;
          from = { x: a.x + d.x * tStart, y: a.y + d.y * tStart };
          to = { x: a.x + d.x * clip.tMax, y: a.y + d.y * clip.tMax };
        }
      }
      out.push('<line x1="' + f(from.x) + '" y1="' + f(from.y) + '" x2="' + f(to.x) +
               '" y2="' + f(to.y) + '" stroke="' + o.color + '" stroke-width="' + o.stroke + '"/>');
      if (o.interactive) {
        /* An invisible fat line over the thin one: a 2px stroke is not something
           a finger can find. */
        out.push('<line x1="' + f(from.x) + '" y1="' + f(from.y) + '" x2="' + f(to.x) +
                 '" y2="' + f(to.y) + '" stroke="transparent" stroke-width="18"' +
                 ' data-line="' + esc(l.id) + '" style="cursor:move"/>');
      }

      const ang = Math.atan2(to.y - from.y, to.x - from.x);
      const arrows = l.arrows || (kind === 'line' ? 'both' : kind === 'ray' ? 'end' : 'none');
      if (arrows === 'end' || arrows === 'both') out.push(arrowHead(to.x, to.y, ang, o.arrow, o.color));
      if (arrows === 'start' || arrows === 'both') {
        out.push(arrowHead(from.x, from.y, ang + Math.PI, o.arrow, o.color));
      }

      /* Parallel marks: the chevrons a textbook puts on lines that belong to
         the same parallel family. */
      const ticks = l.ticks || 0;
      if (ticks > 0) {
        const mx = (from.x + to.x) / 2, my = (from.y + to.y) / 2;
        const step = o.stroke * 3.2, size = o.stroke * 3.4;
        for (let i = 0; i < ticks; i++) {
          const off = (i - (ticks - 1) / 2) * step;
          const cx = mx + Math.cos(ang) * off, cy = my + Math.sin(ang) * off;
          const back = ang + Math.PI;
          out.push('<path d="M' + f(cx + Math.cos(back - 0.6) * size) + ' ' +
                   f(cy + Math.sin(back - 0.6) * size) + 'L' + f(cx) + ' ' + f(cy) +
                   'L' + f(cx + Math.cos(back + 0.6) * size) + ' ' +
                   f(cy + Math.sin(back + 0.6) * size) +
                   '" fill="none" stroke="' + o.color + '" stroke-width="' + o.stroke + '"/>');
        }
      }
    }

    /* angle marks and their labels */
    for (const a of figure.angles || []) {
      if (a.show === false) continue;
      const v = P(a.vertex), fr = P(a.from), to = P(a.to);
      if (!v || !fr || !to) continue;
      const a1 = Math.atan2(fr.y - v.y, fr.x - v.x);
      const a2 = Math.atan2(to.y - v.y, to.x - v.x);
      let delta = a2 - a1;
      while (delta <= -Math.PI) delta += Math.PI * 2;
      while (delta > Math.PI) delta -= Math.PI * 2;
      const r = a.radius ? a.radius * scale : o.arcRadius;
      const measured = AM.geometry.measure(figure, a);

      if (measured !== null && Math.abs(measured - 90) < 0.5) {
        /* A right angle is drawn as a square, never as an arc. */
        const s = r * 0.55;
        const u = { x: Math.cos(a1), y: Math.sin(a1) }, w = { x: Math.cos(a2), y: Math.sin(a2) };
        out.push('<path d="M' + f(v.x + u.x * s) + ' ' + f(v.y + u.y * s) +
                 'L' + f(v.x + (u.x + w.x) * s) + ' ' + f(v.y + (u.y + w.y) * s) +
                 'L' + f(v.x + w.x * s) + ' ' + f(v.y + w.y * s) +
                 '" fill="none" stroke="' + o.color + '" stroke-width="' + o.stroke + '"/>');
      } else {
        const large = Math.abs(delta) > Math.PI ? 1 : 0;
        const sweep = delta > 0 ? 1 : 0;
        out.push('<path d="M' + f(v.x + Math.cos(a1) * r) + ' ' + f(v.y + Math.sin(a1) * r) +
                 'A' + f(r) + ' ' + f(r) + ' 0 ' + large + ' ' + sweep + ' ' +
                 f(v.x + Math.cos(a2) * r) + ' ' + f(v.y + Math.sin(a2) * r) +
                 '" fill="none" stroke="' + o.color + '" stroke-width="' + o.stroke + '"/>');
      }

      if (a.label) {
        const mid = a1 + delta / 2;
        const lr = r + o.fontSize * 0.95;
        out.push('<text x="' + f(v.x + Math.cos(mid) * lr) + '" y="' +
                 f(v.y + Math.sin(mid) * lr) + '" font-family="' + o.fontFamily +
                 '" font-size="' + o.fontSize + '" fill="' + o.color +
                 '" text-anchor="middle" dominant-baseline="central">' + esc(a.label) + '</text>');
      }
    }

    /* point dots and their names */
    if (o.showPoints) {
      const cx = X(b.x + b.w / 2), cy = Y(b.y + b.h / 2);
      for (const id in figure.points) {
        const pt = figure.points[id];
        if (pt.show === false) continue;
        const p = P(id);
        out.push('<circle cx="' + f(p.x) + '" cy="' + f(p.y) + '" r="' +
                 (o.interactive ? Math.max(o.pointRadius, 5) : o.pointRadius) +
                 '" fill="' + o.color + '"/>');
        if (o.interactive) {
          out.push('<circle cx="' + f(p.x) + '" cy="' + f(p.y) + '" r="15" fill="transparent"' +
                   ' data-point="' + esc(id) + '" style="cursor:grab"/>');
        }
        const label = pt.label === undefined ? id : pt.label;
        if (label) {
          /* Push the name away from the middle of the figure so it never lands
             on top of a line. */
          const ang = Math.atan2(p.y - cy, p.x - cx) || 0;
          const d = o.fontSize * 1.05;
          out.push('<text x="' + f(p.x + Math.cos(ang) * d) + '" y="' + f(p.y + Math.sin(ang) * d) +
                   '" font-family="' + o.fontFamily + '" font-size="' + o.fontSize +
                   '" fill="' + o.color + '" text-anchor="middle" dominant-baseline="central">' +
                   esc(label) + '</text>');
        }
      }
    }

    for (const l of figure.labels || []) {
      out.push('<text x="' + f(X(l.x)) + '" y="' + f(Y(l.y)) + '" font-family="' + o.fontFamily +
               '" font-size="' + (l.size || o.fontSize) + '" fill="' + o.color +
               '" text-anchor="middle" dominant-baseline="central">' + esc(l.text) + '</text>');
    }

    out.push('</g></svg>');
    return out.join('\n');
  }

  AM.svg = { render, DEFAULTS };
})(typeof globalThis !== 'undefined' ? globalThis : this);
