/* You AR — 土台:カメラ / 3Dモデル / ジェスチャ / 自撮り / 会話
 * 育成などの機能は window.YouAR.hooks に処理を差し込んで拡張する(roommate.js)。 */
(() => {
  const $ = id => document.getElementById(id);
  const video = $('video'), stage = $('stage'), me = $('me'), bubble = $('bubble');
  const FX0 = () => ({ dx:0, dy:0, rot:0, sc:1, sy:1 });
  const state = { x:0, y:0, s:1, r:0, flip:1, facing:'environment', stream:null, fx:FX0(), baseFx:null, three:null, started:false, selfie:false, walking:false, walkClip:false, hideMe:false };
  const hooks = {};
  let baseW = 0, baseH = 0;

  // 端末内の保存領域(IndexedDB)。3Dモデル・モーション・育成データを保存する。サーバーは使わない
  const idb = (() => {
    let dbp;
    const open = () => dbp || (dbp = new Promise((res, rej) => {
      const r = indexedDB.open('youar', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    }));
    const tx = (mode, fn) => open().then(db => new Promise((res, rej) => {
      const t = db.transaction('kv', mode), q = fn(t.objectStore('kv'));
      t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error);
    }));
    return { get: k => tx('readonly', st => st.get(k)), set: (k, v) => tx('readwrite', st => st.put(v, k)), del: k => tx('readwrite', st => st.delete(k)) };
  })();

  const toast = msg => { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2400); };
  const pick = a => a[Math.floor(Math.random() * a.length)];

  /* ---------- 描画ループ ---------- */
  let animating = false;
  const addFx = (a, b) => ({ dx:a.dx + (b.dx || 0), dy:a.dy + (b.dy || 0), rot:a.rot + (b.rot || 0), sc:a.sc * (b.sc || 1), sy:a.sy * (b.sy || 1) });
  // 待機中の姿勢(寝ている等) + 歩いているときの上下の揺れ
  function bodyFx(now) {
    let f = state.baseFx ? addFx(FX0(), state.baseFx(now)) : FX0();
    if (state.walking && !state.walkClip) f = addFx(f, { dy:-Math.abs(Math.sin(now / 120)) * 7 * state.s, rot:Math.sin(now / 240) * .02 });
    return f;
  }
  (function loop(now) {
    if (!animating && baseH && (state.baseFx || state.walking)) { state.fx = bodyFx(now || 0); render(); }
    if (state.three) state.three.frame();
    requestAnimationFrame(loop);
  })();
  function setBaseFx(fn) { state.baseFx = fn; if (!fn && !animating) { state.fx = FX0(); render(); } }

  function setSource(w, h, max) {
    const k = Math.min(1, max / Math.max(w, h));
    me.width = Math.round(w * k); me.height = Math.round(h * k);
    baseH = Math.min(innerHeight * 0.6, me.height); baseW = baseH * me.width / me.height;
    me.style.width = baseW + 'px'; me.style.height = baseH + 'px';
    if (!me.dataset.placed) { place(); me.dataset.placed = 1; }
    render();
  }

  /* ---------- カメラ ---------- */
  async function startCamera() {
    if (state.stream) state.stream.getTracks().forEach(t => t.stop());
    try {
      state.stream = await navigator.mediaDevices.getUserMedia({ video:{ facingMode:state.facing, width:{ideal:1920}, height:{ideal:1080} }, audio:false });
    } catch (e) {
      toast('カメラを起動できません: ' + (e.message || e.name)); throw e;
    }
    video.srcObject = state.stream;
    video.style.transform = state.facing === 'user' ? 'scaleX(-1)' : '';
    await video.play().catch(() => {});
  }

  /* ---------- 配置・描画・当たり判定 ---------- */
  const off = () => state.anchorOn ? [state.ax, state.ay] : [0, 0];
  function place() { state.x = innerWidth / 2; state.y = innerHeight * 0.52; state.s = 1; state.r = 0; refAnchor(); }
  function center() { const [ox, oy] = off(), f = state.fx; return [state.x + ox + f.dx, state.y + oy + f.dy]; }
  function render() {
    if (!baseH) return;
    const [cx, cy] = center(), f = state.fx;
    me.style.display = state.hideMe ? 'none' : 'block';
    me.style.transform = `translate(${cx - baseW/2}px, ${cy - baseH/2}px) rotate(${state.r + f.rot}rad) scale(${state.s * state.flip * f.sc}, ${state.s * f.sc * f.sy})`;
    moveBubble();
  }
  // 頭の位置(吹き出し・食べ物の行き先・パーティクル用)
  function headPoint() { const [cx, cy] = center(); return [cx, cy - baseH * state.s * state.fx.sc * 0.36]; }
  function moveBubble() {
    if (bubble.hidden || !baseH) return;
    const [cx, cy] = center();
    bubble.style.left = Math.min(innerWidth - 20, Math.max(20, cx)) + 'px';
    // 吹き出しはモデルの頭上に(画面の上にはみ出さない)
    bubble.style.top = Math.max(60 + bubble.offsetHeight, cy - baseH * state.s / 2 - 8) + 'px';
  }
  // 画面上の点がモデルの見えている部分に当たっているか(透明部分は外れ)
  function hitTest(px, py) {
    if (!baseH || me.style.display !== 'block') return false;
    const [cx, cy] = center(), f = state.fx;
    let dx = px - cx, dy = py - cy;
    const a = -(state.r + f.rot), c = Math.cos(a), s = Math.sin(a);
    [dx, dy] = [dx * c - dy * s, dx * s + dy * c];
    const u = dx / (state.s * state.flip * f.sc * baseW) + .5, v = dy / (state.s * f.sc * f.sy * baseH) + .5;
    if (u < 0 || u > 1 || v < 0 || v > 1) return false;
    try {
      const x = Math.floor(u * me.width), y = Math.floor(v * me.height);
      const d = me.getContext('2d').getImageData(Math.max(0, x - 3), Math.max(0, y - 3), 7, 7).data;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 16) return true;
      return false;
    } catch (_) { return true; }
  }
  // 指定した地点まで歩いていく(足元がその点に来る)
  let walkRaf = 0;
  function walkTo(px, py) {
    const [ox, oy] = off();
    const tx = px - ox, ty = py - oy - baseH * state.s / 2;
    const sx = state.x, sy = state.y, t0 = performance.now(), d = Math.min(1400, 300 + Math.hypot(tx - sx, ty - sy) * 1.6);
    cancelAnimationFrame(walkRaf);
    const step = now => {
      const t = Math.min(1, (now - t0) / d), e = t < .5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      state.x = sx + (tx - sx) * e; state.y = sy + (ty - sy) * e - Math.abs(Math.sin(t * Math.PI * 4)) * 10 * (1 - t);
      render(); if (t < 1) walkRaf = requestAnimationFrame(step);
    };
    walkRaf = requestAnimationFrame(step);
    hooks.walk && hooks.walk();
  }

  /* ---------- 暮らす範囲(ゾーン) ----------
   * 画面上でなぞった四角形を、世界座標(=ジャイロで固定される座標)で覚える。
   * 上の辺ほど奥なので小さく、下の辺ほど手前なので大きく表示する。 */
  const zone = { on:false, x0:0, y0:0, x1:0, y1:0, sizeK:.7 };
  const clampN = (v, a, b) => Math.max(a, Math.min(b, v));
  const zoneScale = fy => {
    const d = Math.min(1, (zone.y1 - zone.y0) / (innerHeight * .4)), far = 1 - .45 * d, t = clampN((fy - zone.y0) / Math.max(1, zone.y1 - zone.y0), 0, 1);
    return zone.sizeK * (far + (1 - far) * t);
  };
  const feet = () => [state.x, state.y + baseH * state.s / 2];
  const toWorld = (px, py) => { const [ox, oy] = off(); return [px - ox, py - oy]; };
  function placeAt(wx, wfy) {
    wx = clampN(wx, zone.x0, zone.x1); wfy = clampN(wfy, zone.y0, zone.y1);
    state.s = zoneScale(wfy); state.x = wx; state.y = wfy - baseH * state.s / 2; render();
  }
  const zoneRandom = () => [zone.x0 + Math.random() * (zone.x1 - zone.x0), zone.y0 + Math.random() * (zone.y1 - zone.y0)];
  const zoneFront = () => [(zone.x0 + zone.x1) / 2, zone.y1 - 4];
  const inZone = (wx, wfy) => wx >= zone.x0 && wx <= zone.x1 && wfy >= zone.y0 && wfy <= zone.y1;

  let walkTok = 0;
  function endWalk() {
    state.walking = false;
    if (state.walkClip && state.three) state.three.stopLoop();
    state.walkClip = false;
    if (!state.baseFx && !animating) { state.fx = FX0(); render(); }
  }
  function stopWalk() { walkTok++; cancelAnimationFrame(walkRaf); if (state.walking) endWalk(); }
  // 世界座標の(tx, tfy)=足元の位置まで歩く。着いたら true、途中で止められたら false
  function walkWorld(tx, tfy) {
    const tok = ++walkTok; cancelAnimationFrame(walkRaf);
    tx = clampN(tx, zone.x0, zone.x1); tfy = clampN(tfy, zone.y0, zone.y1);
    const [sx, sfy] = feet(), dist = Math.hypot(tx - sx, tfy - sfy);
    if (dist < 8) return Promise.resolve(true);
    const dur = clampN(dist / (60 + 140 * state.s) * 1000, 500, 9000);
    state.walking = true;
    if (!state.walkClip) state.walkClip = !!(state.three && state.three.loop && state.three.loop('walk'));
    hooks.walk && hooks.walk();
    return new Promise(res => {
      const t0 = performance.now();
      const step = now => {
        if (tok !== walkTok) return res(false);
        const t = Math.min(1, (now - t0) / dur), e = t * t * (3 - 2 * t);
        placeAt(sx + (tx - sx) * e, sfy + (tfy - sfy) * e);
        if (t < 1) walkRaf = requestAnimationFrame(step); else { endWalk(); res(true); }
      };
      walkRaf = requestAnimationFrame(step);
    });
  }

  const zoneStore = { get() { try { return JSON.parse(localStorage.getItem('youar.zone')); } catch (_) { return null; } }, set(v) { try { localStorage.setItem('youar.zone', JSON.stringify(v)); } catch (_) {} } };
  // 起動時に「暮らす範囲」を決める。完了したら resolve
  function runZoneSetup() {
    return new Promise(resolve => {
      const ui = $('zoneUI'), rectEl = $('zoneRect'), msg = $('zoneMsg'), btns = $('zoneBtns'), sizeBox = $('zoneSize'), range = $('sizeRange');
      const saved = zoneStore.get(), W = () => innerWidth, H = () => innerHeight;
      let r = null, drag = null, mode = 'draw';
      stopWalk(); zone.on = false; state.hideMe = true; render();
      ui.hidden = false; bubble.hidden = true; $('bar').style.display = 'none';
      const valid = () => r && r.x1 - r.x0 >= 90 && r.y1 - r.y0 >= 36;
      const button = (label, fn, cls = '', dis = false) => { const b = document.createElement('button'); b.textContent = label; if (cls) b.className = cls; b.disabled = dis; b.onclick = () => fn(); btns.append(b); return b; };
      const showRect = () => { rectEl.hidden = !r; if (r) Object.assign(rectEl.style, { left:r.x0 + 'px', top:r.y0 + 'px', width:(r.x1 - r.x0) + 'px', height:(r.y1 - r.y0) + 'px' }); };
      function stepDraw() {
        mode = 'draw'; ui.classList.remove('top'); btns.textContent = ''; sizeBox.hidden = true; state.hideMe = true; render(); showRect();
        msg.innerHTML = '<b>① 暮らす場所を決めよう</b><br>床を映して、僕が歩き回っていい範囲を、指でなぞって囲んでね。足元が来る場所だよ。';
        const next = button('つぎへ', stepSize, '', !valid());
        stepDraw.next = next;
        if (saved) button('前回の範囲を使う', () => { r = { x0:saved.x0 * W(), y0:saved.y0 * H(), x1:saved.x1 * W(), y1:saved.y1 * H() }; stepSize(saved.sizeK); }, 'sub');
        button('おまかせ', () => { r = { x0:W() * .1, y0:H() * .42, x1:W() * .9, y1:H() * .72 }; stepSize(); }, 'sub');
      }
      function applyRect() {
        const [wx0, wy0] = toWorld(r.x0, r.y0), [wx1, wy1] = toWorld(r.x1, r.y1);
        Object.assign(zone, { on:true, x0:wx0, y0:wy0, x1:wx1, y1:wy1 });
      }
      function stepSize(k) {
        mode = 'size'; ui.classList.add('top'); btns.textContent = ''; rectEl.hidden = false; showRect();
        applyRect(); zone.sizeK = k || zone.sizeK || .7; range.value = Math.round(zone.sizeK * 100); sizeBox.hidden = false;
        state.hideMe = false; state.r = 0; state.flip = state.flip || 1; placeAt((zone.x0 + zone.x1) / 2, zone.y1 - 4);
        msg.innerHTML = '<b>② 大きさを合わせよう</b><br>手前の端に立ったとき、ちょうどいい大きさにしてね。';
        button('もどる', stepDraw, 'sub'); button('ここで暮らす', finish);
      }
      range.oninput = () => { const [fx, ffy] = feet(); zone.sizeK = range.value / 100; placeAt(fx, ffy); };
      function finish() {
        zoneStore.set({ x0:r.x0 / W(), y0:r.y0 / H(), x1:r.x1 / W(), y1:r.y1 / H(), sizeK:zone.sizeK });
        ui.hidden = true; rectEl.hidden = true; state.hideMe = false;
        const [x, y] = zoneRandom(); placeAt(x, y);
        if (!state.selfie) $('bar').style.display = 'flex';
        render(); resolve();
      }
      // なぞって範囲を描く
      ui.onpointerdown = e => { if (mode !== 'draw' || e.target.closest('#zonePanel')) return; ui.setPointerCapture(e.pointerId); drag = { x:e.clientX, y:e.clientY }; r = { x0:e.clientX, y0:e.clientY, x1:e.clientX, y1:e.clientY }; showRect(); };
      ui.onpointermove = e => { if (!drag) return; r = { x0:Math.min(drag.x, e.clientX), y0:Math.min(drag.y, e.clientY), x1:Math.max(drag.x, e.clientX), y1:Math.max(drag.y, e.clientY) }; showRect(); };
      ui.onpointerup = ui.onpointercancel = () => { if (!drag) return; drag = null; if (stepDraw.next) stepDraw.next.disabled = !valid(); if (!valid()) { r = null; showRect(); toast('もう少し大きく囲んでね'); } };
      stepDraw();
    });
  }

  /* ---------- ジェスチャ ----------
   * 1本指:モデルの上なら「なでる」(動かす)/「つつく」(タップ)
   * 2本指:移動・拡大・回転 / 何もない所をダブルタップ:そこへ移動 / マウスは空白ドラッグで移動 */
  const ptrs = new Map(); let pinch = null, g = null, lastTap = 0;
  stage.addEventListener('pointerdown', e => {
    stage.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, e);
    if (ptrs.size === 1) {
      const onMe = hitTest(e.clientX, e.clientY);
      g = { type: onMe ? 'touch' : (e.pointerType === 'mouse' && !zone.on ? 'move' : 'none'), sx:e.clientX, sy:e.clientY, t:performance.now() };
    } else { g = { type:'pinch' }; pinch = null; }
  });
  stage.addEventListener('pointermove', e => {
    if (!ptrs.has(e.pointerId)) return;
    const prev = ptrs.get(e.pointerId); ptrs.set(e.pointerId, e);
    if (ptrs.size === 1 && g) {
      const dx = e.clientX - prev.clientX, dy = e.clientY - prev.clientY;
      if (g.type === 'move') { state.x += dx; state.y += dy; render(); }
      else if (g.type === 'touch' && hitTest(e.clientX, e.clientY)) hooks.stroke && hooks.stroke(Math.hypot(dx, dy), e.clientX, e.clientY);
    } else if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), ang = Math.atan2(b.clientY - a.clientY, b.clientX - a.clientX);
      const mx = (a.clientX + b.clientX) / 2, my = (a.clientY + b.clientY) / 2;
      if (pinch) {
        if (zone.on) { const [fx, ffy] = feet(); zone.sizeK = clampN(zone.sizeK * dist / pinch.dist, .2, 1.6); placeAt(fx, ffy); }  // 暮らす範囲の中では、つまんで大きさだけ変える
        else {
          state.s = Math.min(6, Math.max(0.1, state.s * dist / pinch.dist)); state.r += ang - pinch.ang;
          state.x += mx - pinch.mx; state.y += my - pinch.my;
        }
      }
      pinch = { dist, ang, mx, my }; render();
    }
  });
  const up = e => {
    if (!ptrs.has(e.pointerId)) return;
    if (ptrs.size === 1 && g && g.type !== 'pinch') {
      const now = performance.now(), moved = Math.hypot(e.clientX - g.sx, e.clientY - g.sy);
      if (moved < 12 && now - g.t < 350) {
        if (g.type === 'touch') hooks.poke && hooks.poke(e.clientX, e.clientY);
        else if (now - lastTap < 380) {
          lastTap = 0;
          if (zone.on) { const [wx, wy] = toWorld(e.clientX, e.clientY); hooks.call ? hooks.call(wx, wy) : walkWorld(wx, wy); }
          else walkTo(e.clientX, e.clientY);
        } else lastTap = now;
      }
    }
    if (zone.on && pinch) { const k = zoneStore.get(); if (k) { k.sizeK = zone.sizeK; zoneStore.set(k); } }
    ptrs.delete(e.pointerId); pinch = null; if (!ptrs.size) g = null;
  };
  stage.addEventListener('pointerup', up); stage.addEventListener('pointercancel', up);
  stage.addEventListener('wheel', e => {
    e.preventDefault(); const k = e.deltaY < 0 ? 1.08 : 0.92;
    if (zone.on) { const [fx, ffy] = feet(); zone.sizeK = clampN(zone.sizeK * k, .2, 1.6); placeAt(fx, ffy); }
    else { state.s = Math.min(6, Math.max(0.1, state.s * k)); render(); }
  }, { passive:false });

  /* ---------- ジャイロで空間に固定 ---------- */
  const HFOV = 60; // 想定する水平画角(度)
  state.anchorOn = true; state.ax = 0; state.ay = 0;
  let ori = null, ref = null;
  function refAnchor() { ref = ori ? { ...ori } : null; state.ax = state.ay = 0; }
  const wrap = d => ((d + 540) % 360) - 180;
  function onOrient(e) {
    if (e.alpha == null) return;
    const heading = e.webkitCompassHeading != null ? 360 - e.webkitCompassHeading : e.alpha;
    ori = { yaw: heading, pitch: e.beta };
    if (!ref) ref = { ...ori };
    const ppd = innerWidth / HFOV;
    state.ax = wrap(ori.yaw - ref.yaw) * ppd;   // 右へ向く→モデルは左へ
    state.ay = (ori.pitch - ref.pitch) * ppd;    // 上へ向ける→モデルは下へ
    if (state.anchorOn) render();
  }
  async function enableMotion() {
    try {
      if (window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === 'function') {
        const r = await DeviceOrientationEvent.requestPermission(); if (r !== 'granted') return;
      }
      addEventListener('deviceorientation', onOrient, true);
    } catch (_) {}
  }
  function setAnchor(on) {
    if (on === state.anchorOn) return;
    if (!on) { state.x += state.ax; state.y += state.ay; }
    state.anchorOn = on; $('anchor').checked = on; refAnchor(); render();
  }
  $('anchor').onchange = e => setAnchor(e.target.checked);

  /* ---------- 撮影 ---------- */
  function composite() {
    const vw = video.videoWidth, vh = video.videoHeight; if (!vw) return null;
    const W = innerWidth, H = innerHeight, k = Math.max(W / vw, H / vh);
    const out = document.createElement('canvas'), S = 2; out.width = W * S; out.height = H * S;
    const c = out.getContext('2d'); c.scale(S, S);
    c.save();
    if (state.facing === 'user') { c.translate(W, 0); c.scale(-1, 1); }
    c.drawImage(video, (W - vw * k) / 2, (H - vh * k) / 2, vw * k, vh * k);
    c.restore();
    const [cx, cy] = center(), f = state.fx;
    c.translate(cx, cy); c.rotate(state.r + f.rot); c.scale(state.s * state.flip * f.sc, state.s * f.sc * f.sy);
    c.drawImage(me, -baseW / 2, -baseH / 2, baseW, baseH);
    return out;
  }
  // 共有シート(写真アプリに保存できる)が使えればそれで、無理ならダウンロード
  function takeShot() {
    const out = composite(); if (!out) return;
    out.toBlob(async b => {
      const file = new File([b], 'you-ar-' + Date.now() + '.png', { type:'image/png' });
      if (navigator.canShare && navigator.canShare({ files:[file] })) {
        try { await navigator.share({ files:[file] }); return; } catch (e) { if (e.name === 'AbortError') return; }
      }
      const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = file.name; a.click();
      toast('保存しました');
    }, 'image/png');
    hooks.shot && hooks.shot();
  }
  $('shot').onclick = takeShot;

  /* ---------- 自撮りモード(内カメラ・並んで撮る) ---------- */
  let before = null;
  async function enterSelfie() {
    stopWalk();
    before = { facing:state.facing, x:state.x, y:state.y, s:state.s, r:state.r, anchor:state.anchorOn, zone:zone.on };
    zone.on = false;
    state.facing = 'user';
    try { await startCamera(); } catch (_) { state.facing = before.facing; return; }
    setAnchor(false);
    state.selfie = true; state.r = 0; state.s = 0.85;
    state.x = innerWidth * 0.72; state.y = innerHeight - baseH * state.s / 2 - 150; render();
    $('bar').style.display = 'none'; $('selfieUI').hidden = false;
    toast('となりに並んでポーズ!');
  }
  async function exitSelfie() {
    state.selfie = false;
    $('selfieUI').hidden = true; $('bar').style.display = 'flex';
    if (!before) return;
    state.facing = before.facing; Object.assign(state, { x:before.x, y:before.y, s:before.s, r:before.r }); zone.on = before.zone;
    await startCamera().catch(() => {});
    setAnchor(before.anchor); render();
  }
  let counting = false;
  async function selfieCountdown() {
    if (counting) return; counting = true;
    const cnt = $('count'), wait = ms => new Promise(r => setTimeout(r, ms));
    hooks.selfiePose ? hooks.selfiePose() : play(pick(['happy', 'greet', 'yes']));
    for (const n of [3, 2, 1]) { cnt.textContent = n; await wait(800); }
    cnt.textContent = '';
    const fl = $('flash'); fl.classList.add('on'); setTimeout(() => fl.classList.remove('on'), 60);
    takeShot(); counting = false;
  }
  $('selfieBtn').onclick = enterSelfie;
  $('selfieExit').onclick = exitSelfie;
  $('selfieShot').onclick = selfieCountdown;

  /* ---------- 動き(3Dモーションが無いときの簡易アニメーション) ---------- */
  const env = (t, a = .15) => t < a ? t / a : t > 1 - a ? (1 - t) / a : 1;
  const ANIMS = {
    greet:    { d:1600, f:t => ({ rot:Math.sin(t*Math.PI*6)*.12*(1-t), dy:-Math.abs(Math.sin(t*Math.PI*2))*20 }) },
    happy:    { d:1400, f:t => ({ dy:-Math.abs(Math.sin(t*Math.PI*3))*60, sy:1+Math.sin(t*Math.PI*6)*.03 }) },
    sad:      { d:2200, f:t => { const k = env(t, .25); return { dy:30*k, sy:1-.06*k, rot:.05*k }; } },
    bye:      { d:1800, f:t => ({ rot:Math.sin(t*Math.PI*8)*.15*(1-t) }) },
    yes:      { d:1200, f:t => { const k = Math.abs(Math.sin(t*Math.PI*3)); return { dy:k*18, sy:1-k*.04 }; } },
    no:       { d:1200, f:t => ({ dx:Math.sin(t*Math.PI*6)*25*(1-t) }) },
    surprise: { d:900,  f:t => ({ sc:1+Math.sin(t*Math.PI)*.18, dy:-Math.sin(t*Math.PI)*25 }) },
    dance:    { d:3000, f:t => ({ dx:Math.sin(t*Math.PI*6)*40, rot:Math.sin(t*Math.PI*6)*.1, dy:-Math.abs(Math.sin(t*Math.PI*6))*25 }) },
    eat:      { d:1500, f:t => { const k = Math.abs(Math.sin(t*Math.PI*9)) * env(t); return { sy:1-k*.05, sc:1+k*.02, dy:k*5 }; } },
    pet:      { d:1000, f:t => ({ rot:Math.sin(t*Math.PI*4)*.06*(1-t), sy:1+Math.sin(t*Math.PI*4)*.03*(1-t) }) },
  };
  const TALK_INTENTS = ['greet','happy','sad','bye','yes','no','surprise','dance'];
  let animRaf = 0;
  function runAnim(id) {
    const A = ANIMS[id] || ANIMS.yes, t0 = performance.now();
    cancelAnimationFrame(animRaf); animating = true;
    const step = now => {
      const t = Math.min(1, (now - t0) / A.d);
      if (t < 1) { state.fx = addFx(bodyFx(now), A.f(t)); render(); animRaf = requestAnimationFrame(step); }
      else { animating = false; state.fx = bodyFx(now); render(); }
    };
    animRaf = requestAnimationFrame(step);
  }
  function play(id) {
    if (!id) return;
    if (state.three && state.three.play(id)) return;
    runAnim(id);
  }

  /* ---------- 会話 ---------- */
  // キーワードによる理解(AIを使わない標準モード。オフライン・即時)
  const RULES = [
    { id:'greet',    reply:'こんにちは!', words:['こんにちは','こんばんは','おはよう','やあ','ハロー','はじめまして','hello','hi'] },
    { id:'happy',    reply:'ありがとう!うれしい!', words:['ありがとう','嬉しい','うれしい','最高','すごい','やった','好き','かわいい','かっこいい','おめでとう','えらい'] },
    { id:'sad',      reply:'そっか…元気出してね', words:['悲しい','かなしい','つらい','辛い','疲れ','落ち込','さみしい','寂しい','泣'] },
    { id:'bye',      reply:'またね!', words:['バイバイ','ばいばい','さようなら','またね','じゃあね','行ってきます','いってきます'] },
    { id:'no',       reply:'ううん、違うよ', words:['いいえ','だめ','ダメ','違う','ちがう','やだ','嫌','いらない'] },
    { id:'surprise', reply:'えっ!?', words:['えっ','びっくり','まじ','本当','ほんと','うそ','嘘'] },
    { id:'dance',    reply:'見てて!踊るよ!', words:['踊','おどっ','ダンス','dance'] },
    { id:'yes',      reply:'うんうん', words:['はい','うん','そうだね','いいよ','オッケー','ok','了解','お願い'] },
  ];
  function ruleUnderstand(text) {
    const t = text.toLowerCase(); let best = null, bestN = 0;
    for (const r of RULES) { const n = r.words.filter(w => t.includes(w.toLowerCase())).length; if (n > bestN) { best = r; bestN = n; } }
    const summary = text.length > 20 ? text.slice(0, 20) + '…' : text;
    return best ? { intent:best.id, reply:best.reply, summary } : { intent:'yes', reply:pick(['そうなんだ','へえ〜','なるほどね','うんうん、それで?']), summary };
  }

  // 任意:ブラウザ内AI(WebLLM)で要約して返事を考える。端末内で動くので無料・外部送信なし
  let engine = null, engineLoading = null;
  function getEngine() {
    if (engine) return Promise.resolve(engine);
    if (!navigator.gpu) return Promise.reject(new Error('この端末はWebGPUに未対応です'));
    if (!engineLoading) engineLoading = (async () => {
      const { CreateMLCEngine } = await import('https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.79/+esm');
      engine = await CreateMLCEngine('Qwen2.5-1.5B-Instruct-q4f16_1-MLC', {
        initProgressCallback: p => showBubble('AIを準備中… ' + Math.round(p.progress * 100) + '%', '初回のみ時間がかかります', 600000)
      });
      return engine;
    })().catch(e => { engineLoading = null; throw e; });
    return engineLoading;
  }
  // 返事をJSONで返させる(システム文と直近の会話を渡す)。失敗したら null
  async function llmJSON(system, messages) {
    try {
      const e = await getEngine();
      const r = await e.chat.completions.create({ temperature:.7, max_tokens:160, messages:[{ role:'system', content:system }, ...messages] });
      const m = r.choices[0].message.content.match(/\{[\s\S]*\}/);
      return JSON.parse(m[0]);
    } catch (err) {
      toast('AI理解に失敗したので簡易判定にします: ' + (err.message || err)); $('llm').checked = false; return null;
    }
  }

  function showBubble(reply, summary, ms = 6000) {
    bubble.textContent = '';
    if (summary) { const sm = document.createElement('small'); sm.textContent = summary; bubble.append(sm); }
    const b = document.createElement('b'); b.textContent = reply; bubble.append(b);
    bubble.hidden = false; moveBubble();
    clearTimeout(showBubble.t); showBubble.t = setTimeout(() => { bubble.hidden = true; }, ms);
  }
  function speak(text) {
    if (!$('tts').checked || !('speechSynthesis' in window)) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text.replace(/[!!??〜…♪]/g, m => m === '…' ? '、' : m)); u.lang = 'ja-JP'; u.pitch = 1.15; speechSynthesis.speak(u);
  }
  // 返事をする:吹き出し + 声 + 動き
  // 表情:うれしい場面では笑顔、それ以外は真顔。少したったら普段の表情に戻る
  const SMILE = ['happy', 'greet', 'dance', 'eat', 'pet', 'bye'];
  let exprTimer = 0;
  const setExpr = e => state.three && state.three.setExpr && state.three.setExpr(e);
  const baseExpr = () => hooks.baseExpr ? hooks.baseExpr() : 'neutral';
  function emote(intent) {
    if (!intent) return;
    setExpr(SMILE.includes(intent) ? 'smile' : 'neutral');
    clearTimeout(exprTimer); exprTimer = setTimeout(() => setExpr(baseExpr()), 4500);
  }
  function say(reply, intent, opts = {}) {
    showBubble(reply, opts.summary || '', opts.ms || 6000);
    if (opts.voice !== false) speak(reply);
    play(intent); emote(intent);
  }
  async function handle(text) {
    text = (text || '').trim(); if (!text) return;
    if (hooks.talk) return hooks.talk(text);
    const r = ruleUnderstand(text); say(r.reply, r.intent, { summary:'「' + r.summary + '」' });
  }

  // 入力欄 / マイク
  const sendText = () => { const t = $('text'); const v = t.value; t.value = ''; handle(v); };
  $('send').onclick = sendText;
  $('text').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) sendText(); });
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null;
  $('mic').onclick = () => {
    if (!SR) { toast('このブラウザは音声認識に未対応です。入力欄を使ってください'); return; }
    if (rec) { rec.stop(); return; }
    rec = new SR(); rec.lang = 'ja-JP'; rec.interimResults = false;
    rec.onresult = e => handle(e.results[0][0].transcript);
    rec.onerror = e => toast('音声認識エラー: ' + e.error);
    rec.onend = () => { rec = null; $('mic').classList.remove('on'); };
    rec.start(); $('mic').classList.add('on'); toast('話しかけてください');
  };

  /* ---------- 3Dモデル(.glb) ---------- */
  const MOTION_KEYS = {
    greet:['greet','wave','hello','あいさつ','手を振'], happy:['happy','jump','cheer','joy','victory','喜'],
    sad:['sad','cry','sorrow','悲'], bye:['bye','farewell','バイバイ'], yes:['yes','nod','agree','thumbs','うなず'],
    no:['reject','headshake','head shake','refuse','首を振'], surprise:['surpris','shock','scare','startle','驚'],
    dance:['danc','samba','hiphop','hip hop','twerk','breakdance','踊'], eat:['eat','drink','食'],
    pet:['shy','blush','giggl','照'], walk:['walk','stroll','jog'], idle:['idle','breath','stand']
  };
  const motionPool = []; // { name, clip, tags:Set }
  let renderer3 = null, loaderLib = null, lastPick = null;

  async function lib() {
    if (!loaderLib) {
      const T = await import('three');
      const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
      loaderLib = { T, loader: new GLTFLoader() };
    }
    return loaderLib;
  }
  function tagsOf(name) {
    const n = name.toLowerCase(), tags = new Set();
    for (const [id, ws] of Object.entries(MOTION_KEYS)) if (ws.some(w => n.includes(w))) tags.add(id);
    return tags;
  }
  function addClips(clips, label, src = 'motion') {
    for (const clip of clips) {
      const name = (clip.name && clip.name !== 'mixamo.com' ? clip.name + ' ' : '') + label;
      motionPool.push({ name, clip, tags: tagsOf(name), src });
    }
  }
  const parseGLB = buf => lib().then(({ loader }) => new Promise((res, rej) => loader.parse(buf, '', res, rej)));

  async function loadModel(file) {
    try {
      showBubble('3Dモデルを読み込み中…', '', 60000);
      const { T } = await lib();
      const gltf = await parseGLB(await file.arrayBuffer());
      const model = gltf.scene;
      const W = 512, H = 768;
      const renderer = renderer3 || (renderer3 = new T.WebGLRenderer({ alpha:true, antialias:true }));
      renderer.setSize(W, H, false); renderer.setPixelRatio(1); renderer.setClearColor(0x000000, 0);
      const scene = new T.Scene();
      scene.add(new T.HemisphereLight(0xffffff, 0x444466, 1.6));
      const sun = new T.DirectionalLight(0xffffff, 1.8); sun.position.set(2, 4, 3); scene.add(sun);
      scene.add(model);
      // 足元を原点・正面をカメラへ。大きさを揃えて画面に収める
      const box = new T.Box3().setFromObject(model), size = box.getSize(new T.Vector3()), ctr = box.getCenter(new T.Vector3());
      model.position.x -= ctr.x; model.position.z -= ctr.z; model.position.y -= box.min.y;
      const cam = new T.PerspectiveCamera(30, W / H, 0.01, 1000);
      const dist = Math.max((size.y / 2) / Math.tan(T.MathUtils.degToRad(15)), (size.x / 2) / Math.tan(T.MathUtils.degToRad(15)) / (W / H)) * 1.15;
      cam.position.set(0, size.y / 2, dist); cam.lookAt(0, size.y / 2, 0);
      let hipsY = null; model.traverse(o => { if (/hips$/i.test(o.name) && hipsY == null) hipsY = o.position.y; });

      const mixer = new T.AnimationMixer(model);
      const ctx = me.getContext('2d'), clock = new T.Clock();
      let current = null, idleAction = null, loopAction = null;
      // 表情:頭のメッシュ(Head_neutral / Head_smile …)を切り替える
      const faces = {}; model.traverse(o => { const m = /^Head_(\w+)$/.exec(o.name); if (m && o.isMesh) faces[m[1]] = o; });
      const setExpr = e => { const k = faces[e] ? e : 'neutral'; for (const [n, o] of Object.entries(faces)) o.visible = n === k; };
      setExpr('neutral');
      const make = clip => {
        // 他のモデル由来の動きを合わせる:Hipsの位置だけ縮尺を合わせ、その場で動かす。他の位置トラックは捨てる
        const c = clip.clone();
        c.tracks = c.tracks.filter(t => !t.name.endsWith('.position') || /hips\.position$/i.test(t.name));
        for (const t of c.tracks) if (/hips\.position$/i.test(t.name) && hipsY) {
          const k = hipsY / (t.values[1] || hipsY);
          for (let i = 0; i < t.values.length; i += 3) { t.values[i] = 0; t.values[i + 1] *= k; t.values[i + 2] = 0; }
        }
        return mixer.clipAction(c);
      };
      state.three = {
        play(id) {
          if (id === 'idle') return false;
          const own = motionPool.filter(m => m.tags.has(id));
          const misc = motionPool.filter(m => m.tags.size === 0);
          let cand = own.length ? own : misc;
          if (cand.length > 1) cand = cand.filter(m => m !== lastPick);
          if (!cand.length) return false;
          const p = cand[Math.floor(Math.random() * cand.length)]; lastPick = p;
          const a = make(p.clip); a.reset().setLoop(T.LoopOnce, 1); a.clampWhenFinished = true;
          if (current && current !== a) current.crossFadeTo(a, .25, false);
          a.play(); current = a;
          const onEnd = e => { if (e.action !== a) return; mixer.removeEventListener('finished', onEnd); if (idleAction) { idleAction.reset().play(); a.crossFadeTo(idleAction, .3, false); } current = idleAction; };
          mixer.addEventListener('finished', onEnd);
          return true;
        },
        // 歩きなど、繰り返し再生する動き(あれば true)
        loop(id) {
          if (loopAction) return true;
          const cand = motionPool.filter(m => m.tags.has(id)); if (!cand.length) return false;
          const a = make(cand[Math.floor(Math.random() * cand.length)].clip); a.reset().setLoop(T.LoopRepeat, Infinity);
          if (current && current !== a) current.crossFadeTo(a, .25, false);
          a.play(); current = a; loopAction = a; return true;
        },
        stopLoop() {
          if (!loopAction) return; const a = loopAction; loopAction = null;
          if (idleAction) { idleAction.reset().play(); a.crossFadeTo(idleAction, .3, false); current = idleAction; } else { a.fadeOut(.3); current = null; }
        },
        setExpr,
        frame() {
          mixer.update(clock.getDelta());
          renderer.render(scene, cam);
          ctx.clearRect(0, 0, me.width, me.height); ctx.drawImage(renderer.domElement, 0, 0, me.width, me.height);
        }
      };
      // モデル自身が持つ動きを登録。idleがあれば待機ループに使う
      for (let i = motionPool.length - 1; i >= 0; i--) if (motionPool[i].src === 'model') motionPool.splice(i, 1);
      addClips(gltf.animations, file.name.replace(/\.[^.]+$/, ''), 'model');
      const idle = motionPool.find(m => m.tags.has('idle'));
      if (idle) { idleAction = make(idle.clip); idleAction.play(); current = idleAction; }
      setSource(W, H, 768);
      $('go').disabled = false; $('hint').textContent = '3Dモデルを読み込みました';
      showBubble('3Dモデルを読み込みました', '', 2000);
      return true;
    } catch (err) {
      console.error(err); toast('3Dモデルを読み込めません: ' + (err.message || err)); bubble.hidden = true;
      return false;
    }
  }
  async function loadFile(file) { state.three = null; return loadModel(file); }

  /* ---------- UI ---------- */
  $('go').onclick = async () => {
    await enableMotion();
    try { await startCamera(); } catch (_) { return; }
    $('start').style.display = 'none'; refAnchor();
    await runZoneSetup();               // 暮らす範囲を決めてもらう
    $('gear').style.display = 'block'; state.started = true;
    hooks.started ? hooks.started() : toast('ダブルタップで呼べるよ');
  };
  $('flip').onclick = async () => { state.facing = state.facing === 'environment' ? 'user' : 'environment'; await startCamera(); };
  $('mirror').onclick = () => { state.flip *= -1; render(); };
  $('gear').onclick = () => { $('panel').hidden = false; };
  $('zoneBtn').onclick = async () => { $('panel').hidden = true; await runZoneSetup(); hooks.zoneChanged && hooks.zoneChanged(); };
  $('closePanel').onclick = () => { $('panel').hidden = true; };
  addEventListener('resize', () => render());

  // 起動時:あなたの3Dモデル(me.glb)を読み込む
  (async () => {
    $('hint').textContent = 'あなたの3Dモデルを読み込み中…';
    try {
      const r = await fetch('me.glb'); if (!r.ok) throw new Error('me.glb が見つかりません');
      const ok = await loadFile(new File([await r.blob()], 'me.glb'));
      $('hint').textContent = ok ? '準備できました' : '3Dモデルを読み込めませんでした';
    } catch (e) { $('hint').textContent = '3Dモデルを読み込めませんでした: ' + e.message; }
    idb.del('model').catch(() => {}); idb.del('motions').catch(() => {}); // 以前のバージョンで保存したモデルは不要なので消す
  })();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); // 保存データが勝手に消されないよう依頼

  // オフラインでも起動できるようにする(PWA)
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

  // 育成などの拡張用API
  window.YouAR = { $, idb, state, hooks, zone, play, say, setExpr, emote, showBubble, speak, toast, pick, hitTest, headPoint, center, setBaseFx, render,
    walkWorld, stopWalk, placeAt, feet, toWorld, zoneRandom, zoneFront, inZone, runZoneSetup, llmJSON, ruleUnderstand, takeShot, TALK_INTENTS };
})();
