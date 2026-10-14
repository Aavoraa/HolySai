// @ts-nocheck
/* Ported verbatim from the approved wireframe (assets/js/charts.js). */
import { fmt } from './format';
const HS: any = { fmt };
/* ==========================================================================
   CHARTS — dependency-free inline SVG. Every chart scales to its container
   via viewBox and exposes an accessible text summary.
   ========================================================================== */
(function (HS) {
  'use strict';

  var SERIES = ['var(--viz-1)', 'var(--viz-2)', 'var(--viz-3)', 'var(--viz-4)', 'var(--viz-5)', 'var(--viz-6)', 'var(--viz-7)', 'var(--viz-8)'];
  var GRID = 'var(--viz-grid)', AXIS = 'var(--viz-axis)', MUTED = 'var(--text-muted)';

  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function nice(max) {
    if (max <= 0) return 10;
    var pow = Math.pow(10, Math.floor(Math.log10(max)));
    var n = max / pow;
    var step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
    return step * pow;
  }
  function svgOpen(w, h, label, fixed) {
    var style = fixed
      ? 'width:100%;max-width:' + w + 'px;height:auto;display:block;margin:0 auto'
      : 'width:100%;height:auto;display:block';
    return '<svg viewBox="0 0 ' + w + ' ' + h + '" style="' + style + '" ' +
      'role="img" aria-label="' + esc(label || 'chart') + '" font-family="Inter, system-ui, sans-serif">';
  }
  function path(pts, close, baseY) {
    var d = pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' ');
    if (close) d += ' L' + pts[pts.length - 1][0].toFixed(1) + ' ' + baseY + ' L' + pts[0][0].toFixed(1) + ' ' + baseY + ' Z';
    return d;
  }

  /* ---- Line / area ----------------------------------------------------- */
  /* opts: { labels:[], series:[{name, values:[], color, dashed, fill}], height, yMax, unit, showDots, band } */
  HS.charts = {};
  HS.charts.line = function (o) {
    var W = 680, H = o.height || 230, P = { t: 16, r: 16, b: 28, l: 42 };
    var iw = W - P.l - P.r, ih = H - P.t - P.b;
    var all = [];
    o.series.forEach(function (s) { all = all.concat(s.values); });
    var max = o.yMax != null ? o.yMax : nice(Math.max.apply(null, all) * 1.08);
    var min = o.yMin != null ? o.yMin : 0;
    var n = o.labels.length;
    var X = function (i) { return P.l + (n === 1 ? iw / 2 : (i / (n - 1)) * iw); };
    var Y = function (v) { return P.t + ih - ((v - min) / (max - min)) * ih; };
    var out = svgOpen(W, H, o.label || 'Line chart');

    for (var g = 0; g <= 4; g++) {
      var y = P.t + (g / 4) * ih, val = max - (g / 4) * (max - min);
      out += '<line x1="' + P.l + '" y1="' + y + '" x2="' + (W - P.r) + '" y2="' + y + '" stroke="' + GRID + '" stroke-width="1"/>';
      out += '<text x="' + (P.l - 8) + '" y="' + (y + 4) + '" text-anchor="end" font-size="10" fill="' + MUTED + '">' + HS.fmt.compact(val) + (o.unit || '') + '</text>';
    }
    o.labels.forEach(function (l, i) {
      if (n > 12 && i % 2) return;
      out += '<text x="' + X(i) + '" y="' + (H - 8) + '" text-anchor="middle" font-size="10" fill="' + MUTED + '">' + esc(l) + '</text>';
    });
    o.series.forEach(function (s, si) {
      var col = s.color || SERIES[si % SERIES.length];
      var pts = s.values.map(function (v, i) { return [X(i), Y(v)]; });
      if (s.fill !== false && si === 0 && o.area !== false) {
        out += '<path d="' + path(pts, true, P.t + ih) + '" fill="' + col + '" opacity=".08"/>';
      }
      out += '<path d="' + path(pts) + '" fill="none" stroke="' + col + '" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"' +
        (s.dashed ? ' stroke-dasharray="5 4"' : '') + '/>';
      if (o.showDots !== false) {
        pts.forEach(function (p, i) {
          out += '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="3" style="fill:var(--surface)" stroke="' + col + '" stroke-width="2"><title>' +
            esc(s.name + ' — ' + o.labels[i] + ': ' + s.values[i] + (o.unit || '')) + '</title></circle>';
        });
      }
    });
    return out + '</svg>';
  };

  /* ---- Vertical bars (grouped or single) -------------------------------- */
  HS.charts.bar = function (o) {
    var W = 680, H = o.height || 230, P = { t: 16, r: 14, b: 30, l: 42 };
    var iw = W - P.l - P.r, ih = H - P.t - P.b;
    var all = []; o.series.forEach(function (s) { all = all.concat(s.values); });
    var max = o.yMax != null ? o.yMax : nice(Math.max.apply(null, all) * 1.1);
    var n = o.labels.length, groups = o.series.length;
    var slot = iw / n, bw = Math.min(o.maxBar || 34, (slot * .68) / groups);
    var Y = function (v) { return P.t + ih - (v / max) * ih; };
    var out = svgOpen(W, H, o.label || 'Bar chart');
    for (var g = 0; g <= 4; g++) {
      var y = P.t + (g / 4) * ih;
      out += '<line x1="' + P.l + '" y1="' + y + '" x2="' + (W - P.r) + '" y2="' + y + '" stroke="' + GRID + '"/>';
      out += '<text x="' + (P.l - 8) + '" y="' + (y + 4) + '" text-anchor="end" font-size="10" fill="' + MUTED + '">' + HS.fmt.compact(max - (g / 4) * max) + '</text>';
    }
    o.labels.forEach(function (l, i) {
      var cx = P.l + slot * i + slot / 2;
      out += '<text x="' + cx + '" y="' + (H - 9) + '" text-anchor="middle" font-size="10" fill="' + MUTED + '">' + esc(l) + '</text>';
      o.series.forEach(function (s, si) {
        var v = s.values[i], col = s.colors ? s.colors[i] : (s.color || SERIES[si % SERIES.length]);
        var x = cx - (bw * groups) / 2 + si * bw, h = Math.max(2, ih - (Y(v) - P.t));
        out += '<rect x="' + (x + 1).toFixed(1) + '" y="' + Y(v).toFixed(1) + '" width="' + (bw - 2).toFixed(1) + '" height="' + h.toFixed(1) +
          '" rx="3" fill="' + col + '"><title>' + esc(s.name + ' — ' + l + ': ' + v) + '</title></rect>';
      });
    });
    if (o.target != null) {
      out += '<line x1="' + P.l + '" y1="' + Y(o.target) + '" x2="' + (W - P.r) + '" y2="' + Y(o.target) +
        '" stroke="var(--critical)" stroke-width="1.4" stroke-dasharray="5 4"/>' +
        '<text x="' + (W - P.r) + '" y="' + (Y(o.target) - 5) + '" text-anchor="end" font-size="10" fill="var(--critical)">' + esc(o.targetLabel || 'Target') + '</text>';
    }
    return out + '</svg>';
  };

  /* ---- Horizontal bars --------------------------------------------------- */
  /* Rendered as fluid HTML rather than a fixed-width SVG, so labels keep their
     size in narrow cards and on phones. */
  HS.charts.hbar = function (o) {
    var rows = o.rows, rowH = o.rowH || 30;
    var labelW = Math.min(o.labelW || 150, 180);
    var max = Math.max.apply(null, rows.map(function (r) { return r.value; })) || 1;
    var bh = Math.max(6, Math.min(14, rowH - 16));
    var out = '<div class="hbar" role="img" aria-label="' + esc(o.label || 'Horizontal bar chart') + '" style="--hbar-label:' + labelW + 'px;--hbar-row:' + rowH + 'px;--hbar-bar:' + bh + 'px">';
    rows.forEach(function (r, i) {
      var pct = Math.max(r.value > 0 ? 1.5 : 0, (r.value / max) * 100);
      var shown = r.display != null ? r.display : r.value;
      out += '<div class="hbar__row" title="' + esc(r.label + ': ' + shown) + '">' +
        '<span class="hbar__label">' + esc(r.label) + '</span>' +
        '<span class="hbar__track"><span class="hbar__fill" style="width:' + pct.toFixed(1) + '%;background:' + (r.color || SERIES[i % SERIES.length]) + '"></span></span>' +
        '<span class="hbar__val">' + esc(shown) + '</span></div>';
    });
    return out + '</div>';
  };

  /* ---- Stacked bars ------------------------------------------------------ */
  HS.charts.stacked = function (o) {
    var W = 680, H = o.height || 230, P = { t: 16, r: 14, b: 30, l: 42 };
    var iw = W - P.l - P.r, ih = H - P.t - P.b, n = o.labels.length;
    var totals = o.labels.map(function (_, i) {
      return o.series.reduce(function (a, s) { return a + s.values[i]; }, 0);
    });
    var max = o.yMax != null ? o.yMax : nice(Math.max.apply(null, totals) * 1.08);
    var slot = iw / n, bw = Math.min(o.maxBar || 40, slot * .62);
    var out = svgOpen(W, H, o.label || 'Stacked bar chart');
    for (var g = 0; g <= 4; g++) {
      var y = P.t + (g / 4) * ih;
      out += '<line x1="' + P.l + '" y1="' + y + '" x2="' + (W - P.r) + '" y2="' + y + '" stroke="' + GRID + '"/>';
      out += '<text x="' + (P.l - 8) + '" y="' + (y + 4) + '" text-anchor="end" font-size="10" fill="' + MUTED + '">' + HS.fmt.compact(max - (g / 4) * max) + '</text>';
    }
    o.labels.forEach(function (l, i) {
      var cx = P.l + slot * i + slot / 2, acc = 0;
      out += '<text x="' + cx + '" y="' + (H - 9) + '" text-anchor="middle" font-size="10" fill="' + MUTED + '">' + esc(l) + '</text>';
      o.series.forEach(function (s, si) {
        var v = s.values[i], h = (v / max) * ih;
        var y2 = P.t + ih - acc - h; acc += h;
        out += '<rect x="' + (cx - bw / 2) + '" y="' + y2.toFixed(1) + '" width="' + bw + '" height="' + Math.max(1, h).toFixed(1) +
          '" fill="' + (s.color || SERIES[si % SERIES.length]) + '"><title>' + esc(s.name + ' — ' + l + ': ' + v) + '</title></rect>';
      });
    });
    return out + '</svg>';
  };

  /* ---- Donut ------------------------------------------------------------- */
  HS.charts.donut = function (o) {
    var size = o.size || 180, r = size / 2, thick = o.thickness || 26, rr = r - thick / 2;
    var total = o.data.reduce(function (a, d) { return a + d.value; }, 0) || 1;
    var out = svgOpen(size, size, o.label || 'Donut chart', true);
    var a0 = -Math.PI / 2;
    o.data.forEach(function (d, i) {
      var frac = d.value / total, a1 = a0 + frac * Math.PI * 2;
      var large = frac > .5 ? 1 : 0;
      var x0 = r + rr * Math.cos(a0), y0 = r + rr * Math.sin(a0);
      var x1 = r + rr * Math.cos(a1), y1 = r + rr * Math.sin(a1);
      if (frac >= .9999) {
        out += '<circle cx="' + r + '" cy="' + r + '" r="' + rr + '" fill="none" stroke="' + (d.color || SERIES[i]) + '" stroke-width="' + thick + '"/>';
      } else {
        out += '<path d="M' + x0.toFixed(2) + ' ' + y0.toFixed(2) + ' A' + rr + ' ' + rr + ' 0 ' + large + ' 1 ' + x1.toFixed(2) + ' ' + y1.toFixed(2) +
          '" fill="none" stroke="' + (d.color || SERIES[i % SERIES.length]) + '" stroke-width="' + thick + '"><title>' +
          esc(d.label + ': ' + d.value + ' (' + Math.round(frac * 100) + '%)') + '</title></path>';
      }
      a0 = a1;
    });
    if (o.center) {
      out += '<text x="' + r + '" y="' + (r - 2) + '" text-anchor="middle" font-size="' + (o.centerSize || 22) + '" font-weight="600" fill="var(--text-strong)">' + esc(o.center) + '</text>';
      if (o.centerSub) out += '<text x="' + r + '" y="' + (r + 15) + '" text-anchor="middle" font-size="10" fill="' + MUTED + '">' + esc(o.centerSub) + '</text>';
    }
    return out + '</svg>';
  };

  /* ---- Gauge (semi-circle) ---------------------------------------------- */
  HS.charts.gauge = function (o) {
    var W = 200, H = 116, r = 78, cx = W / 2, cy = 98, thick = 16;
    var pct = Math.max(0, Math.min(100, o.percent));
    function pt(p) { var a = Math.PI + (p / 100) * Math.PI; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; }
    var s = pt(0), e = pt(100), c = pt(pct);
    var out = svgOpen(W, H, o.label || 'Gauge', true);
    out += '<path d="M' + s[0] + ' ' + s[1] + ' A' + r + ' ' + r + ' 0 0 1 ' + e[0] + ' ' + e[1] + '" fill="none" stroke="var(--bg-sunken)" stroke-width="' + thick + '" stroke-linecap="round"/>';
    out += '<path d="M' + s[0] + ' ' + s[1] + ' A' + r + ' ' + r + ' 0 ' + (pct > 50 ? 1 : 0) + ' 1 ' + c[0].toFixed(2) + ' ' + c[1].toFixed(2) +
      '" fill="none" stroke="' + (o.color || 'var(--teal)') + '" stroke-width="' + thick + '" stroke-linecap="round"/>';
    out += '<text x="' + cx + '" y="' + (cy - 12) + '" text-anchor="middle" font-size="26" font-weight="600" fill="var(--text-strong)">' + esc(o.value || pct + '%') + '</text>';
    if (o.sub) out += '<text x="' + cx + '" y="' + (cy + 8) + '" text-anchor="middle" font-size="10" fill="' + MUTED + '">' + esc(o.sub) + '</text>';
    return out + '</svg>';
  };

  /* ---- Sparkline --------------------------------------------------------- */
  HS.charts.spark = function (values, o) {
    o = o || {};
    var W = o.width || 74, H = o.height || 26, pad = 2;
    var max = Math.max.apply(null, values), min = Math.min.apply(null, values);
    var rng = (max - min) || 1;
    var pts = values.map(function (v, i) {
      return [pad + (i / (values.length - 1)) * (W - pad * 2), H - pad - ((v - min) / rng) * (H - pad * 2)];
    });
    var col = o.color || 'var(--teal)';
    var out = '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" aria-hidden="true">';
    if (o.fill !== false) out += '<path d="' + path(pts, true, H) + '" fill="' + col + '" opacity=".12"/>';
    out += '<path d="' + path(pts) + '" fill="none" stroke="' + col + '" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>';
    out += '<circle cx="' + pts[pts.length - 1][0].toFixed(1) + '" cy="' + pts[pts.length - 1][1].toFixed(1) + '" r="2.2" fill="' + col + '"/>';
    return out + '</svg>';
  };

  /* ---- Progress ring ----------------------------------------------------- */
  HS.charts.ring = function (pct, o) {
    o = o || {};
    var size = o.size || 52, sw = o.stroke || 5, r = (size - sw) / 2, c = 2 * Math.PI * r;
    var col = o.color || 'var(--teal)';
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '" aria-label="' + pct + ' percent">' +
      '<circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke="var(--bg-sunken)" stroke-width="' + sw + '"/>' +
      '<circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke="' + col + '" stroke-width="' + sw +
      '" stroke-linecap="round" stroke-dasharray="' + c.toFixed(1) + '" stroke-dashoffset="' + (c * (1 - pct / 100)).toFixed(1) +
      '" transform="rotate(-90 ' + size / 2 + ' ' + size / 2 + ')"/>' +
      (o.label !== false ? '<text x="50%" y="50%" text-anchor="middle" dy="3.5" font-size="' + (o.fontSize || 12) + '" font-weight="600" fill="var(--text-strong)">' + (o.text || pct + '%') + '</text>' : '') +
      '</svg>';
  };

  /* ---- Radar (skills) ---------------------------------------------------- */
  HS.charts.radar = function (o) {
    var size = o.size || 240, c = size / 2, r = c - 34, n = o.axes.length;
    var out = svgOpen(size, size, o.label || 'Radar chart', true);
    function pt(i, v) {
      var a = -Math.PI / 2 + (i / n) * Math.PI * 2;
      return [c + r * (v / 100) * Math.cos(a), c + r * (v / 100) * Math.sin(a)];
    }
    [25, 50, 75, 100].forEach(function (lv) {
      var p = o.axes.map(function (_, i) { return pt(i, lv); });
      out += '<polygon points="' + p.map(function (q) { return q[0].toFixed(1) + ',' + q[1].toFixed(1); }).join(' ') + '" fill="none" stroke="' + GRID + '"/>';
    });
    o.axes.forEach(function (ax, i) {
      var e = pt(i, 100);
      out += '<line x1="' + c + '" y1="' + c + '" x2="' + e[0].toFixed(1) + '" y2="' + e[1].toFixed(1) + '" stroke="' + GRID + '"/>';
      var l = pt(i, 122);
      out += '<text x="' + l[0].toFixed(1) + '" y="' + l[1].toFixed(1) + '" text-anchor="middle" dy="3" font-size="10" fill="' + MUTED + '">' + esc(ax) + '</text>';
    });
    (o.series || []).forEach(function (s, si) {
      var col = s.color || SERIES[si % SERIES.length];
      var p = s.values.map(function (v, i) { return pt(i, v); });
      out += '<polygon points="' + p.map(function (q) { return q[0].toFixed(1) + ',' + q[1].toFixed(1); }).join(' ') +
        '" fill="' + col + '" fill-opacity=".14" stroke="' + col + '" stroke-width="2" stroke-linejoin="round"/>';
      p.forEach(function (q, i) {
        out += '<circle cx="' + q[0].toFixed(1) + '" cy="' + q[1].toFixed(1) + '" r="2.8" fill="' + col + '"><title>' + esc(o.axes[i] + ': ' + s.values[i]) + '</title></circle>';
      });
    });
    return out + '</svg>';
  };

  /* ---- Legend helper ----------------------------------------------------- */
  HS.charts.legend = function (items) {
    return '<div class="legend">' + items.map(function (it, i) {
      return '<span class="legend__item"><span class="legend__swatch" style="background:' + (it.color || SERIES[i % SERIES.length]) + '"></span>' + esc(it.label) + '</span>';
    }).join('') + '</div>';
  };

  HS.charts.SERIES = SERIES;
})(HS);

export const charts: any = HS.charts;
