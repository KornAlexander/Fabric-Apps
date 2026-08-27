/*
 * IBCS chart glyph renderer — shared by the swipe & escape-room mini-games.
 *
 * Usage:
 *   const charts = IBCSCharts(ctx);
 *   charts.glyph('clutter', x, y, w, h);              // procedural chart picture
 *   charts.glyph('clean', x, y, w, h, 'SI 1.1', 'do'); // per-rule bitmap if present
 *
 * The `kind` strings match the `enemyKind` ("Don't" chart) and `good` ("Do"
 * chart) fields on every rule in window.IBCS.RULES, so the same registry drives
 * every game. Unknown kinds fall back to plain mono columns.
 *
 * When a rule `code` and `side` ('do' | 'dont') are also supplied, the renderer
 * lazily loads and caches the per-rule bitmap (see docs/IBCS-Rule-Image-Mapping.md)
 * and draws it scaled into the target rectangle. Until that image exists (or has
 * finished loading) it falls back to the procedural `glyph(kind, …)` art, so call
 * sites keep working and the image bank can be filled in incrementally.
 */
(function (global) {
  'use strict';

  // Decorative display font for the "avoid decorative fonts" glyph (fontFancy).
  // Embedded (no CDN) so it renders offline and cross-origin. Font: "Lobster"
  // by Pablo Impallari - SIL Open Font License 1.1 (github.com/google/fonts,
  // ofl/lobster). Registered once as 'IBCSFancy'; canvas text falls back to a
  // system script / generic cursive until the web font finishes loading.
  (function injectFancyFont(){
    if (typeof document === 'undefined' || !document.head) return; // no DOM (Node)
    if (document.getElementById('ibcs-fancy-font')) return;
    var b64 = "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";
    var st = document.createElement('style');
    st.id = 'ibcs-fancy-font';
    st.textContent = "@font-face{font-family:'IBCSFancy';font-style:normal;font-weight:400;font-display:swap;src:url(data:font/woff2;base64," + b64 + ") format('woff2')}";
    document.head.appendChild(st);
    try { if (document.fonts && document.fonts.load) document.fonts.load("16px 'IBCSFancy'"); } catch (e) {}
  })();


  // Per-rule image bank, shared across every IBCSCharts() instance. Keyed by the
  // resolved path so each picture is requested from the network only once.
  const imgBank = Object.create(null);
  function ruleImage(code, side) {
    if (!code || !side || typeof Image === 'undefined') return null;
    const IBCS = global.IBCS;
    if (!IBCS || typeof IBCS.imagePath !== 'function') return null;
    const path = IBCS.imagePath(code, side);
    let rec = imgBank[path];
    if (!rec) {
      rec = { img: new Image(), ready: false, failed: false };
      rec.img.onload = function () { rec.ready = rec.img.naturalWidth > 0; };
      rec.img.onerror = function () { rec.failed = true; };
      rec.img.src = path;
      imgBank[path] = rec;
    }
    return rec.ready ? rec.img : null;
  }

  function IBCSCharts(ctx) {
    // Draw a loaded bitmap centred and aspect-fit inside (x, y, w, h).
    function drawImageFit(img, x, y, w, h) {
      const iw = img.naturalWidth, ih = img.naturalHeight;
      if (!iw || !ih) return false;
      const s = Math.min(w / iw, h / ih);
      const dw = iw * s, dh = ih * s;
      ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
      return true;
    }
    // ----- low-level primitives (ctx-bound) -----
    function fRect(x, y, w, h, c) { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); }
    function dLine(x1, y1, x2, y2, c, lw) {
      ctx.strokeStyle = c; ctx.lineWidth = lw || 1;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }
    function fPoly(pts, c) {
      ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.closePath(); ctx.fill();
    }
    function sCir(cx, cy, r, c, lw) {
      ctx.strokeStyle = c; ctx.lineWidth = lw || 1;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    }
    function fCir(cx, cy, r, c) {
      ctx.fillStyle = c; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    }
    function dText(t, size, x, y, c, center, bold) {
      ctx.fillStyle = c;
      ctx.font = (bold ? 'bold ' : '') + size + "px 'Segoe UI',system-ui,sans-serif";
      ctx.textAlign = center ? 'center' : 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(t, x, y);
      ctx.textAlign = 'left';
    }
    function pieSlices(cx, cy, r, cols, vals) {
      let a = -Math.PI / 2; const tot = vals.reduce((s, v) => s + v, 0);
      for (let i = 0; i < vals.length; i++) {
        const a2 = a + vals[i] / tot * Math.PI * 2;
        ctx.fillStyle = cols[i % cols.length];
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, r, a, a2); ctx.closePath(); ctx.fill();
        a = a2;
      }
    }
    function vBars(x, y, w, h, vals, draw) {
      const bw = (w - 2) / vals.length - 2;
      for (let i = 0; i < vals.length; i++) {
        const bx = x + i * (bw + 2), bh = Math.max(2, h * vals[i]), by = y + h - bh;
        draw(bx, by, Math.max(2, bw), bh, i);
      }
    }
    function hatchRect(bx, by, bw, bh, col) {
      ctx.save(); ctx.beginPath(); ctx.rect(bx, by, bw, bh); ctx.clip();
      ctx.strokeStyle = col; ctx.lineWidth = 1;
      for (let d = -bh; d < bw; d += 3) { ctx.beginPath(); ctx.moveTo(bx + d, by + bh); ctx.lineTo(bx + d + bh, by); ctx.stroke(); }
      ctx.restore();
    }

    // ----- the glyph dispatcher (ported from the platformer) -----
    // `code` + `side` ('do' | 'dont') are optional: when given and the matching
    // per-rule bitmap has loaded, it is drawn instead of the procedural art.
    function glyph(kind, x, y, w, h, code, side) {
      const img = ruleImage(code, side);
      if (img && drawImageFit(img, x, y, w, h)) return;
      const cx = x + w / 2, cy = y + h / 2;
      const vals = [0.5, 0.82, 0.42, 1.0, 0.66];
      const GREY='#4a5160',DK='#23272e',LT='#b8bec8',RED='#e23b3b',BLU='#3b6fe2',GRN='#37a76a',AMB='#e2a93b',PUR='#8e5bd0',AX='#9aa3b0',GD='#c0c8d0';
      switch (kind) {
        case 'pie': {
          const r = Math.min(w, h) / 2;
          pieSlices(cx, cy, r, ['#e23b3b', '#3b6fe2', '#37a76a', '#e2a93b', '#8e5bd0'], [3, 2, 2, 1.5, 1.5]);
          sCir(cx, cy, r, '#ffffff', 1); return;
        }
        case 'line': {
          dLine(x, y + h, x + w, y + h, '#9aa3b0', 1.2); dLine(x, y, x, y + h, '#9aa3b0', 1.2);
          const pts = [[x, y + h * 0.7], [x + w * 0.25, y + h * 0.4], [x + w * 0.5, y + h * 0.55], [x + w * 0.75, y + h * 0.18], [x + w, y + h * 0.32]];
          ctx.strokeStyle = '#2b6fe2'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
          for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]); ctx.stroke(); return;
        }
        case 'bar': {
          dLine(x, y, x, y + h, '#9aa3b0', 1.2); // value axis on the left
          const hv = [0.95, 0.75, 0.58, 0.42, 0.28];
          const gap = 2, bh = (h - gap * (hv.length - 1)) / hv.length;
          for (let i = 0; i < hv.length; i++) { const by = y + i * (bh + gap); fRect(x, by, Math.max(2, w * hv[i]), Math.max(2, bh), '#4a5160'); }
          return;
        }
        case 'barSolid':
          vBars(x, y, w, h, vals, (bx, by, bw, bh) => fRect(bx, by, bw, bh, '#4a5160')); return;
        case 'barOutline':
          vBars(x, y, w, h, vals, (bx, by, bw, bh) => { fRect(bx, by, bw, bh, '#fdfdfd'); ctx.strokeStyle = '#4a5160'; ctx.lineWidth = 1.3; ctx.strokeRect(bx, by, bw, bh); }); return;
        case 'barHatched':
          vBars(x, y, w, h, vals, (bx, by, bw, bh) => { fRect(bx, by, bw, bh, '#eef1f5'); ctx.strokeStyle = '#4a5160'; ctx.lineWidth = 1.1; ctx.strokeRect(bx, by, bw, bh); hatchRect(bx, by, bw, bh, '#4a5160'); }); return;
        case 'barLight':
          vBars(x, y, w, h, vals, (bx, by, bw, bh) => fRect(bx, by, bw, bh, '#b8bec8')); return;
        case 'barDark':
          vBars(x, y, w, h, vals, (bx, by, bw, bh) => fRect(bx, by, bw, bh, '#23272e')); return;
        case 'bigNumber': {
          // "Avoid long numbers": show the overly long, fully-written figure
          // (it rounds to the DO's "1.2M"). Auto-fit to width; never spills.
          ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          const num = '1,234,567';
          let bfs = Math.min(h * 0.5, 22);
          ctx.font = 'bold ' + bfs + "px 'Segoe UI',system-ui,sans-serif";
          const mw = ctx.measureText(num).width;
          if (mw > w * 0.92) { bfs = bfs * w * 0.92 / mw; ctx.font = 'bold ' + bfs + "px 'Segoe UI',system-ui,sans-serif"; }
          ctx.fillStyle = '#3a3f4a'; ctx.fillText(num, cx, cy);
          ctx.restore(); return;
        }
        case 'deviation': {
          const dv = [0.6, -0.35, 0.45, -0.7, 0.3];
          dLine(x, cy, x + w, cy, '#9aa3b0', 1);
          const bw = (w - 2) / dv.length - 2;
          for (let i = 0; i < dv.length; i++) {
            const bx = x + i * (bw + 2), bh = Math.abs(dv[i]) * (h / 2);
            const by = dv[i] >= 0 ? cy - bh : cy; fRect(bx, by, Math.max(2, bw), Math.max(1, bh), dv[i] >= 0 ? '#37a76a' : '#e23b3b');
          }
          return;
        }
        case 'meceGood': {
          const segs = [0.3, 0.25, 0.25, 0.2]; const cols = ['#4a5160', '#6b7280', '#868d9b', '#a8aeb8'];
          const bwc = w * 0.5, bx = cx - bwc / 2; let yy = y + h;
          for (let i = 0; i < segs.length; i++) { const sh = h * segs[i]; yy -= sh; fRect(bx, yy, bwc, sh, cols[i]); }
          ctx.strokeStyle = '#2b2f38'; ctx.lineWidth = 1; ctx.strokeRect(bx, y, bwc, h); return;
        }
        case 'meceBad': {
          const bwc = w * 0.5, bx = cx - bwc / 2;
          ctx.save(); ctx.globalAlpha = 0.6;
          fRect(bx, y + h * 0.08, bwc, h * 0.42, '#e23b3b');
          fRect(bx, y + h * 0.34, bwc, h * 0.42, '#3b6fe2');
          fRect(bx, y + h * 0.82, bwc, h * 0.22, '#e2a93b');
          ctx.restore(); return;
        }
        case 'clutter': {
          fRect(x, y, w, h, '#e8edf2');
          for (let gy = y; gy <= y + h; gy += Math.max(3, h / 4)) dLine(x, gy, x + w, gy, '#c0c8d0', 0.5);
          const pal = ['#e23b3b', '#3b6fe2', '#37a76a', '#e2a93b', '#8e5bd0'];
          const bw = (w - 2) / vals.length - 2;
          for (let i = 0; i < vals.length; i++) {
            const bx = x + i * (bw + 2), bh = h * vals[i], by = y + h - bh;
            fRect(bx, by, Math.max(2, bw), bh, pal[i]);
            fPoly([[bx + bw, by], [bx + bw + 2, by - 2], [bx + bw + 2, y + h - 2], [bx + bw, y + h]], 'rgba(0,0,0,0.22)');
          }
          ctx.strokeStyle = '#9aa3b0'; ctx.lineWidth = 1; ctx.strokeRect(x, y, w, h); return;
        }
        case 'clean': {
          dLine(x, y + h, x + w, y + h, '#c0c8d0', 1);
          vBars(x, y, w, h, vals, (bx, by, bw, bh) => fRect(bx, by, bw, bh, '#4a5160')); return;
        }
        case 'axisBreak': {
          const brk = y + h - 4; const bw = (w - 2) / vals.length - 2;
          for (let i = 0; i < vals.length; i++) { const bh = h * vals[i] * 0.7; fRect(x + i * (bw + 2), brk - bh, Math.max(2, bw), Math.max(2, bh), '#4a5160'); }
          ctx.strokeStyle = '#e23b3b'; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.moveTo(x, brk); ctx.lineTo(x + 3, brk - 2); ctx.lineTo(x + 6, brk + 2); ctx.lineTo(x + 9, brk - 2); ctx.lineTo(x + w, brk); ctx.stroke(); return;
        }
        case 'axisFull': {
          dLine(x, y + h, x + w, y + h, '#9aa3b0', 1); dLine(x, y, x, y + h, '#9aa3b0', 1);
          vBars(x, y, w, h, vals, (bx, by, bw, bh) => fRect(bx, by, bw, bh, '#37a76a')); return;
        }
        case 'column': {
          dLine(x, y + h, x + w, y + h, '#9aa3b0', 1.2);
          vBars(x, y, w, h, vals, (bx, by, bw, bh) => fRect(bx, by, bw, bh, '#4a5160')); return;
        }
        case 'gauge': {
          const r = Math.min(w, h * 1.7) / 2, gx = cx, gy = y + h * 0.92;
          ctx.lineWidth = Math.max(2.5, h * 0.2); ctx.lineCap = 'butt';
          const seg = [['#37a76a', Math.PI, Math.PI * 1.34], ['#e2a93b', Math.PI * 1.34, Math.PI * 1.67], ['#e23b3b', Math.PI * 1.67, Math.PI * 2]];
          for (const s of seg) { ctx.strokeStyle = s[0]; ctx.beginPath(); ctx.arc(gx, gy, r, s[1], s[2]); ctx.stroke(); }
          const na = Math.PI * 1.72; ctx.strokeStyle = '#23272e'; ctx.lineWidth = Math.max(1.6, h * 0.09); ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(gx + Math.cos(na) * r * 0.92, gy + Math.sin(na) * r * 0.92); ctx.stroke();
          ctx.fillStyle = '#23272e'; ctx.beginPath(); ctx.arc(gx, gy, Math.max(1.6, h * 0.09), 0, Math.PI * 2); ctx.fill(); return;
        }
        case 'radar': {
          const r = Math.min(w, h) / 2 * 0.94, n = 5;
          const pt = (rad, k) => [cx + Math.cos(-Math.PI / 2 + k * 2 * Math.PI / n) * rad, cy + Math.sin(-Math.PI / 2 + k * 2 * Math.PI / n) * rad];
          ctx.strokeStyle = '#c0c8d0'; ctx.lineWidth = 0.8;
          for (let ring = 1; ring <= 2; ring++) { ctx.beginPath(); for (let k = 0; k < n; k++) { const p = pt(r * ring / 2, k); k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); } ctx.closePath(); ctx.stroke(); }
          for (let k = 0; k < n; k++) { const p = pt(r, k); dLine(cx, cy, p[0], p[1], '#c0c8d0', 0.8); }
          const dv = [0.95, 0.5, 0.85, 0.4, 0.7];
          ctx.fillStyle = 'rgba(59,111,226,0.5)'; ctx.strokeStyle = '#2b6fe2'; ctx.lineWidth = 1.5;
          ctx.beginPath(); for (let k = 0; k < n; k++) { const p = pt(r * dv[k], k); k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); } ctx.closePath(); ctx.fill(); ctx.stroke(); return;
        }
        case 'funnel': {
          const cols = ['#3b6fe2', '#37a76a', '#e2a93b', '#e23b3b'], n = cols.length, gap = 1, segH = (h - gap * (n - 1)) / n;
          for (let i = 0; i < n; i++) { const wTop = w * (1 - i * 0.22), wBot = w * (1 - (i + 1) * 0.22), yt = y + i * (segH + gap);
            fPoly([[cx - wTop / 2, yt], [cx + wTop / 2, yt], [cx + wBot / 2, yt + segH], [cx - wBot / 2, yt + segH]], cols[i]); }
          return;
        }
        case 'ring': {
          const r = Math.min(w, h) / 2;
          pieSlices(cx, cy, r, ['#e23b3b', '#3b6fe2', '#37a76a', '#e2a93b', '#8e5bd0'], [3, 2, 2, 1.5, 1.5]);
          ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(cx, cy, r * 0.5, 0, Math.PI * 2); ctx.fill();
          sCir(cx, cy, r, '#ffffff', 1); return;
        }
        case 'traffic': {
          const r = Math.min(w / 2, h / 6) * 0.92;
          fRect(cx - r - 2, y, (r + 2) * 2, h, '#2b2f38');
          const cols = ['#e23b3b', '#e2a93b', '#37a76a'];
          for (let i = 0; i < 3; i++) { const cyl = y + h * (i + 0.5) / 3; ctx.fillStyle = cols[i]; ctx.beginPath(); ctx.arc(cx, cyl, r, 0, Math.PI * 2); ctx.fill(); }
          return;
        }
        case 'spaghetti': {
          dLine(x, y + h, x + w, y + h, '#c0c8d0', 1);
          const pal = ['#e23b3b', '#3b6fe2', '#37a76a', '#e2a93b', '#8e5bd0'];
          for (let s = 0; s < pal.length; s++) { ctx.strokeStyle = pal[s]; ctx.lineWidth = 1.4; ctx.beginPath();
            for (let i = 0; i <= 4; i++) { const px = x + w * i / 4, py = y + h * (0.2 + 0.6 * Math.abs(Math.sin(i * 1.7 + s * 1.3))); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); } ctx.stroke(); }
          return;
        }
        case 'smallMultiples': {
          const gx = 2, gy = 2, cw = (w - gx) / 2, chh = (h - gy) / 2;
          const sets = [[0.5, 0.8, 0.6], [0.7, 0.4, 0.9], [0.6, 0.9, 0.5], [0.4, 0.7, 0.85]];
          for (let q = 0; q < 4; q++) { const ox2 = x + (q % 2) * (cw + gx), oy2 = y + Math.floor(q / 2) * (chh + gy);
            dLine(ox2, oy2 + chh, ox2 + cw, oy2 + chh, '#c0c8d0', 0.6);
            vBars(ox2, oy2, cw, chh, sets[q], (bx, by, bw, bh) => fRect(bx, by, bw, bh, '#4a5160')); }
          return;
        }

        // ======= EXTENDED PER-RULE ICONS (one bold, legible glyph per rule) =======
        // -- SIMPLIFY --
        case 'bgFancy': { const g=ctx.createLinearGradient(x,y,x+w,y+h); g.addColorStop(0,'#ffe7a8'); g.addColorStop(1,'#a9ccff'); ctx.fillStyle=g; ctx.fillRect(x,y,w,h); ctx.strokeStyle=PUR; ctx.lineWidth=1.5; ctx.strokeRect(x+0.8,y+0.8,w-1.6,h-1.6); vBars(x+1,y,w-2,h,vals,(bx,by,bw,bh)=>fRect(bx,by,bw,bh,DK)); return; }
        case 'motion': { dLine(x,y+h,x+w,y+h,GD,1); vBars(x,y,w*0.5,h,[0.5,0.82,0.6],(bx,by,bw,bh)=>fRect(bx,by,bw,bh,GREY)); ctx.strokeStyle=AMB; ctx.lineWidth=1.6; for(let i=0;i<3;i++){const yy=y+h*(0.3+i*0.22); ctx.beginPath(); ctx.moveTo(x+w*0.52,yy); ctx.lineTo(x+w*0.85,yy); ctx.stroke(); fPoly([[x+w*0.85,yy-3],[x+w,yy],[x+w*0.85,yy+3]],AMB);} return; }
        case 'bars3d': { dLine(x,y+h,x+w,y+h,AX,1); const d=Math.max(2,w*0.07); vBars(x,y+d,w-d,h-d,vals,(bx,by,bw,bh)=>{ fPoly([[bx+bw,by],[bx+bw+d,by-d],[bx+bw+d,by+bh-d],[bx+bw,by+bh]],'#2b3038'); fPoly([[bx,by],[bx+d,by-d],[bx+bw+d,by-d],[bx+bw,by]],'#626c7b'); fRect(bx,by,bw,bh,GREY); }); return; }
        case 'fontFancy': { ctx.save(); ctx.fillStyle=PUR; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.font=Math.min(h*1.3,24)+"px 'IBCSFancy','Lobster','Brush Script MT','Segoe Script','Snell Roundhand',cursive"; ctx.fillText('Aa',cx,cy-h*0.02); ctx.restore(); ctx.strokeStyle=RED; ctx.lineWidth=1.3; ctx.beginPath(); for(let i=0;i<=w-2;i+=2){const xx=x+1+i,yy=y+h*0.86+Math.sin(i*0.8)*1.8; i?ctx.lineTo(xx,yy):ctx.moveTo(xx,yy);} ctx.stroke(); return; }
        case 'fontPlain': { dText('Aa',Math.min(h,16),cx,cy,'#3a3f4a',true,true); return; }
        case 'gridlines': { fRect(x,y,w,h,'#fff'); for(let i=1;i<5;i++){dLine(x,y+h*i/5,x+w,y+h*i/5,'#aeb7c2',0.8); dLine(x+w*i/5,y,x+w*i/5,y+h,'#aeb7c2',0.8);} vBars(x,y,w,h,vals,(bx,by,bw,bh)=>fRect(bx,by,bw,bh,GREY)); ctx.strokeStyle=AX; ctx.lineWidth=1; ctx.strokeRect(x,y,w,h); return; }
        case 'dataLabels': { dLine(x,y+h,x+w,y+h,GD,1); const lp=h*0.26, lfs=Math.max(4,Math.min(lp*0.82,(w/vals.length)*0.62,9)); vBars(x,y+lp,w,h-lp,vals,(bx,by,bw,bh,i)=>{fRect(bx,by,bw,bh,GREY); dText(String(Math.round(vals[i]*100)),lfs,bx+bw/2,by-lfs*0.72,DK,true,true);}); return; }
        case 'tableGrid': { fRect(x,y,w,h,'#fff'); for(let c=1;c<3;c++)dLine(x+w*c/3,y,x+w*c/3,y+h,AX,1); for(let r=0;r<4;r++){const ry=y+h*(r+0.5)/4; for(let c=0;c<3;c++)fRect(x+w*c/3+2+(r%2)*3,ry-1.3,w/3*0.5,2.6,'#5b6573');} ctx.strokeStyle=AX; ctx.lineWidth=1; ctx.strokeRect(x,y,w,h); return; }
        case 'tableClean': { fRect(x,y,w,h,'#fff'); for(let r=0;r<4;r++){const ry=y+h*(r+0.5)/4; for(let c=0;c<3;c++){const rr=x+w*(c+1)/3-2; fRect(rr-w/3*0.5,ry-1.3,w/3*0.5,2.6,'#5b6573');}} dLine(x,y+h-0.5,x+w,y+h-0.5,GD,1); return; }
        case 'textLong': { ctx.save(); ctx.beginPath(); ctx.rect(x,y,w,h); ctx.clip(); const fl=Math.max(4.5,Math.min(h*0.2,w*0.12,9)); ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillStyle='#5b6573'; ctx.font=fl+"px 'Segoe UI',system-ui,sans-serif"; const L=['The total net','sales revenue','in the period']; for(let i=0;i<3;i++)ctx.fillText(L[i],x+w/2,y+h*(0.24+i*0.26)); ctx.restore(); return; }
        case 'textShort': { ctx.save(); ctx.beginPath(); ctx.rect(x,y,w,h); ctx.clip(); const fsh=Math.max(6,Math.min(h*0.36,w*0.2,15)); ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillStyle='#3a3f4a'; ctx.font='600 '+fsh+"px 'Segoe UI',system-ui,sans-serif"; ctx.fillText('Net sales',x+w/2,y+h*0.5); ctx.restore(); return; }
        case 'textObvious': { ctx.save(); ctx.beginPath(); ctx.rect(x,y,w,h); ctx.clip(); const fo=Math.max(5,Math.min(h*0.3,w*0.15,12)); ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.font='600 '+fo+"px 'Segoe UI',system-ui,sans-serif"; ctx.fillStyle='#3a3f4a'; ctx.fillText('Sales',x+w/2,y+h*0.32); ctx.font=fo+"px 'Segoe UI',system-ui,sans-serif"; ctx.fillStyle='#8a93a0'; const ob='in EUR (\u20ac)'; const oy=y+h*0.66; ctx.fillText(ob,x+w/2,oy); const ow=ctx.measureText(ob).width; ctx.strokeStyle=RED; ctx.lineWidth=Math.max(1,fo*0.13); ctx.beginPath(); ctx.moveTo(x+w/2-ow/2-1,oy); ctx.lineTo(x+w/2+ow/2+1,oy); ctx.stroke(); ctx.restore(); return; }
        case 'textDup': { ctx.save(); ctx.beginPath(); ctx.rect(x,y,w,h); ctx.clip(); const fd=Math.max(5,Math.min(h*0.24,w*0.14,11)); ctx.textBaseline='middle'; ctx.textAlign='left'; ctx.font=fd+"px 'Segoe UI',system-ui,sans-serif"; const mo=['Jan ','Feb ','Mar ']; const pw=Math.max(ctx.measureText('Jan ').width,ctx.measureText('Feb ').width,ctx.measureText('Mar ').width); const bw=pw+ctx.measureText('Sales').width; const lx=x+(w-bw)/2; for(let i=0;i<3;i++){const ly=y+h*(0.24+i*0.26); ctx.fillStyle='#5b6573'; ctx.fillText(mo[i],lx,ly); ctx.fillStyle=RED; ctx.fillText('Sales',lx+pw,ly);} ctx.restore(); return; }
        case 'textOnce': { ctx.save(); ctx.beginPath(); ctx.rect(x,y,w,h); ctx.clip(); const foh=Math.max(6,Math.min(h*0.3,w*0.17,13)); ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.font='600 '+foh+"px 'Segoe UI',system-ui,sans-serif"; ctx.fillStyle='#3a3f4a'; ctx.fillText('Sales',x+w/2,y+h*0.3); const fm=Math.max(4.5,foh*0.72); ctx.font=fm+"px 'Segoe UI',system-ui,sans-serif"; ctx.fillStyle='#8a93a0'; ctx.fillText('Jan  Feb  Mar',x+w/2,y+h*0.68); ctx.restore(); return; }
        case 'labelAll': { dLine(x,y+h,x+w,y+h,GD,1); const lv=[1.0,0.09,0.72,0.06,0.48],lb=[100,9,72,6,48]; const lp=h*0.2,lfs=Math.max(4,Math.min(lp*0.85,(w/lv.length)*0.62,8)); vBars(x,y+lp,w,h-lp,lv,(bx,by,bw,bh,i)=>{fRect(bx,by,bw,bh,GREY); dText(String(lb[i]),lfs,bx+bw/2,by-lfs*0.72,DK,true,true);}); return; }
        case 'labelKey': { dLine(x,y+h,x+w,y+h,GD,1); const lv=[1.0,0.09,0.72,0.06,0.48],lb=[100,9,72,6,48]; const lp=h*0.2,lfs=Math.max(4,Math.min(lp*0.85,(w/lv.length)*0.62,8)); vBars(x,y+lp,w,h-lp,lv,(bx,by,bw,bh,i)=>{const k=lv[i]>=0.15; fRect(bx,by,bw,bh,k?GREY:'#c2c8d1'); if(k)dText(String(lb[i]),lfs,bx+bw/2,by-lfs*0.72,DK,true,true);}); return; }
        case 'roundNumber': { dText('1.2M',Math.min(h*0.8,13),cx,cy,GRN,true,true); return; }
        case 'overLabel': { dLine(x,y+h,x+w,y+h,GD,1); const ov=[0.34,0.5,0.63,0.78,1.0,0.81,0.6,0.43,0.31],ol=[34,50,63,78,100,81,60,43,31]; const op=h*0.2,ofs=Math.max(3.5,Math.min(op*0.82,(w/ov.length)*0.72,7)); vBars(x,y+op,w,h-op,ov,(bx,by,bw,bh,i)=>{fRect(bx,by,bw,bh,GREY); dText(String(ol[i]),ofs,bx+bw/2,by-ofs*0.7,DK,true,true);}); return; }
        case 'labelFew': { dLine(x,y+h,x+w,y+h,GD,1); const ov=[0.34,0.5,0.63,0.78,1.0,0.81,0.6,0.43,0.31],ol=[34,50,63,78,100,81,60,43,31]; const op=h*0.2,ofs=Math.max(4,Math.min(op*0.95,(w/ov.length)*1.1,11)); vBars(x,y+op,w,h-op,ov,(bx,by,bw,bh,i)=>{const key=(i===4); fRect(bx,by,bw,bh,key?GREY:'#aeb7c2'); if(key)dText(String(ol[i]),ofs,bx+bw/2,by-ofs*0.7,DK,true,true);}); return; }

        // -- UNIFY --
        case 'mixTerms': { fRect(x,y+h*0.18,w*0.46,h*0.22,BLU); fRect(x+w*0.54,y+h*0.18,w*0.4,h*0.22,RED); fRect(x,y+h*0.58,w*0.34,h*0.22,GRN); fRect(x+w*0.42,y+h*0.58,w*0.52,h*0.22,AMB); return; }
        case 'oneTerm': { for(let r=0;r<2;r++)for(let c=0;c<2;c++)fRect(x+c*w*0.5,y+h*0.22+r*h*0.34,w*0.42,h*0.2,'#5b6573'); return; }
        case 'mixUnits': { dText('\u20ac $ %',Math.min(h*0.66,11),cx,cy,RED,true,true); return; }
        case 'oneUnit': { dText('\u20ac \u20ac \u20ac',Math.min(h*0.66,11),cx,cy,'#3a3f4a',true,true); return; }
        case 'msgVaried': { fRect(x,y+h*0.08,w*0.9,h*0.22,AMB); ctx.strokeStyle=RED; ctx.lineWidth=1.2; ctx.strokeRect(x,y+h*0.4,w*0.6,h*0.2); fRect(x,y+h*0.72,w*0.75,h*0.2,BLU); return; }
        case 'msgUniform': { for(let i=0;i<3;i++)fRect(x,y+h*(0.1+i*0.32),w*0.85,h*0.2,AMB); return; }
        case 'titleVaried': { fRect(x,y,w*0.6,h*0.16,'#3a3f4a'); fRect(x+w*0.3,y+h*0.26,w*0.45,h*0.1,'#868d9b'); dLine(x,y+h*0.5,x+w,y+h*0.5,GD,1); vBars(x,y+h*0.5,w,h*0.5,[0.6,0.85,0.5,0.7],(bx,by,bw,bh)=>fRect(bx,by,bw,bh,GREY)); return; }
        case 'titleUniform': { fRect(x,y,w*0.6,h*0.16,'#3a3f4a'); fRect(x,y+h*0.24,w*0.4,h*0.1,'#868d9b'); dLine(x,y+h*0.5,x+w,y+h*0.5,GD,1); vBars(x,y+h*0.5,w,h*0.5,[0.6,0.85,0.5,0.7],(bx,by,bw,bh)=>fRect(bx,by,bw,bh,GREY)); return; }
        case 'legendMoved': { dLine(x,y+h,x+w,y+h,GD,1); vBars(x,y+2,w*0.7,h-2,[0.6,0.85,0.5],(bx,by,bw,bh)=>fRect(bx,by,bw,bh,GREY)); fRect(x+w*0.72,y,w*0.28,h*0.3,'#fff'); ctx.strokeStyle=AX; ctx.lineWidth=1; ctx.strokeRect(x+w*0.72,y,w*0.28,h*0.3); fPoly([[x+w*0.72,y+h*0.5],[x+w*0.6,y+h*0.62],[x+w*0.72,y+h*0.74]],RED); return; }
        case 'legendFixed': { dLine(x,y+h*0.78,x+w,y+h*0.78,GD,1); vBars(x,y+2,w,h*0.74,[0.6,0.85,0.5,0.7],(bx,by,bw,bh)=>fRect(bx,by,bw,bh,GREY)); fCir(x+3,y+h*0.9,2,GREY); fRect(x+7,y+h*0.86,w*0.3,h*0.08,'#868d9b'); return; }
        case 'mixedViz': { const r=Math.min(w,h)/2*0.4; pieSlices(x+w*0.18,cy,r,[RED,BLU,GRN],[2,1,1]); vBars(x+w*0.4,y+h*0.2,w*0.28,h*0.7,[0.6,0.9,0.5],(bx,by,bw,bh)=>fRect(bx,by,bw,bh,GREY)); ctx.strokeStyle=AMB; ctx.lineWidth=1.6; ctx.beginPath(); ctx.moveTo(x+w*0.72,y+h*0.7); ctx.lineTo(x+w*0.82,y+h*0.3); ctx.lineTo(x+w*0.95,y+h*0.55); ctx.stroke(); return; }
        case 'sameViz': { for(let q=0;q<3;q++){const ox2=x+q*w/3; vBars(ox2+1,y+h*0.2,w/3-3,h*0.7,[0.6,0.9,0.5],(bx,by,bw,bh)=>fRect(bx,by,bw,bh,GREY));} dLine(x,y+h*0.9,x+w,y+h*0.9,GD,0.8); return; }
        case 'mixedFills': { vBars(x,y,w,h,vals,(bx,by,bw,bh,i)=>{ if(i===0)fRect(bx,by,bw,bh,GREY); else if(i===1)fRect(bx,by,bw,bh,LT); else if(i===2){fRect(bx,by,bw,bh,'#eef1f5'); ctx.strokeStyle=GREY; ctx.lineWidth=1; ctx.strokeRect(bx,by,bw,bh); hatchRect(bx,by,bw,bh,GREY);} else {fRect(bx,by,bw,bh,'#fff'); ctx.strokeStyle=GREY; ctx.lineWidth=1.2; ctx.strokeRect(bx,by,bw,bh);} }); return; }
        case 'scenarioStd': { dLine(x,y+h,x+w,y+h,AX,1); const m=['solid','light','outline','hatch']; vBars(x,y,w,h,[0.7,0.55,0.85,0.6],(bx,by,bw,bh,i)=>{ if(m[i]==='solid')fRect(bx,by,bw,bh,GREY); else if(m[i]==='light')fRect(bx,by,bw,bh,LT); else if(m[i]==='outline'){fRect(bx,by,bw,bh,'#fff'); ctx.strokeStyle=GREY; ctx.lineWidth=1.2; ctx.strokeRect(bx,by,bw,bh);} else {fRect(bx,by,bw,bh,'#eef1f5'); ctx.strokeStyle=GREY; ctx.lineWidth=1; ctx.strokeRect(bx,by,bw,bh); hatchRect(bx,by,bw,bh,GREY);} }); return; }
        case 'timeVert': { dLine(x,y,x,y+h,AX,1); const hv=[0.5,0.75,0.6,0.9]; const bh=(h-2)/hv.length-2; for(let i=0;i<hv.length;i++)fRect(x,y+i*(bh+2),Math.max(2,w*hv[i]),Math.max(2,bh),GREY); ctx.strokeStyle=RED; ctx.lineWidth=1.4; ctx.beginPath(); ctx.moveTo(x+w*0.9,y+2); ctx.lineTo(x+w*0.9,y+h-2); ctx.stroke(); fPoly([[x+w*0.9-2.5,y+h-2],[x+w*0.9+2.5,y+h-2],[x+w*0.9,y+h+1]],RED); return; }
        case 'structHoriz': { dLine(x,y+h,x+w,y+h,AX,1); vBars(x,y,w,h,[0.8,0.6,0.9,0.5],(bx,by,bw,bh)=>fRect(bx,by,bw,bh,GREY)); ctx.strokeStyle=PUR; ctx.lineWidth=1.4; ctx.beginPath(); ctx.moveTo(x,y+h+2); ctx.lineTo(x,y+h+4); ctx.lineTo(x+w,y+h+4); ctx.lineTo(x+w,y+h+2); ctx.stroke(); return; }
        case 'varAdhoc': { dText('1.2M',Math.min(h*0.7,12),cx,cy-h*0.05,'#3a3f4a',true,true); ctx.strokeStyle=RED; ctx.lineWidth=1.3; for(let i=0;i<3;i++){const xx=x+w*(0.2+i*0.3); ctx.beginPath(); ctx.moveTo(xx,y+h*0.78); ctx.lineTo(xx+3,y+h*0.7); ctx.lineTo(xx+6,y+h*0.82); ctx.stroke();} return; }
        case 'tsStd': { dLine(x,y+h,x+w,y+h,AX,1); const pts=[[x,y+h*0.7],[x+w*0.3,y+h*0.45],[x+w*0.6,y+h*0.55],[x+w,y+h*0.25]]; ctx.strokeStyle=BLU; ctx.lineWidth=2; ctx.beginPath(); pts.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1])); ctx.stroke(); pts.forEach(p=>fCir(p[0],p[1],1.8,DK)); return; }
        case 'tsAdhoc': { dLine(x,y+h,x+w,y+h,AX,1); const pts=[[x,y+h*0.7],[x+w*0.3,y+h*0.45],[x+w*0.6,y+h*0.55],[x+w,y+h*0.25]]; ctx.strokeStyle=BLU; ctx.lineWidth=2; ctx.beginPath(); pts.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1])); ctx.stroke(); fRect(pts[1][0]-2,pts[1][1]-2,4,4,RED); fPoly([[pts[3][0],pts[3][1]-3],[pts[3][0]-3,pts[3][1]+2],[pts[3][0]+3,pts[3][1]+2]],AMB); return; }
        case 'highlightRandom': { dLine(x,y+h,x+w,y+h,GD,1); const c=[RED,GRN,AMB,BLU,PUR]; vBars(x,y,w,h,vals,(bx,by,bw,bh,i)=>fRect(bx,by,bw,bh,c[i])); return; }
        case 'highlightStd': { dLine(x,y+h,x+w,y+h,GD,1); vBars(x,y,w,h,vals,(bx,by,bw,bh,i)=>fRect(bx,by,bw,bh,i===3?RED:LT)); return; }
        case 'scaleHidden': { for(let q=0;q<2;q++){const ox2=x+q*(w/2); dLine(ox2,y+h,ox2+w/2-2,y+h,AX,0.8); const dd=q?[0.4,0.55,0.45]:[0.8,1.0,0.9]; vBars(ox2,y,w/2-2,h,dd,(bx,by,bw,bh)=>fRect(bx,by,bw,bh,GREY));} ctx.strokeStyle=RED; ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(x+w/2-1,y); ctx.lineTo(x+w/2-1,y+h); ctx.stroke(); return; }
        case 'scaleMark': { dLine(x,y+h,x+w,y+h,AX,1); vBars(x,y+h*0.18,w,h*0.82,vals,(bx,by,bw,bh)=>fRect(bx,by,bw,bh,GREY)); ctx.strokeStyle=RED; ctx.lineWidth=1.4; ctx.beginPath(); const yy=y+h*0.18; for(let i=0;i<=w;i+=3){const xx=x+i; i?ctx.lineTo(xx,yy+((i/3)%2?2:-2)):ctx.moveTo(xx,yy);} ctx.stroke(); return; }
        case 'outlierNone': { dLine(x,y+h,x+w,y+h,AX,1); vBars(x,y,w,h,[0.4,0.5,0.45],(bx,by,bw,bh)=>fRect(bx,by,bw,bh,GREY)); fRect(x+w*0.72,y-3,w*0.18,h+3,GREY); return; }
        case 'outlierMark': { ctx.save(); ctx.beginPath(); ctx.rect(x,y,w,h); ctx.clip(); dLine(x,y+h,x+w,y+h,AX,1); const dv=[0.42,0.56,0.48,0.9]; const op=h*0.32; vBars(x,y+op,w,h-op,dv,(bx,by,bw,bh,i)=>{fRect(bx,by,bw,bh,i===3?'#4a5160':GREY); if(i===3){const mx=bx+bw/2,tw=Math.max(8,Math.min(bw*1.1,24)),th=tw*0.85,ty=by-Math.max(2,th*0.16); fPoly([[mx-tw/2,ty],[mx+tw/2,ty],[mx,ty-th]],RED);}}); ctx.restore(); return; }

        // -- CHECK --
        case 'logAxis': { fRect(x,y,w,h,'#fff'); [0.5,0.78,0.92,1].forEach(t=>dLine(x,y+h*(1-t),x+w,y+h*(1-t),'#aeb7c2',0.8)); vBars(x,y,w,h,vals,(bx,by,bw,bh)=>fRect(bx,by,bw,bh,GREY)); ctx.strokeStyle=AX; ctx.lineWidth=1; ctx.strokeRect(x,y,w,h); return; }
        case 'linAxis': { fRect(x,y,w,h,'#fff'); for(let i=1;i<5;i++)dLine(x,y+h*i/5,x+w,y+h*i/5,'#dfe5ec',0.8); vBars(x,y,w,h,vals,(bx,by,bw,bh)=>fRect(bx,by,bw,bh,GRN)); return; }
        case 'binsUneq': { dLine(x,y+h,x+w,y+h,AX,1); const ws=[0.12,0.28,0.18,0.42]; const hs=[0.5,0.85,0.6,0.4]; let xx=x; for(let i=0;i<4;i++){const bw=w*ws[i]; fRect(xx,y+h*(1-hs[i]),Math.max(2,bw-1),h*hs[i],GREY); xx+=bw;} return; }
        case 'binsEq': { dLine(x,y+h,x+w,y+h,AX,1); vBars(x,y,w,h,[0.5,0.85,0.95,0.6,0.4],(bx,by,bw,bh)=>fRect(bx,by,bw,bh,GRN)); return; }
        case 'clipped': { dLine(x,y+h,x+w,y+h,AX,1); vBars(x,y,w,h,[0.6,1,0.5],(bx,by,bw,bh,i)=>{ if(i===1){fRect(bx,y,bw,h,GREY); ctx.fillStyle='#fff'; ctx.beginPath(); for(let k=0;k<=bw;k+=2){const xx=bx+k; k?ctx.lineTo(xx,y+((k/2)%2?2.5:0)):ctx.moveTo(xx,y);} ctx.lineTo(bx+bw,y-3); ctx.lineTo(bx,y-3); ctx.closePath(); ctx.fill();} else fRect(bx,by,bw,bh,GREY);}); return; }
        case 'extremeRaw': { dLine(x,y+h,x+w,y+h,AX,1); vBars(x,y,w,h,[0.08,0.06,1,0.05,0.07],(bx,by,bw,bh)=>fRect(bx,by,bw,bh,GREY)); return; }
        case 'volume3d': { fCir(x+w*0.3,y+h*0.5,Math.min(w,h)*0.28,GREY); fCir(x+w*0.74,y+h*0.5,Math.min(w,h)*0.16,'#868d9b'); return; }
        case 'linear1d': { dLine(x,y+h,x+w,y+h,AX,1); vBars(x,y,w,h,[0.9,0.45],(bx,by,bw,bh)=>fRect(bx,by,bw,bh,GRN)); return; }
        case 'mapColor': { fPoly([[x+w*0.2,y+h*0.15],[x+w*0.85,y+h*0.1],[x+w*0.95,y+h*0.6],[x+w*0.5,y+h*0.95],[x+w*0.1,y+h*0.7]],'#2b3038'); return; }
        case 'mapSize': { ctx.strokeStyle=AX; ctx.lineWidth=1.2; ctx.beginPath(); const p=[[x+w*0.2,y+h*0.15],[x+w*0.85,y+h*0.1],[x+w*0.95,y+h*0.6],[x+w*0.5,y+h*0.95],[x+w*0.1,y+h*0.7]]; p.forEach((q,i)=>i?ctx.lineTo(q[0],q[1]):ctx.moveTo(q[0],q[1])); ctx.closePath(); ctx.stroke(); fCir(x+w*0.5,y+h*0.5,Math.min(w,h)*0.2,'rgba(55,167,106,0.8)'); return; }
        case 'diffScale': { for(let q=0;q<2;q++){const ox2=x+q*(w/2+1); dLine(ox2,y+h,ox2+w/2-2,y+h,AX,0.8); for(let t=1;t<(q?3:6);t++)dLine(ox2,y+h*(1-t/(q?3:6)),ox2+w/2-2,y+h*(1-t/(q?3:6)),GD,0.5); vBars(ox2,y,w/2-2,h,[0.6,0.9],(bx,by,bw,bh)=>fRect(bx,by,bw,bh,GREY));} return; }
        case 'sameScale': { for(let q=0;q<2;q++){const ox2=x+q*(w/2+1); dLine(ox2,y+h,ox2+w/2-2,y+h,AX,0.8); for(let t=1;t<4;t++)dLine(ox2,y+h*(1-t/4),ox2+w/2-2,y+h*(1-t/4),GD,0.5); vBars(ox2,y,w/2-2,h,[0.6,0.9],(bx,by,bw,bh)=>fRect(bx,by,bw,bh,GRN));} return; }
        case 'wideMargin': { ctx.strokeStyle=AX; ctx.lineWidth=1; ctx.strokeRect(x,y,w,h); dLine(x+w*0.35,y+h*0.7,x+w*0.65,y+h*0.7,GD,0.8); vBars(x+w*0.35,y+h*0.4,w*0.3,h*0.3,[0.6,0.9,0.5],(bx,by,bw,bh)=>fRect(bx,by,bw,bh,GREY)); return; }
        case 'narrowMargin': { dLine(x,y+h,x+w,y+h,AX,1); vBars(x,y,w,h,vals,(bx,by,bw,bh)=>fRect(bx,by,bw,bh,GRN)); return; }
        case 'nominalOnly': { dLine(x,y+h,x+w,y+h,AX,1); fRect(cx-w*0.18,y+h*0.1,w*0.36,h*0.9,GREY); return; }
        case 'realAdj': { dLine(x,y+h,x+w,y+h,AX,1); fRect(cx-w*0.18,y+h*0.1,w*0.36,h*0.9,LT); fRect(cx-w*0.18,y+h*0.45,w*0.36,h*0.55,GRN); return; }
        case 'currHidden': { dLine(x,y+h,x+w,y+h,AX,1); vBars(x,y,w,h,[0.7,0.85],(bx,by,bw,bh)=>fRect(bx,by,bw,bh,GREY)); return; }
        case 'currAdj': { dLine(x,y+h,x+w,y+h,AX,1); vBars(x,y,w,h,[0.7,0.85],(bx,by,bw,bh)=>fRect(bx,by,bw,bh,GRN)); dText('\u20ac',Math.min(h*0.5,9),x+w*0.5,y+h*0.3,BLU,true,true); return; }

        // -- CONDENSE --
        case 'fontBig': { dText('A',Math.min(h,h),cx,cy,'#3a3f4a',true,true); return; }
        case 'fontSmall': { dText('a',Math.min(h*0.45,8),x+w*0.16,y+h*0.3,'#3a3f4a',true,true); for(let i=0;i<3;i++)fRect(x,y+h*(0.55+i*0.16),w*0.9,1.6,'#868d9b'); return; }
        case 'bloated': { dLine(x,y+h,x+w,y+h,AX,1); vBars(x,y,w,h,[0.8,0.95],(bx,by,bw,bh)=>fRect(bx,by,bw,bh,GREY)); return; }
        case 'compact': { dLine(x,y+h,x+w,y+h,AX,1); const n=9,bw=w/n-1; for(let i=0;i<n;i++){const v=0.4+0.5*Math.abs(Math.sin(i)); fRect(x+i*(bw+1),y+h*(1-v),Math.max(1,bw),h*v,GREY);} return; }
        case 'oneHuge': { dLine(x,y+h,x+w,y+h,AX,1); fRect(x+w*0.2,y+h*0.05,w*0.6,h*0.95,GREY); return; }
        case 'pageMargin': { ctx.strokeStyle=AX; ctx.lineWidth=1; ctx.strokeRect(x,y,w,h); fRect(x+w*0.22,y+h*0.22,w*0.56,h*0.56,'#dfe5ec'); return; }
        case 'pageFull': { fRect(x,y,w,h,'#dfe5ec'); ctx.strokeStyle=AX; ctx.lineWidth=1; ctx.strokeRect(x,y,w,h); return; }
        case 'emptyGaps': { dLine(x,y+h,x+w,y+h,AX,1); [0.05,0.45,0.85].forEach((t,i)=>fRect(x+w*t,y+h*(1-vals[i]),w*0.1,h*vals[i],GREY)); return; }
        case 'tightChart': { dLine(x,y+h,x+w,y+h,AX,1); const n=7,bw=w/n-0.5; for(let i=0;i<n;i++){const v=vals[i%vals.length]; fRect(x+i*(bw+0.5),y+h*(1-v),bw,h*v,GREY);} return; }
        case 'dataSparse': { dLine(x,y+h,x+w,y+h,AX,1); fCir(x+w*0.25,y+h*0.5,2,GREY); fCir(x+w*0.7,y+h*0.35,2,GREY); return; }
        case 'dataRich': { dLine(x,y+h,x+w,y+h,AX,1); ctx.strokeStyle=BLU; ctx.lineWidth=1.6; ctx.beginPath(); for(let i=0;i<=12;i++){const xx=x+w*i/12,yy=y+h*(0.5+0.4*Math.sin(i*0.9)); i?ctx.lineTo(xx,yy):ctx.moveTo(xx,yy);} ctx.stroke(); return; }
        case 'detailHidden': { dLine(x,y+h,x+w,y+h,AX,1); fRect(x+w*0.3,y+h*0.15,w*0.4,h*0.85,GREY); return; }
        case 'detailShown': { dLine(x,y+h,x+w,y+h,AX,1); vBars(x,y,w,h,[0.5,0.7,0.4,0.85,0.6,0.55],(bx,by,bw,bh)=>fRect(bx,by,bw,bh,GREY)); return; }
        case 'seriesSplit': { for(let q=0;q<2;q++){const oy2=y+q*(h/2); dLine(x,oy2+h/2-1,x+w,oy2+h/2-1,GD,0.8); vBars(x,oy2,w,h/2-1,[0.6,0.85,0.5],(bx,by,bw,bh)=>fRect(bx,by,bw,bh,q?BLU:GREY));} return; }
        case 'overlay': { dLine(x,y+h,x+w,y+h,AX,1); vBars(x,y,w,h,vals,(bx,by,bw,bh)=>fRect(bx,by,bw,bh,LT)); ctx.strokeStyle=BLU; ctx.lineWidth=2; ctx.beginPath(); vals.forEach((v,i)=>{const xx=x+(i+0.5)*(w/vals.length),yy=y+h*(1-v*0.8); i?ctx.lineTo(xx,yy):ctx.moveTo(xx,yy);}); ctx.stroke(); return; }
        case 'tierSplit': { dLine(x,y+h,x+w,y+h,AX,1); vBars(x,y,w,h,vals,(bx,by,bw,bh)=>fRect(bx,by,bw,bh,GREY)); return; }
        case 'multiTier': { const vzy=y+h*0.15; dLine(x,vzy,x+w,vzy,GD,0.8); const dv=[0.4,-0.3,0.5,-0.2,0.35]; const vbw=(w-2)/dv.length-2; dv.forEach((d,i)=>{const bx=x+i*(vbw+2),bh=Math.abs(d)*h*0.26; fRect(bx,d>=0?vzy-bh:vzy,Math.max(2,vbw),Math.max(1,bh),d>=0?GRN:RED);}); const baseY=y+h; dLine(x,baseY,x+w,baseY,AX,1); vBars(x,y+h*0.4,w,h*0.6,vals,(bx,by,bw,bh)=>fRect(bx,by,bw,bh,GREY)); return; }
        case 'benchNone': { dLine(x,y+h,x+w,y+h,AX,1); vBars(x,y,w,h,vals,(bx,by,bw,bh)=>fRect(bx,by,bw,bh,GREY)); return; }
        case 'benchmark': { dLine(x,y+h,x+w,y+h,AX,1); vBars(x,y,w,h,vals,(bx,by,bw,bh)=>fRect(bx,by,bw,bh,GREY)); dLine(x,y+h*0.35,x+w,y+h*0.35,RED,1.4); return; }
        case 'numTable': { fRect(x,y,w,h,'#fff'); const nr=3,cW=w*0.34; for(let r=0;r<nr;r++){const ry=y+h*(r+0.5)/nr; fRect(x+2,ry-1.4,cW*0.72,2.8,'#5b6573'); const sx=x+cW+4,sw=w-cW-8; for(let c=0;c<3;c++)fRect(sx+c*(sw/3)+2,ry-1.4,sw/3*0.58,2.8,'#5b6573');} return; }
        case 'sparkTable': { fRect(x,y,w,h,'#fff'); const nr=3,cW=w*0.34; for(let r=0;r<nr;r++){const ry=y+h*(r+0.5)/nr; fRect(x+2,ry-1.4,cW*0.72,2.8,'#5b6573'); const sx=x+cW+4,sw=w-cW-8,amp=Math.min((h/nr)*0.34,7); const pts=[]; for(let i=0;i<=5;i++){pts.push([sx+sw*i/5, ry-Math.sin(i*1.1+r*1.7)*amp]);} ctx.fillStyle='rgba(59,111,226,0.16)'; ctx.beginPath(); ctx.moveTo(pts[0][0],ry+amp+1); pts.forEach(p=>ctx.lineTo(p[0],p[1])); ctx.lineTo(pts[pts.length-1][0],ry+amp+1); ctx.closePath(); ctx.fill(); ctx.strokeStyle=BLU; ctx.lineWidth=2; ctx.beginPath(); pts.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1])); ctx.stroke(); ctx.fillStyle=BLU; ctx.beginPath(); ctx.arc(pts[pts.length-1][0],pts[pts.length-1][1],1.8,0,Math.PI*2); ctx.fill();} return; }
        case 'noInline': { dLine(x,y+h,x+w*0.55,y+h,GD,1); vBars(x,y+h*0.2,w*0.5,h*0.8,[0.6,0.9,0.5],(bx,by,bw,bh)=>fRect(bx,by,bw,bh,GREY)); for(let i=0;i<3;i++)fRect(x+w*0.62,y+h*(0.2+i*0.25),w*0.34,1.8,'#b8bec8'); return; }
        case 'inlineNotes': { dLine(x,y+h,x+w,y+h,GD,1); vBars(x,y+h*0.2,w*0.62,h*0.8,[0.6,0.9,0.5],(bx,by,bw,bh)=>fRect(bx,by,bw,bh,GREY)); fCir(x+w*0.72,y+h*0.3,2.4,AMB); fRect(x+w*0.8,y+h*0.28,w*0.18,1.8,'#5b6573'); fRect(x+w*0.8,y+h*0.5,w*0.16,1.8,'#5b6573'); return; }
        case 'scattered': { const ch=[[0.1,0.1],[0.55,0.35],[0.2,0.6],[0.65,0.7]]; ch.forEach((p,i)=>{ctx.save(); ctx.translate(x+w*p[0]+w*0.12,y+h*p[1]+h*0.1); ctx.rotate((i-1.5)*0.3); vBars(-w*0.12,-h*0.1,w*0.24,h*0.2,[0.6,0.9,0.5],(bx,by,bw,bh)=>fRect(bx,by,bw,bh,GREY)); ctx.restore();}); return; }
        case 'grouped': { for(let q=0;q<4;q++){const ox2=x+(q%2)*(w/2),oy2=y+Math.floor(q/2)*(h/2); dLine(ox2,oy2+h/2-2,ox2+w/2-2,oy2+h/2-2,GD,0.6); vBars(ox2,oy2,w/2-2,h/2-2,[0.6,0.9,0.5],(bx,by,bw,bh)=>fRect(bx,by,bw,bh,GREY));} return; }

        // -- EXPRESS --
        case 'tableWrong': { fRect(x,y,w,h,'#fff'); for(let c=1;c<3;c++)dLine(x+w*c/3,y,x+w*c/3,y+h,AX,1); for(let r=1;r<4;r++)dLine(x,y+h*r/4,x+w,y+h*r/4,AX,1); ctx.strokeStyle=RED; ctx.lineWidth=1.6; ctx.beginPath(); ctx.moveTo(x+2,y+2); ctx.lineTo(x+w-2,y+h-2); ctx.moveTo(x+w-2,y+2); ctx.lineTo(x+2,y+h-2); ctx.stroke(); return; }
        case 'tableRight': { fRect(x,y,w,h,'#fff'); fRect(x,y,w,h*0.22,'#dfe5ec'); for(let r=1;r<4;r++)for(let c=0;c<3;c++)fRect(x+w*(c+1)/3-2-w/3*0.45,y+h*(r+0.45)/4-1.1,w/3*0.45,2.2,'#5b6573'); return; }
        case 'iconQty': { for(let i=0;i<5;i++){const px=x+w*(i+0.5)/5; fCir(px,y+h*0.3,Math.min(w/10,h*0.14),GREY); fRect(px-w*0.04,y+h*0.42,w*0.08,h*0.4,GREY);} return; }
        case 'numberQty': { dLine(x,y+h,x+w,y+h,AX,1); vBars(x,y,w,h,[0.5,0.75,0.6,0.9],(bx,by,bw,bh)=>fRect(bx,by,bw,bh,GRN)); return; }
        case 'textSlide': { for(let i=0;i<4;i++){fCir(x+2,y+h*(0.18+i*0.22),1.6,'#5b6573'); fRect(x+6,y+h*(0.18+i*0.22)-1.3,w*0.8,2.6,'#5b6573');} return; }
        case 'dataSlide': { dLine(x,y+h,x+w,y+h,AX,1); vBars(x,y+h*0.15,w,h*0.85,vals,(bx,by,bw,bh)=>fRect(bx,by,bw,bh,GRN)); return; }
        case 'singleScenario': { dLine(x,y+h,x+w,y+h,AX,1); fRect(cx-w*0.16,y+h*0.2,w*0.32,h*0.8,GREY); return; }
        case 'treeStruct': { fRect(cx-w*0.14,y+1,w*0.28,h*0.22,GREY); const ny=y+h*0.65; [0.18,0.5,0.82].forEach(t=>{fRect(x+w*t-w*0.1,ny,w*0.2,h*0.32,'#868d9b'); dLine(cx,y+h*0.23,x+w*t,ny,AX,1);}); return; }
        case 'clusterNone': { dLine(x,y+h,x+w,y+h,AX,1); dLine(x,y,x,y+h,AX,1); [[0.2,0.3],[0.5,0.6],[0.7,0.25],[0.35,0.75],[0.85,0.55],[0.6,0.4]].forEach(p=>fCir(x+w*p[0],y+h*p[1],1.8,GREY)); return; }
        case 'cluster': { dLine(x,y+h,x+w,y+h,AX,1); dLine(x,y,x,y+h,AX,1); [[0.3,0.35,GRN],[0.7,0.65,BLU]].forEach(g=>{ for(let i=0;i<3;i++){const a=i*2.1; fCir(x+w*g[0]+Math.cos(a)*w*0.08,y+h*g[1]+Math.sin(a)*h*0.1,1.8,g[2]);} sCir(x+w*g[0],y+h*g[1],Math.min(w,h)*0.16,g[2],1);}); return; }
        case 'corrNone': { [[0.9,0.7,0.52,0.36,0.24,GREY],[0.35,0.85,0.28,0.66,0.5,BLU]].forEach((r,q)=>{const oy2=y+q*(h/2),bh2=h/2-2,bw=(w-2)/5-2,tp=[]; for(let i=0;i<5;i++){const bx=x+i*(bw+2),bhh=bh2*r[i],by=oy2+bh2-bhh; fRect(bx,by,Math.max(2,bw),Math.max(1,bhh),r[5]); tp.push([bx+bw/2,by]);} ctx.strokeStyle=r[5]; ctx.lineWidth=1.4; ctx.beginPath(); tp.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1])); ctx.stroke();}); return; }
        case 'correlation': { [[0.9,0.7,0.52,0.36,0.24,GREY],[0.9,0.7,0.52,0.36,0.24,BLU]].forEach((r,q)=>{const oy2=y+q*(h/2),bh2=h/2-2,bw=(w-2)/5-2,tp=[]; for(let i=0;i<5;i++){const bx=x+i*(bw+2),bhh=bh2*r[i],by=oy2+bh2-bhh; fRect(bx,by,Math.max(2,bw),Math.max(1,bhh),r[5]); tp.push([bx+bw/2,by]);} ctx.strokeStyle=r[5]; ctx.lineWidth=1.4; ctx.beginPath(); tp.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1])); ctx.stroke();}); return; }

        // -- STRUCTURE --
        case 'reordered': { const ord=[3,1,2]; for(let i=0;i<3;i++){fRect(x,y+h*(0.08+i*0.32),w*0.9,h*0.24,'#868d9b'); dText(String(ord[i]),Math.min(h*0.2,9),x+w*0.12,y+h*(0.08+i*0.32)+h*0.12,'#fff',true,true);} return; }
        case 'ordered': { for(let i=0;i<3;i++){fRect(x,y+h*(0.08+i*0.32),w*0.9,h*0.24,GREY); dText(String(i+1),Math.min(h*0.2,9),x+w*0.12,y+h*(0.08+i*0.32)+h*0.12,'#fff',true,true);} return; }
        case 'parallelBad': { const sh=['c','s','d']; for(let i=0;i<3;i++){const yy=y+h*(0.2+i*0.3); if(sh[i]==='c')fCir(x+3,yy,2,'#5b6573'); else if(sh[i]==='s')fRect(x+1,yy-2,4,4,'#5b6573'); else fRect(x+1,yy-1,5,2,'#5b6573'); fRect(x+9,yy-1.3,w*0.7,2.6,'#5b6573');} return; }
        case 'parallelGood': { for(let i=0;i<3;i++){const yy=y+h*(0.2+i*0.3); fCir(x+3,yy,2,'#5b6573'); fRect(x+9,yy-1.3,w*0.7,2.6,'#5b6573');} return; }
        case 'doubleCount': { dLine(x,y+h,x+w,y+h,AX,1); fRect(x+w*0.1,y+h*0.2,w*0.45,h*0.8,'rgba(74,81,96,0.7)'); fRect(x+w*0.4,y+h*0.3,w*0.45,h*0.7,'rgba(226,59,59,0.6)'); return; }
        case 'waterfall': { dLine(x,y+h,x+w,y+h,AX,1); const steps=[[0.7,0],[0.5,0.2],[0.85,0.15],[0.4,0]]; const bw=(w-2)/4-2; steps.forEach((s,i)=>fRect(x+i*(bw+2),y+h*(1-s[0]-s[1]),Math.max(2,bw),h*s[0],i%2?GRN:GREY)); return; }
        case 'overlapDim': { fCir(x+w*0.38,cy,Math.min(w,h)*0.3,'rgba(59,111,226,0.55)'); fCir(x+w*0.62,cy,Math.min(w,h)*0.3,'rgba(226,59,59,0.5)'); return; }
        case 'disjointDim': { fCir(x+w*0.3,cy,Math.min(w,h)*0.24,'rgba(59,111,226,0.7)'); fCir(x+w*0.7,cy,Math.min(w,h)*0.24,'rgba(55,167,106,0.75)'); return; }
        case 'gapArg': { for(let i=0;i<4;i++){if(i===2)continue; fRect(x+w*i/4,y+h*0.3,w/4-2,h*0.4,GREY);} ctx.strokeStyle=RED; ctx.lineWidth=1.2; ctx.strokeRect(x+w*2/4,y+h*0.3,w/4-2,h*0.4); return; }
        case 'fullArg': { for(let i=0;i<4;i++)fRect(x+w*i/4,y+h*0.3,w/4-2,h*0.4,GRN); return; }
        case 'gapStruct': { const bx=cx-w*0.16; fRect(bx,y+h*0.55,w*0.32,h*0.2,'#868d9b'); fRect(bx,y+h*0.78,w*0.32,h*0.22,GREY); ctx.strokeStyle=RED; ctx.lineWidth=1; ctx.setLineDash([2,2]); ctx.strokeRect(bx,y+h*0.1,w*0.32,h*0.4); ctx.setLineDash([]); return; }
        case 'fullStruct': { const bx=cx-w*0.16,cols=[GRN,'#5fb98a','#9ad3b6']; let yy=y+h; [0.34,0.3,0.36].forEach((s,i)=>{const sh=h*s; yy-=sh; fRect(bx,yy,w*0.32,sh,cols[i]);}); ctx.strokeStyle=DK; ctx.lineWidth=1; ctx.strokeRect(bx,y,w*0.32,h); return; }
        case 'buried': { fPoly([[cx,y+h],[x+w*0.15,y],[x+w*0.85,y]],LT); fRect(x+w*0.32,y+h*0.78,w*0.36,h*0.2,RED); return; }
        case 'deduction': { for(let i=0;i<3;i++){fRect(x+w*0.1,y+h*(0.06+i*0.34),w*0.8,h*0.2,i===0?GRN:'#868d9b'); if(i<2)fPoly([[cx-3,y+h*(0.26+i*0.34)],[cx+3,y+h*(0.26+i*0.34)],[cx,y+h*(0.34+i*0.34)]],AX);} return; }
        case 'scatterStmt': { [[0.2,0.3],[0.6,0.2],[0.8,0.6],[0.35,0.7],[0.55,0.5]].forEach(p=>fRect(x+w*p[0]-2,y+h*p[1]-2,4,4,'#868d9b')); return; }
        case 'pyramidUp': { fPoly([[cx,y],[x+w*0.12,y+h],[x+w*0.88,y+h]],'#868d9b'); fPoly([[cx,y],[x+w*0.34,y+h*0.42],[x+w*0.66,y+h*0.42]],GRN); return; }
        case 'flatList': { for(let i=0;i<4;i++)fRect(x,y+h*(0.1+i*0.24),w*0.85,h*0.14,'#868d9b'); return; }
        case 'indentList': { const ind=[0,0.18,0.18,0.36]; for(let i=0;i<4;i++)fRect(x+w*ind[i],y+h*(0.1+i*0.24),w*0.85-w*ind[i],h*0.14,i===0?DK:'#868d9b'); return; }
        case 'flatTable': { fRect(x,y,w,h,'#fff'); for(let r=0;r<4;r++)fRect(x,y+h*(r+0.5)/4-1.2,w*0.85,2.4,'#5b6573'); return; }
        case 'boldSums': { fRect(x,y,w,h,'#fff'); for(let r=0;r<3;r++)fRect(x+w*0.1,y+h*(r+0.5)/4-1,w*0.75,2,'#868d9b'); fRect(x,y+h*3.5/4-1.6,w*0.9,3.2,DK); return; }
        case 'looseNotes': { [[0.2,0.25],[0.7,0.2],[0.4,0.6],[0.8,0.7]].forEach(p=>fCir(x+w*p[0],y+h*p[1],2.4,AMB)); return; }
        case 'numberedNotes': { for(let i=0;i<3;i++){const yy=y+h*(0.18+i*0.3); dText(String(i+1)+'.',Math.min(h*0.2,8),x+w*0.06,yy,'#3a3f4a',true,true); fRect(x+w*0.2,yy-1.3,w*0.72,2.6,'#5b6573');} return; }

        // -- SAY --
        case 'noGoal': { for(let i=0;i<4;i++){const a=i*1.7; ctx.strokeStyle='#868d9b'; ctx.lineWidth=1.4; ctx.beginPath(); ctx.moveTo(cx,cy); const ex=cx+Math.cos(a)*w*0.4,ey=cy+Math.sin(a)*h*0.4; ctx.lineTo(ex,ey); ctx.stroke(); fPoly([[ex,ey],[ex-Math.cos(a-0.4)*4,ey-Math.sin(a-0.4)*4],[ex-Math.cos(a+0.4)*4,ey-Math.sin(a+0.4)*4]],'#868d9b');} return; }
        case 'target': { sCir(cx,cy,Math.min(w,h)*0.42,RED,1.6); sCir(cx,cy,Math.min(w,h)*0.26,RED,1.4); fCir(cx,cy,Math.min(w,h)*0.1,RED); return; }
        case 'noAudience': { sCir(cx,cy-h*0.1,Math.min(w,h)*0.18,'#868d9b',1.4); fPoly([[cx-w*0.22,y+h],[cx+w*0.22,y+h],[cx+w*0.16,y+h*0.55],[cx-w*0.16,y+h*0.55]],'rgba(134,141,155,0.5)'); ctx.strokeStyle=RED; ctx.lineWidth=1.6; ctx.beginPath(); ctx.moveTo(x+2,y+2); ctx.lineTo(x+w-2,y+h-2); ctx.stroke(); return; }
        case 'audience': { for(let i=0;i<3;i++){const px=x+w*(i+0.5)/3; fCir(px,y+h*0.32,Math.min(w/8,h*0.16),GREY); fPoly([[px-w*0.1,y+h],[px+w*0.1,y+h],[px+w*0.07,y+h*0.5],[px-w*0.07,y+h*0.5]],GREY);} return; }
        case 'noSetup': { ctx.strokeStyle='#868d9b'; ctx.lineWidth=1.4; ctx.setLineDash([3,3]); ctx.strokeRect(x+w*0.12,y+h*0.18,w*0.76,h*0.64); ctx.setLineDash([]); return; }
        case 'situation': { dLine(x,cy,x+w,cy,GREY,2); fCir(x+w*0.2,cy,2.4,GREY); fRect(x+w*0.4,cy-h*0.2,w*0.5,2,'#868d9b'); return; }
        case 'hideProblem': { ctx.strokeStyle=GRN; ctx.lineWidth=2; ctx.beginPath(); for(let i=0;i<=w;i+=2){const xx=x+i,yy=cy-Math.sin(i*0.12)*2; i?ctx.lineTo(xx,yy):ctx.moveTo(xx,yy);} ctx.stroke(); return; }
        case 'problemGap': { ctx.strokeStyle=GREY; ctx.lineWidth=2; ctx.beginPath(); ctx.moveTo(x,y+h*0.3); ctx.lineTo(x+w*0.45,y+h*0.35); ctx.stroke(); ctx.beginPath(); ctx.moveTo(x+w*0.55,y+h*0.75); ctx.lineTo(x+w,y+h*0.8); ctx.stroke(); ctx.strokeStyle=RED; ctx.lineWidth=1.4; ctx.setLineDash([2,2]); ctx.beginPath(); ctx.moveTo(x+w*0.5,y+h*0.35); ctx.lineTo(x+w*0.5,y+h*0.75); ctx.stroke(); ctx.setLineDash([]); return; }
        case 'noQuestion': { dLine(x,cy,x+w,cy,'#868d9b',1.4); return; }
        case 'questionMark': { dText('?',Math.min(h,h),cx,cy,BLU,true,true); return; }
        case 'observeOnly': { sCir(cx,cy,Math.min(w,h)*0.28,'#868d9b',1.6); fCir(cx,cy,Math.min(w,h)*0.1,'#868d9b'); dLine(cx+Math.min(w,h)*0.22,cy+Math.min(w,h)*0.22,x+w-1,y+h-1,'#868d9b',1.6); return; }
        case 'recommend': { fCir(cx,cy-h*0.1,Math.min(w,h)*0.22,AMB); fRect(cx-w*0.08,cy+h*0.12,w*0.16,h*0.18,'#868d9b'); return; }
        case 'claimOnly': { fPoly([[x+w*0.1,y+h*0.12],[x+w*0.9,y+h*0.12],[x+w*0.9,y+h*0.62],[x+w*0.38,y+h*0.62],[x+w*0.24,y+h*0.85],[x+w*0.24,y+h*0.62],[x+w*0.1,y+h*0.62]],'#e6ebf0'); fRect(x+w*0.22,y+h*0.3,w*0.5,2.4,'#b8bec8'); return; }
        case 'evidence': { fPoly([[x+w*0.1,y+h*0.1],[x+w*0.9,y+h*0.1],[x+w*0.9,y+h*0.55],[x+w*0.38,y+h*0.55],[x+w*0.24,y+h*0.78],[x+w*0.24,y+h*0.55],[x+w*0.1,y+h*0.55]],'#e6ebf0'); vBars(x+w*0.2,y+h*0.18,w*0.55,h*0.3,[0.6,0.9,0.5],(bx,by,bw,bh)=>fRect(bx,by,bw,bh,GRN)); return; }
        case 'vague': { ctx.strokeStyle='#868d9b'; ctx.lineWidth=2; for(let r=0;r<3;r++){ctx.beginPath(); for(let i=0;i<=w;i+=2){const xx=x+i,yy=y+h*(0.3+r*0.22)+Math.sin(i*0.6)*1.6; i?ctx.lineTo(xx,yy):ctx.moveTo(xx,yy);} ctx.stroke();} return; }
        case 'precise': { dText('3.5',Math.min(h*0.8,14),cx,cy,GRN,true,true); return; }
        case 'noEmphasis': { dLine(x,y+h,x+w,y+h,GD,1); vBars(x,y,w,h,[0.7,0.7,0.7,0.7,0.7],(bx,by,bw,bh)=>fRect(bx,by,bw,bh,LT)); return; }
        case 'noSource': { const bh2=h*0.6; dLine(x,y+bh2,x+w,y+bh2,GD,1); vBars(x,y,w,bh2,[0.6,0.9,0.5,0.72],(bx,by,bw,bh)=>fRect(bx,by,bw,bh,GREY)); ctx.save(); ctx.beginPath(); ctx.rect(x,y,w,h); ctx.clip(); ctx.textAlign='left'; ctx.textBaseline='middle'; const fs=Math.max(5,Math.min(h*0.16,8)); ctx.font=fs+"px 'Segoe UI',system-ui,sans-serif"; ctx.fillStyle='#9aa3b0'; ctx.fillText('Source: ',x,y+h*0.85); const sw=ctx.measureText('Source: ').width; ctx.fillStyle=RED; ctx.font='bold '+fs+"px 'Segoe UI',system-ui,sans-serif"; ctx.fillText('?',x+sw,y+h*0.85); ctx.restore(); return; }
        case 'source': { const bh2=h*0.6; dLine(x,y+bh2,x+w,y+bh2,GD,1); vBars(x,y,w,bh2,[0.6,0.9,0.5,0.72],(bx,by,bw,bh)=>fRect(bx,by,bw,bh,GREY)); ctx.save(); ctx.beginPath(); ctx.rect(x,y,w,h); ctx.clip(); ctx.textAlign='left'; ctx.textBaseline='middle'; ctx.fillStyle='#8a93a0'; ctx.font=Math.max(5,Math.min(h*0.16,8))+"px 'Segoe UI',system-ui,sans-serif"; ctx.fillText('Source: ERP',x,y+h*0.85); ctx.restore(); return; }
        case 'linkedNotes': { dLine(x,y+h,x+w,y+h,GD,1); vBars(x,y+h*0.15,w*0.7,h*0.85,[0.6,0.9,0.5],(bx,by,bw,bh)=>fRect(bx,by,bw,bh,GREY)); [1,2].forEach((n,i)=>{const px=x+w*(0.2+i*0.35),py=y+h*0.3; fCir(px,py,3,BLU); dText(String(n),6,px,py,'#fff',true,true); dLine(px,py+3,px,y+h,BLU,0.8);}); return; }
        case 'noRecap': { ctx.strokeStyle=GREY; ctx.lineWidth=2; ctx.beginPath(); ctx.moveTo(x,y+h*0.7); ctx.lineTo(x+w*0.7,y+h*0.3); ctx.stroke(); fCir(x+w*0.7,y+h*0.3,1.6,GREY); return; }
        case 'recap': { fRect(x+w*0.1,y+h*0.15,w*0.8,h*0.25,AMB); fRect(x+w*0.1,y+h*0.6,w*0.8,h*0.25,AMB); ctx.strokeStyle=AX; ctx.lineWidth=1; ctx.setLineDash([2,2]); dLine(x+w*0.5,y+h*0.4,x+w*0.5,y+h*0.6,AX,1); ctx.setLineDash([]); return; }
        case 'noNext': { fRect(x+w*0.3,y+h*0.3,w*0.4,h*0.4,'#868d9b'); ctx.strokeStyle=RED; ctx.lineWidth=1.6; ctx.beginPath(); ctx.moveTo(x+w*0.3,y+h*0.3); ctx.lineTo(x+w*0.7,y+h*0.7); ctx.stroke(); return; }
        case 'nextSteps': { ctx.strokeStyle=GRN; ctx.lineWidth=2; ctx.beginPath(); ctx.moveTo(x,cy); ctx.lineTo(x+w*0.45,cy); ctx.stroke(); fPoly([[x+w*0.45,cy-4],[x+w*0.6,cy],[x+w*0.45,cy+4]],GRN); for(let i=0;i<2;i++){const ry=y+h*(0.3+i*0.4); ctx.strokeStyle=GREY; ctx.lineWidth=1.2; ctx.strokeRect(x+w*0.65,ry-2.5,5,5); dLine(x+w*0.65,ry,x+w*0.65+2.5,ry+2.5,GRN,1.2); dLine(x+w*0.65+2.5,ry+2.5,x+w*0.65+5,ry-2.5,GRN,1.2); fRect(x+w*0.78,ry-1.3,w*0.18,2.6,GREY);} return; }
      }
      // column-based kinds: column / colorful / mono / generic
      let palette;
      if (kind === 'colorful') palette = ['#e23b3b', '#3b6fe2', '#37a76a', '#e2a93b', '#8e5bd0'];
      else if (kind === 'mono') palette = ['#2b2f38', '#5a6170', '#868d9b', '#3a3f4a', '#6b7280'];
      else palette = ['#4a5160'];
      vBars(x, y, w, h, vals, (bx, by, bw, bh, i) => fRect(bx, by, bw, bh, palette[i % palette.length]));
    }

    // ===== Matched do/don't pair renderer (Chart Swipe) =====
    // Renders the DO and DON'T charts for a rule in the SAME neutral style, so the
    // ONLY visible difference is the genuine IBCS violation — never colour or
    // overall styling. The DON'T is, by design, an identical copy of the DO base
    // chart with exactly one rule broken. (Bitmaps are intentionally NOT used here,
    // because the per-rule PNGs telegraph the verdict via clean-grey vs colourful.)
    function mulberry32(a){ return function(){ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
    function hashStr(s){ let h=2166136261>>>0; for(let i=0;i<String(s).length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,16777619); } return h>>>0; }
    function seriesFor(code,n){ const r=mulberry32(hashStr(code||'x')); const a=[]; for(let i=0;i<n;i++)a.push(0.42+r()*0.55); return a; }

    // Per-rule variety: derive a deterministic "spec" from the rule code so two
    // rules that share the same do/dont kind still look clearly different
    // (different category count, labels, value shape, units, orientation and
    // single-vs-grouped series). do & dont of one rule share the SAME spec, so
    // only the genuine violation differs between them.
    const CATSETS=[
      ['A','B','C','D','E','F'],
      ['Q1','Q2','Q3','Q4'],
      ['Jan','Feb','Mar','Apr','May','Jun'],
      ['North','South','East','West','Asia'],
      ['Prod A','Prod B','Prod C','Prod D'],
      ['FY21','FY22','FY23','FY24','FY25'],
      ['DE','FR','UK','US','JP','CN'],
      ['Sales','Ops','R&D','HR','IT']
    ];
    const PROFILES=[
      function(i,n){ return 0.42+0.52*i/(n-1); },                         // ascending
      function(i,n){ return 0.94-0.52*i/(n-1); },                         // descending
      function(i,n){ return 0.46+0.46*Math.sin(Math.PI*i/(n-1)); },       // peak
      function(i,n){ return 0.92-0.44*Math.sin(Math.PI*i/(n-1)); },       // valley
      function(i,n){ return 0.5+0.38*Math.sin(i*1.9+0.6); },              // wave
      function(i,n){ return 0.45+0.5*((i*2654435761>>>0)%97)/97; }        // scattered
    ];
    function specFor(code){
      const seed=hashStr(code);
      function pick(arr,salt){ let hh=(seed ^ Math.imul(salt,0x9e3779b1))>>>0; hh=Math.imul(hh^(hh>>>15),0x85ebca6b)>>>0; hh^=hh>>>13; return arr[(hh>>>0)%arr.length]; }
      const rnd=mulberry32(seed);
      const n=4+(pick([0,1,2],31));                                   // 4..6 categories
      const okCats=CATSETS.filter(function(c){return c.length>=n;});
      const cats=pick(okCats,7).slice(0,n);
      const prof=pick(PROFILES,17);
      const unitIdx=pick([0,1,2,3],11);
      const data=[]; for(let i=0;i<n;i++){ data.push(Math.min(1,Math.max(0.12, prof(i,n)+(rnd()-0.5)*0.16))); }
      const data2=[]; for(let i=0;i<n;i++){ data2.push(Math.min(1,Math.max(0.1, data[i]*(0.66+rnd()*0.5)))); }
      return { seed, n, cats, data, data2,
        horizontal: ((seed>>3)&1)===1,
        grouped:    ((seed>>5)&1)===1,
        unitIdx: unitIdx };
    }

    function pair(rule, compliant, x, y, w, h){
      const code=rule.code||'';
      const good=rule.good||'clean', enemy=rule.enemyKind||'clutter';
      const kind = compliant ? good : enemy;
      const AXIS='#a7afbb', GRID='#e6ebf0', BAR='#5b6573', BAR2='#828b99', BARD='#39414e', BARL='#aab2bf', LBL='#5f6878';
      const cats=['A','B','C','D','E'];
      const labelTop=14, catBot=14;
      const px=x+4, pw=w-8, py=y+labelTop, ph=h-labelTop-catBot, baseY=py+ph;
      const sp=specFor(code), N=sp.n, CATS=sp.cats, DATA=sp.data, DATA2=sp.data2;
      const HORIZ=sp.horizontal, GROUPED=sp.grouped;
      function fmtVal(v){ switch(sp.unitIdx){
        case 1: return Math.round(v*920)+'k';
        case 2: return Math.round(v*100)+'%';
        case 3: return (Math.round(v*48)/10).toFixed(1);
        default: return (Math.round(v*240)/10).toFixed(1)+'M'; } }
      function fmtLong(v){ return Math.round(v*2403517).toLocaleString('en-US'); }
      function line(x1,y1,x2,y2,c,wd){ ctx.strokeStyle=c; ctx.lineWidth=wd; ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke(); }
      function barFill(i,second,opt){
        if(opt.colorful) return ['#e23b3b','#3b6fe2','#37a76a','#e2a93b','#8e5bd0','#e2693b'][i%6];
        if(opt.mixFills) return [BAR,BARL,'#737d8b',BARD,BARL,BAR2][i%6];
        return second ? BARL : BAR;
      }

      // ----- bar family: vertical or horizontal, single or grouped -----
      function bars(opt){
        opt=opt||{};
        if(opt.bg){ ctx.fillStyle='#eef1f5'; ctx.fillRect(x,y,w,h); }
        const all = GROUPED ? DATA.concat(DATA2) : DATA;
        const max = Math.max.apply(null,all)*1.18;
        const floor = opt.truncate ? Math.min.apply(null,DATA)*0.84 : 0;
        const showVals = opt.labels!==false && !GROUPED;
        if(!HORIZ){
          const slot=pw/N, groupW=slot*0.6, bw=GROUPED?(groupW/2-1):groupW;
          if(opt.grid){ for(let g=0;g<=4;g++){ const gy=py+ph*g/4; line(px,gy,px+pw,gy,GRID,1); } }
          for(let i=0;i<N;i++){
            const cx0=px+slot*i+(slot-groupW)/2;
            const ser=GROUPED?[DATA[i],DATA2[i]]:[DATA[i]];
            for(let s=0;s<ser.length;s++){
              const norm=Math.max(0.04,(ser[s]-floor)/(max-floor)), bh=norm*ph, by=baseY-bh;
              const bx=GROUPED?cx0+s*(bw+2):cx0;
              if(opt.threeD){ const d=4; fPoly([[bx,by],[bx+d,by-d],[bx+bw+d,by-d],[bx+bw,by]],'rgba(0,0,0,0.18)'); fPoly([[bx+bw,by],[bx+bw+d,by-d],[bx+bw+d,baseY-d],[bx+bw,baseY]],'rgba(0,0,0,0.26)'); }
              if(opt.hatch && s===0){ ctx.fillStyle='#eef1f5'; ctx.fillRect(bx,by,bw,bh); hatchRect(bx,by,bw,bh,'#6b7280'); ctx.strokeStyle=BARD; ctx.lineWidth=1; ctx.strokeRect(bx,by,bw,bh); }
              else { ctx.fillStyle=barFill(i,s===1,opt); ctx.fillRect(bx,by,bw,bh); }
              if(showVals){ ctx.fillStyle=LBL; ctx.textAlign='center'; ctx.textBaseline='alphabetic'; ctx.font=(opt.longNum?7:9)+"px 'Segoe UI',system-ui,sans-serif"; ctx.fillText(opt.longNum?fmtLong(ser[s]):fmtVal(ser[s]), bx+bw/2, by-3); ctx.textAlign='left'; }
            }
          }
          line(px,baseY,px+pw,baseY,AXIS,1.4);
          if(opt.grid) line(px,py,px,baseY,AXIS,1);
          if(opt.truncate){ const zy=baseY-3; ctx.strokeStyle='#39414f'; ctx.lineWidth=1.4; ctx.beginPath(); ctx.moveTo(px-2,zy+5); ctx.lineTo(px+3,zy); ctx.lineTo(px+7,zy+6); ctx.lineTo(px+11,zy); ctx.lineTo(px+15,zy+5); ctx.stroke(); }
          ctx.fillStyle=LBL; ctx.textAlign='center'; ctx.textBaseline='alphabetic'; ctx.font="9px 'Segoe UI',system-ui,sans-serif";
          for(let i=0;i<N;i++) ctx.fillText(CATS[i], px+slot*i+slot/2, baseY+11);
          ctx.textAlign='left';
        } else {
          const gut=Math.min(46,pw*0.2), ax=px+gut, aw=pw-gut-6;
          const slot=ph/N, groupH=slot*0.58, bh=GROUPED?(groupH/2-1):groupH;
          if(opt.grid){ for(let g=0;g<=4;g++){ const gx=ax+aw*g/4; line(gx,py,gx,baseY,GRID,1); } }
          for(let i=0;i<N;i++){
            const cy0=py+slot*i+(slot-groupH)/2;
            const ser=GROUPED?[DATA[i],DATA2[i]]:[DATA[i]];
            for(let s=0;s<ser.length;s++){
              const norm=Math.max(0.04,(ser[s]-floor)/(max-floor)), blen=norm*aw, by=cy0+s*(bh+2);
              if(opt.hatch && s===0){ ctx.fillStyle='#eef1f5'; ctx.fillRect(ax,by,blen,bh); hatchRect(ax,by,blen,bh,'#6b7280'); ctx.strokeStyle=BARD; ctx.lineWidth=1; ctx.strokeRect(ax,by,blen,bh); }
              else { ctx.fillStyle=barFill(i,s===1,opt); ctx.fillRect(ax,by,blen,bh); }
              if(showVals){ ctx.fillStyle=LBL; ctx.textAlign='left'; ctx.textBaseline='middle'; ctx.font=(opt.longNum?7:9)+"px 'Segoe UI',system-ui,sans-serif"; ctx.fillText(opt.longNum?fmtLong(ser[s]):fmtVal(ser[s]), ax+blen+3, by+bh/2); }
            }
            ctx.fillStyle=LBL; ctx.textAlign='left'; ctx.textBaseline='middle'; ctx.font="9px 'Segoe UI',system-ui,sans-serif"; ctx.fillText(CATS[i], px, cy0+groupH/2);
          }
          ctx.textBaseline='alphabetic'; ctx.textAlign='left';
          line(ax,py,ax,baseY,AXIS,1.4);
          if(opt.truncate){ const zx=ax+3; ctx.strokeStyle='#39414f'; ctx.lineWidth=1.4; ctx.beginPath(); ctx.moveTo(zx-5,baseY+2); ctx.lineTo(zx,baseY-3); ctx.lineTo(zx+6,baseY+1); ctx.lineTo(zx,baseY-3); ctx.stroke(); }
        }
        if(opt.border){ ctx.strokeStyle='#9aa3b0'; ctx.lineWidth=1; ctx.strokeRect(x,y,w,h); }
        if(opt.legend){ const lx=x+w-50, ly=y+3, lp=['#e23b3b','#3b6fe2','#37a76a']; for(let i=0;i<3;i++){ ctx.fillStyle=lp[i]; ctx.fillRect(lx,ly+i*7,6,5); ctx.fillStyle=LBL; ctx.font="6px 'Segoe UI',system-ui,sans-serif"; ctx.textAlign='left'; ctx.fillText('Series '+(i+1), lx+9, ly+i*7+5); } }
      }

      // ----- variance / deviation chart -----
      function deviation(){
        const n=N, dv=[]; for(let i=0;i<n;i++){ dv.push((DATA[i]-0.5)*2); }
        if(!HORIZ){
          const midY=py+ph/2, slot=pw/n, bw=slot*0.5;
          line(px,midY,px+pw,midY,AXIS,1.2);
          for(let i=0;i<n;i++){ const v=dv[i], bx=px+slot*i+(slot-bw)/2, mag=Math.abs(v)*(ph/2)*0.82, pos=v>=0;
            if(pos){ ctx.fillStyle=BARD; ctx.fillRect(bx,midY-mag,bw,mag); } else { ctx.strokeStyle=BARD; ctx.lineWidth=1.2; ctx.strokeRect(bx,midY,bw,mag); }
            ctx.fillStyle=LBL; ctx.textAlign='center'; ctx.textBaseline='alphabetic'; ctx.font="8px 'Segoe UI',system-ui,sans-serif"; ctx.fillText((pos?'+':'\u2212')+Math.round(Math.abs(v)*40), bx+bw/2, pos?midY-mag-3:midY+mag+9); }
          ctx.fillStyle=LBL; ctx.textAlign='center'; ctx.font="9px 'Segoe UI',system-ui,sans-serif"; for(let i=0;i<n;i++) ctx.fillText(CATS[i],px+slot*i+slot/2,baseY+11); ctx.textAlign='left';
        } else {
          const gut=Math.min(46,pw*0.2), midX=px+gut+(pw-gut-6)/2, half=(pw-gut-6)/2, slot=ph/n, bh=slot*0.5;
          line(midX,py,midX,baseY,AXIS,1.2);
          for(let i=0;i<n;i++){ const v=dv[i], by=py+slot*i+(slot-bh)/2, mag=Math.abs(v)*half*0.9, pos=v>=0;
            if(pos){ ctx.fillStyle=BARD; ctx.fillRect(midX,by,mag,bh); } else { ctx.strokeStyle=BARD; ctx.lineWidth=1.2; ctx.strokeRect(midX-mag,by,mag,bh); }
            ctx.fillStyle=LBL; ctx.textAlign='left'; ctx.textBaseline='middle'; ctx.font="9px 'Segoe UI',system-ui,sans-serif"; ctx.fillText(CATS[i], px, by+bh/2); }
          ctx.textBaseline='alphabetic';
        }
      }

      function bigNumber(){
        const v=DATA[0];
        ctx.fillStyle='#39414f'; ctx.textAlign='center'; ctx.textBaseline='middle';
        ctx.font="bold "+Math.round(h*0.30)+"px 'Segoe UI',system-ui,sans-serif";
        ctx.fillText(fmtLong(v), x+w/2, y+h*0.46);
        ctx.font="11px 'Segoe UI',system-ui,sans-serif"; ctx.fillStyle=LBL;
        ctx.fillText(CATS[0]+' total', x+w/2, y+h*0.72);
        ctx.textAlign='left'; ctx.textBaseline='alphabetic';
      }

      function pieChart(){
        const segN=Math.min(N,5), seg=DATA.slice(0,segN), cx=x+w/2, cy=y+h/2-2, r=Math.min(w,h)/2-12;
        const tot=seg.reduce(function(s,v){return s+v;},0); let a=-Math.PI/2;
        const greys=['#454d59','#646e7d','#828b99','#9aa2af','#c2c8d1'];
        for(let i=0;i<seg.length;i++){ const a2=a+seg[i]/tot*Math.PI*2; ctx.fillStyle=greys[i%greys.length]; ctx.beginPath(); ctx.moveTo(cx,cy); ctx.arc(cx,cy,r,a,a2); ctx.closePath(); ctx.fill(); a=a2; }
        ctx.strokeStyle='#fff'; ctx.lineWidth=1.4; ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); ctx.stroke();
      }

      function stack(opt){
        opt=opt||{};
        const segN=3+(sp.seed%3), seg=DATA.slice(0,segN), tot=seg.reduce(function(s,v){return s+v;},0);
        const twin=GROUPED && !opt.broken;
        const greys=['#454d59','#5b6573','#79828f','#9aa2af','#c2c8d1'];
        const bw=Math.min(pw*(twin?0.26:0.4),twin?56:72), ph2=ph*0.92;
        const cxs = twin ? [x+w/2-bw-10, x+w/2+10] : [x+w/2-bw/2];
        for(let c=0;c<cxs.length;c++){
          const bx=cxs[c]; let yy=baseY;
          for(let i=0;i<seg.length;i++){ const val=seg[i]*(c?(0.7+(sp.seed%5)/10):1), sh=val/tot*ph2;
            if(opt.broken){ const off=(i%2)?6:-5; ctx.fillStyle=greys[i%greys.length]; ctx.fillRect(bx+off, yy-sh+(i?3:0), bw, sh); yy-=sh-2; }
            else { ctx.fillStyle=greys[i%greys.length]; ctx.fillRect(bx, yy-sh, bw, sh); yy-=sh; }
          }
          if(!opt.broken){ ctx.strokeStyle='#2b2f38'; ctx.lineWidth=1; ctx.strokeRect(bx,yy,bw,baseY-yy); }
        }
        if(!opt.broken){ ctx.fillStyle=LBL; ctx.textAlign='center'; ctx.font="9px 'Segoe UI',system-ui,sans-serif"; for(let c=0;c<cxs.length;c++) ctx.fillText(twin?(c?'PY':'AC'):'100%', cxs[c]+bw/2, baseY-ph2-4); ctx.textAlign='left'; }
        line(px,baseY,px+pw,baseY,AXIS,1.4);
      }

      function lineChart(opt){
        opt=opt||{};
        const n=Math.max(5,N+1), pts=[]; for(let i=0;i<n;i++){ pts.push(0.3+0.6*(PROFILES[sp.seed%PROFILES.length](i,n))); }
        const max=Math.max.apply(null,pts)*1.15;
        line(px,baseY,px+pw,baseY,AXIS,1.2);
        if(GROUPED){ // area fill under a second, lighter line
          ctx.fillStyle='rgba(120,130,145,0.18)'; ctx.beginPath(); ctx.moveTo(px,baseY);
          for(let i=0;i<n;i++){ const lx=px+pw*i/(n-1), ly=baseY-(pts[i]*0.7/max)*ph; ctx.lineTo(lx,ly); }
          ctx.lineTo(px+pw,baseY); ctx.closePath(); ctx.fill();
        }
        ctx.strokeStyle='#4a5160'; ctx.lineWidth=2; ctx.beginPath();
        for(let i=0;i<n;i++){ const lx=px+pw*i/(n-1), ly=baseY-(pts[i]/max)*ph; if(i===0)ctx.moveTo(lx,ly); else ctx.lineTo(lx,ly); }
        ctx.stroke();
        ctx.fillStyle='#4a5160'; for(let i=0;i<n;i++){ const lx=px+pw*i/(n-1), ly=baseY-(pts[i]/max)*ph; ctx.beginPath(); ctx.arc(lx,ly,2.1,0,Math.PI*2); ctx.fill(); }
      }

      switch(kind){
        case 'clutter': bars({grid:true,threeD:!HORIZ,colorful:true,border:true,bg:true,legend:true}); break;
        case 'barDark': case 'barSolid': bars({mixFills:true}); break;
        case 'axisBreak': bars({truncate:true}); break;
        case 'bigNumber': (good==='clean') ? bars({longNum:true}) : bigNumber(); break;
        case 'pie': pieChart(); break;
        case 'meceBad': stack({broken:true}); break;
        case 'meceGood': stack({}); break;
        case 'deviation': deviation(); break;
        case 'line': lineChart(); break;
        case 'barHatched': bars({hatch:true}); break;
        default: bars({}); break;  // clean / column / axisFull / barLight
      }
    }

    return { glyph, pair, fRect, dLine, dText };
  }

  global.IBCSCharts = IBCSCharts;
})(typeof window !== 'undefined' ? window : globalThis);
