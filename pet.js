/* You AR — 育成:ステータス / ごはん / なでる / 睡眠 / 成長 / 生活リズム
 * 実時間で状態が変化し、この端末のブラウザ(localStorage)に保存される。 */
(() => {
  const A = window.YouAR, $ = A.$, pick = A.pick;
  const KEY = 'youar.pet.v1', HOUR = 3600e3, DAY = 24 * HOUR;
  const now = () => Date.now();
  const clamp = v => Math.max(0, Math.min(100, v));

  /* ---------- 保存データ ---------- */
  const FOODS = [
    { id:'onigiri',  e:'🍙', n:'おにぎり',     h:25, m:3,  lv:1 },
    { id:'apple',    e:'🍎', n:'りんご',       h:12, m:4,  lv:1 },
    { id:'broccoli', e:'🥦', n:'ブロッコリー', h:10, m:-6, lv:1, healthy:true },
    { id:'milk',     e:'🥛', n:'ぎゅうにゅう', h:8,  m:2,  en:6, lv:1 },
    { id:'cake',     e:'🍰', n:'ケーキ',       h:15, m:14, lv:2, sweet:true },
    { id:'sushi',    e:'🍣', n:'おすし',       h:28, m:9,  lv:3 },
    { id:'ramen',    e:'🍜', n:'ラーメン',     h:35, m:7,  lv:4 },
    { id:'choco',    e:'🍫', n:'チョコ',       h:8,  m:10, lv:5, sweet:true },
    { id:'meat',     e:'🍖', n:'おにく',       h:40, m:10, lv:7 },
  ];
  const TITLES = [[1,'はじめまして'],[3,'ともだち'],[6,'なかよし'],[10,'しんゆう'],[15,'かぞく'],[25,'いっしん同体']];
  const def = () => ({
    v:1, name:'ぼく', hunger:70, mood:70, energy:80, xp:0,
    firstMet:now(), lastSeen:now(), lastTick:now(), sleeping:false, sleptAt:0,
    fav:pick(FOODS.filter(f => !f.healthy)).id, favKnown:false, recent:[],
    fed:0, petted:0, talked:0, met:false, lastGreetDay:''
  });
  let P = load();
  const prevSeen = P.lastSeen; // 前回このアプリを閉じた時刻(出迎えの言葉に使う)
  function load() {
    try { const j = JSON.parse(localStorage.getItem(KEY)); if (j && j.v === 1) return Object.assign(def(), j); } catch (_) {}
    return def();
  }
  function save() {
    P.lastSeen = now();
    try { localStorage.setItem(KEY, JSON.stringify(P)); } catch (_) {}
    A.idb.set('pet', P).catch(() => {}); // 閉じている間の通知(sw.js)が読む
  }

  /* ---------- 成長 ---------- */
  const lvOf = xp => Math.floor(Math.sqrt(xp / 20)) + 1;
  const need = L => 20 * (L - 1) ** 2;
  const title = L => TITLES.filter(t => L >= t[0]).pop()[1];
  const days = () => Math.floor((now() - P.firstMet) / DAY) + 1;
  function gainXp(n) {
    const before = lvOf(P.xp); P.xp += n; const after = lvOf(P.xp);
    if (after > before) setTimeout(() => levelUp(after), 1600);
    hud();
  }
  function levelUp(L) {
    const [x, y] = A.headPoint();
    for (let i = 0; i < 8; i++) setTimeout(() => particle(pick(['✨','🎉','💗','⭐']), x + (Math.random() - .5) * 120, y + Math.random() * 60), i * 90);
    const unlocked = FOODS.filter(f => f.lv === L).map(f => f.e + f.n);
    A.say(`レベル${L}になった!` + (unlocked.length ? ` ${unlocked.join('・')}が食べられるようになったよ` : ''), 'dance', { ms:7000 });
    if (TITLES.some(t => t[0] === L)) A.toast(`なかよしレベル「${title(L)}」になりました`);
    buildTray();
  }

  /* ---------- 時間経過 ---------- */
  function tick() {
    const t = now(), h = Math.min(72, (t - P.lastTick) / HOUR); P.lastTick = t;
    if (h <= 0) return;
    if (P.sleeping) { P.energy += 25 * h; P.hunger -= 4 * h; }
    else { P.energy -= 5 * h; P.hunger -= 7 * h; }
    P.mood -= 3 * h + (P.hunger < 25 ? 5 * h : 0) + (P.energy < 20 ? 3 * h : 0);
    P.hunger = clamp(P.hunger); P.mood = clamp(P.mood); P.energy = clamp(P.energy);
    // 力尽きたら勝手に寝る / 朝になって元気なら起きる
    const hr = new Date().getHours();
    if (!P.sleeping && P.energy <= 3) { P.sleeping = true; P.sleptAt = t; if (A.state.started) { A.setBaseFx(sleepFx); A.showBubble('もう限界…おやすみ…', '', 4000); } }
    if (P.sleeping && P.energy >= 100 && hr >= 6 && hr < 22 && t - P.sleptAt > HOUR && A.state.started) wake(true);
    hud(); save();
  }

  /* ---------- ステータス表示 ---------- */
  const color = v => v < 25 ? '#f55' : v < 55 ? '#fc4' : '#6c6';
  function bar(id, v, c) { const e = $(id); e.style.width = v + '%'; e.style.background = c || color(v); }
  function hud() {
    const L = lvOf(P.xp);
    $('hudName').textContent = P.name; $('hudLv').textContent = 'Lv' + L;
    $('hudSub').textContent = `${title(L)} ・ 一緒に${days()}日目${P.sleeping ? ' ・ 💤' : ''}`;
    bar('barHunger', P.hunger); bar('barMood', P.mood); bar('barEnergy', P.energy);
    bar('barBond', Math.round((P.xp - need(L)) / (need(L + 1) - need(L)) * 100), '#ff7aa8');
    $('sleepBtn').textContent = P.sleeping ? '☀ おこす' : '💤 おやすみ';
    document.body.classList.toggle('sleeping', P.sleeping);
  }

  /* ---------- 演出 ---------- */
  function particle(emoji, x, y, cls = '') {
    const p = document.createElement('div'); p.className = 'particle ' + cls; p.textContent = emoji;
    p.style.setProperty('--x', x - 14 + 'px'); p.style.setProperty('--y', y - 14 + 'px'); p.style.setProperty('--dx', (Math.random() - .5) * 60 + 'px');
    $('fxLayer').append(p); setTimeout(() => p.remove(), 2600);
  }
  let lastAct = now();
  const touched = () => { lastAct = now(); };

  /* ---------- 睡眠 ---------- */
  const sleepFx = t => ({ dy:14 + Math.sin(t / 900) * 4, sy:.95 + Math.sin(t / 900) * .015, rot:.07 });
  function sleep() {
    if (P.sleeping) return;
    if (P.energy > 85) { A.say(pick(['まだ眠くないよ!','えー、まだ遊びたい!']), 'no'); return; }
    P.sleeping = true; P.sleptAt = now(); A.setBaseFx(sleepFx);
    A.say(pick(['おやすみ…','ふぁ〜…おやすみなさい','また明日ね…']), 'yes'); hud(); save();
  }
  function wake(natural) {
    if (!P.sleeping) return;
    P.sleeping = false; A.setBaseFx(null);
    const slept = (now() - P.sleptAt) / HOUR;
    if (natural || P.energy >= 70) A.say(pick(['おはよう!よく寝た〜!','ふぁ〜、おはよう!']), 'happy');
    else { P.mood = clamp(P.mood - 8); A.say(pick(['ん…まだ眠いよ…','起こさないでよ〜…']), 'sad'); }
    if (slept > 6) gainXp(3);
    hud(); save();
  }
  setInterval(() => { if (P.sleeping && A.state.started && !document.hidden) { const [x, y] = A.headPoint(); particle(pick(['z','Z','z']), x + 20, y - 10, 'z'); } }, 1800);
  $('sleepBtn').onclick = () => { touched(); P.sleeping ? wake(false) : sleep(); };

  /* ---------- ごはん ---------- */
  function buildTray() {
    const tray = $('tray'), L = lvOf(P.xp); tray.textContent = '';
    for (const f of FOODS) {
      const b = document.createElement('button'); b.className = 'food-pick' + (L < f.lv ? ' locked' : '');
      b.innerHTML = `${f.e}<small>${L < f.lv ? 'Lv' + f.lv : f.n}</small>`;
      b.onclick = () => { if (L < f.lv) { A.toast(`Lv${f.lv}で解放されます`); return; } spawnFood(f); tray.hidden = true; };
      tray.append(b);
    }
    const h = document.createElement('div'); h.className = 'trayHint'; h.textContent = '選んだら、僕に向かってフリックで投げてね(直接ドラッグしてもOK)';
    tray.append(h);
  }
  $('feedBtn').onclick = () => { buildTray(); $('tray').hidden = !$('tray').hidden; };

  function spawnFood(f) {
    const el = document.createElement('div'); el.className = 'food'; el.textContent = f.e;
    const barTop = $('bar').getBoundingClientRect().top;
    let x = innerWidth / 2, y = barTop - 50, s = 1, raf = 0, samples = [];
    const put = () => { el.style.transform = `translate(${x - 28}px, ${y - 28}px) scale(${s})`; };
    put(); document.body.append(el);
    el.addEventListener('pointerdown', e => { el.setPointerCapture(e.pointerId); cancelAnimationFrame(raf); s = 1; samples = [{ x:e.clientX, y:e.clientY, t:performance.now() }]; el.style.cursor = 'grabbing'; });
    el.addEventListener('pointermove', e => {
      if (!samples.length) return;
      x = e.clientX; y = e.clientY; put();
      samples.push({ x, y, t:performance.now() }); if (samples.length > 6) samples.shift();
    });
    el.addEventListener('pointerup', () => {
      if (!samples.length) return;
      const a = samples[0], b = samples[samples.length - 1], dt = Math.max(16, b.t - a.t) / 1000;
      let vx = (b.x - a.x) / dt, vy = (b.y - a.y) / dt; samples = [];
      const sp = Math.hypot(vx, vy);
      if (sp > 2600) { vx *= 2600 / sp; vy *= 2600 / sp; }
      if (A.hitTest(x, y)) return eat(f, el, x, y);
      if (sp > 350) fly(vx, vy);
    });
    function fly(vx, vy) {
      let last = performance.now(), travel = 0;
      const step = t => {
        const dt = Math.min(.05, (t - last) / 1000); last = t;
        vy += 1500 * dt; x += vx * dt; y += vy * dt; travel += Math.hypot(vx, vy) * dt;
        s = Math.max(.45, 1 - travel / 1400); put(); // 奥へ飛んでいくように小さくする
        if (A.hitTest(x, y)) return eat(f, el, x, y);
        if (y > innerHeight + 80 || x < -80 || x > innerWidth + 80 || y < -200) { el.remove(); missed(); return; }
        raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    }
  }
  function missed() { touched(); A.say(pick(['あっ…もったいない','どこ投げてるの〜','おしい!']), 'surprise', { voice:false, ms:2500 }); }

  function dropAway(el) { el.style.transition = 'transform .6s ease-in, opacity .6s'; el.style.opacity = 0; el.style.transform += ' translateY(160px)'; setTimeout(() => el.remove(), 650); }
  function eat(f, el, x, y) {
    touched();
    if (P.sleeping) { dropAway(el); A.showBubble('すぅ…すぅ…(寝てる)', '', 2500); return; }
    if (P.hunger >= 95) { dropAway(el); A.say(pick(['もうおなかいっぱい…','もう食べられないよ〜']), 'no'); return; }
    const [hx, hy] = A.headPoint();
    el.classList.add('eaten'); el.style.transform = `translate(${hx - 28}px, ${hy - 28}px) scale(.3)`;
    setTimeout(() => el.remove(), 400);
    const isFav = f.id === P.fav;
    const sweetRun = f.sweet && P.recent.slice(-2).every(id => FOODS.find(g => g.id === id)?.sweet) && P.recent.length >= 2;
    P.recent.push(f.id); if (P.recent.length > 5) P.recent.shift();
    P.hunger = clamp(P.hunger + f.h);
    P.mood = clamp(P.mood + f.m + (isFav ? 15 : 0) - (sweetRun ? 12 : 0));
    if (f.en) P.energy = clamp(P.energy + f.en);
    P.fed++; gainXp(isFav ? 8 : f.healthy ? 4 : 3);
    for (let i = 0; i < 4; i++) setTimeout(() => particle(isFav ? '💗' : pick(['✨','💫']), hx + (Math.random() - .5) * 80, hy), 300 + i * 120);
    let line, anim = 'eat';
    if (isFav) { line = `${f.n}だ!大好物なんだ!`; anim = 'happy'; if (!P.favKnown) { P.favKnown = true; setTimeout(() => A.toast(`大好物を見つけた!${f.e}${f.n}`), 1500); } }
    else if (sweetRun) { line = '甘いものばっかり…ちょっと気持ち悪い'; anim = 'sad'; }
    else if (f.healthy) { line = pick(['うぇ…にがい…でも体にいいもんね','ブロッコリーかぁ…']); anim = 'sad'; }
    else line = pick([`もぐもぐ…${f.n}おいしい!`, 'いただきます!', 'うまっ!', 'おいしい〜!']);
    setTimeout(() => A.say(line, anim), 350);
    hud(); save();
  }

  /* ---------- なでる・つつく ---------- */
  let strokeAcc = 0, lastPetReact = 0, pokes = [];
  A.hooks.stroke = (d, x, y) => {
    touched(); strokeAcc += d;
    if (strokeAcc < 220) return;
    strokeAcc = 0; P.petted++; P.mood = clamp(P.mood + 3); gainXp(1);
    particle(P.sleeping ? '💤' : pick(['💗','💕','✨']), x, y);
    if (now() - lastPetReact > 2500) {
      lastPetReact = now();
      if (P.sleeping) A.showBubble(pick(['すぅ…むにゃ…','えへへ…(寝言)']), '', 2500);
      else A.say(pick(['えへへ','くすぐったい!','もっとなでて〜','気持ちいい〜']), 'pet');
    }
    save();
  };
  A.hooks.poke = () => {
    touched();
    if (P.sleeping) { wake(false); return; }
    pokes = pokes.filter(t => now() - t < 5000); pokes.push(now());
    if (pokes.length >= 4) { P.mood = clamp(P.mood - 3); A.say(pick(['もう!つつかないで!','いたいってば〜!']), 'no'); }
    else A.say(pick(['なに?','どうしたの?','ん?','呼んだ?']), 'surprise');
    hud(); save();
  };
  A.hooks.walk = touched;
  A.hooks.shot = () => { touched(); gainXp(1); };
  A.hooks.selfiePose = () => { touched(); A.say(pick(['はい、チーズ!','いえーい!','かっこよく撮ってね!']), pick(['happy','greet','yes','dance'])); gainXp(2); };

  /* ---------- 会話 ---------- */
  A.hooks.persona = () => `あなたの名前は${P.name}。今の状態は、おなか${Math.round(P.hunger)}/100、きげん${Math.round(P.mood)}/100、げんき${Math.round(P.energy)}/100。相手とのなかよし度は「${title(lvOf(P.xp))}」。状態に合った口調で答えてください。`;
  A.hooks.intercept = text => {
    touched();
    const t = text.toLowerCase();
    if (P.sleeping) {
      if (/起きて|おきて|朝だよ|あさだよ/.test(t)) { wake(false); return true; }
      A.showBubble(pick(['むにゃ…','すぅ…すぅ…','zzz…']), '「' + text + '」', 3000); return true;
    }
    if (/おなか|お腹|腹減|はらへ|すいた|空いた|ごはん|ご飯/.test(t)) {
      if (P.hunger < 30) A.say('おなかペコペコ…ごはんちょうだい!', 'sad');
      else if (P.hunger < 70) A.say('ちょっとすいたかも', 'yes');
      else A.say('おなかいっぱい!', 'happy');
      return true;
    }
    if (/眠い|ねむい|寝よ|ねよ|おやすみ/.test(t)) {
      if (P.energy > 85) A.say('まだ眠くないよ!', 'no'); else sleep();
      return true;
    }
    if (/元気|げんき|調子|大丈夫|だいじょうぶ|機嫌|きげん/.test(t)) {
      const m = P.mood, e = P.energy;
      if (e < 25) A.say('ちょっと疲れてるかも…', 'sad');
      else if (m < 30) A.say('…ちょっとさみしかった', 'sad');
      else if (m > 75) A.say('めっちゃ元気!', 'happy');
      else A.say('ふつうに元気だよ', 'yes');
      return true;
    }
    if (/名前|なまえ/.test(t)) { A.say(`${P.name}だよ!`, 'greet'); return true; }
    if (/好きな食べ|大好物|好物/.test(t)) {
      const f = FOODS.find(g => g.id === P.fav);
      A.say(P.favKnown ? `${f.n}が大好き!` : 'ひみつ!いろいろ食べさせてみて!', P.favKnown ? 'happy' : 'no'); return true;
    }
    if (/何日|なんにち|いつから/.test(t)) { A.say(`一緒に${days()}日目だね!`, 'happy'); return true; }
    if (/ただいま/.test(t)) { A.say('おかえり!待ってたよ!', 'happy'); P.mood = clamp(P.mood + 5); gainXp(2); return true; }
    return false;
  };
  A.hooks.adjust = r => {
    if (P.hunger < 20 && Math.random() < .5) r.reply += '…あと、おなかすいた';
    else if (P.mood < 20 && Math.random() < .5) { r.reply = pick(['ふーんだ','…べつに']); r.intent = 'no'; }
    return r;
  };
  let talkXp = [];
  A.hooks.afterTalk = () => {
    P.talked++; P.mood = clamp(P.mood + 1);
    talkXp = talkXp.filter(t => now() - t < 60e3);
    if (talkXp.length < 8) { talkXp.push(now()); gainXp(1); }
    save();
  };

  /* ---------- 出迎え・ひとりごと ---------- */
  A.hooks.started = () => {
    tick(); $('hud').hidden = false; hud();
    if (P.sleeping) { A.setBaseFx(sleepFx); A.showBubble('すぅ…すぅ…', '', 3000); return; }
    const away = (now() - prevSeen) / HOUR, hr = new Date().getHours(), today = new Date().toDateString();
    let line, anim = 'greet';
    if (!P.met) { P.met = true; line = `はじめまして!${P.name}だよ。これからよろしくね!`; }
    else if (P.lastGreetDay !== today && hr >= 5 && hr < 11) line = 'おはよう!';
    else if (away >= 24) { line = `ひさしぶり!${Math.floor(away / 24)}日も会えなくてさみしかった…`; anim = 'sad'; }
    else if (away >= 3) line = `おかえり!${Math.round(away)}時間ぶりだね!`;
    else line = pick(['あ、きた!','やっほー!']);
    P.lastGreetDay = today;
    setTimeout(() => A.say(line, anim), 600);
    if (P.hunger < 30) setTimeout(() => A.say('おなかすいた…ごはんほしいな', 'sad'), 4500);
    setTimeout(() => A.toast('1本指でなでる / タップでつつく / 2本指で移動'), 1200);
    save();
  };
  setInterval(() => {
    if (!A.state.started || A.state.selfie || document.hidden || P.sleeping || !$('chatter').checked) return;
    if (now() - lastAct < 45e3 || Math.random() > .35) return;
    const hr = new Date().getHours();
    let line, anim;
    if (P.hunger < 30) [line, anim] = ['おなかすいたな…', 'sad'];
    else if (P.energy < 25) [line, anim] = ['ねむい…', 'sad'];
    else if (P.mood < 30) [line, anim] = ['かまってよ〜', 'sad'];
    else if (hr >= 23 || hr < 5) [line, anim] = ['もう遅いよ、そろそろ寝よう?', 'yes'];
    else [line, anim] = pick([['ひま〜','no'],['ねえねえ','greet'],['今日なにしてたの?','yes'],['あそぼ!','happy'],['ふんふ〜ん♪','dance'],['ここ、いい場所だね','yes']]);
    A.say(line, anim, { voice:false, ms:4000 }); lastAct = now();
  }, 15e3);

  /* ---------- 設定 ---------- */
  $('nameInput').value = P.name === 'ぼく' ? '' : P.name;
  $('nameInput').onchange = e => { P.name = e.target.value.trim() || 'ぼく'; hud(); save(); };
  $('resetBtn').onclick = () => {
    if (!confirm('育成データを消して、最初からやり直しますか?')) return;
    try { localStorage.removeItem(KEY); } catch (_) {}
    P = def(); save(); hud(); A.setBaseFx(null); A.toast('リセットしました');
  };

  /* ---------- 通知(サーバーなし) ---------- */
  let notifyCfg = { on:false, last:{} };
  A.idb.get('notify').then(c => { if (c) { notifyCfg = c; $('notifyOn').checked = !!c.on; } }).catch(() => {});
  $('notifyOn').onchange = async e => {
    if (e.target.checked) {
      if (!('Notification' in window) || !('serviceWorker' in navigator)) { e.target.checked = false; A.toast('この端末は通知に未対応です'); return; }
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { e.target.checked = false; A.toast('通知が許可されませんでした'); return; }
      notifyCfg.on = true; await A.idb.set('notify', notifyCfg).catch(() => {});
      const reg = await navigator.serviceWorker.ready;
      if ('periodicSync' in reg) {
        try { await reg.periodicSync.register('pet-check', { minInterval: 2 * HOUR }); A.toast('アプリを閉じていても、おなかがすいたら通知します'); }
        catch (_) { A.toast('閉じている間の通知は、ホーム画面に追加すると使えます'); }
      } else A.toast('この端末では、アプリを開いている間だけ通知します');
    } else {
      notifyCfg.on = false; A.idb.set('notify', notifyCfg).catch(() => {});
      navigator.serviceWorker && navigator.serviceWorker.ready.then(r => r.periodicSync && r.periodicSync.unregister('pet-check')).catch(() => {});
    }
  };
  // 別のアプリを見ている間(このアプリは裏で開いたまま)も確認する
  setInterval(() => {
    if (document.hidden && notifyCfg.on && navigator.serviceWorker && navigator.serviceWorker.controller) { save(); navigator.serviceWorker.controller.postMessage('pet-check'); }
  }, 5 * 60e3);

  /* ---------- ホーム画面に追加 ---------- */
  let installEvt = null;
  addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; $('installBtn').hidden = false; });
  $('installBtn').onclick = async () => { if (!installEvt) return; installEvt.prompt(); await installEvt.userChoice.catch(() => {}); installEvt = null; $('installBtn').hidden = true; };

  /* ---------- バックアップ・復元(ファイルで受け渡し) ---------- */
  $('backupBtn').onclick = () => {
    save();
    const blob = new Blob([JSON.stringify({ app:'you-ar', v:1, savedAt:now(), pet:P }, null, 1)], { type:'application/json' });
    const d = new Date(), ymd = d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `you-ar-backup-${ymd}.json`; a.click();
    A.toast('バックアップを保存しました');
  };
  $('restoreFile').onchange = async e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    try {
      const j = JSON.parse(await f.text());
      if (j.app !== 'you-ar' || !j.pet || j.pet.v !== 1) throw new Error('形式が違います');
      if (!confirm(`${new Date(j.savedAt).toLocaleString()} のバックアップで上書きしますか?`)) return;
      P = Object.assign(def(), j.pet); P.lastTick = now(); // 復元した時点から時間を進める
      save(); hud(); buildTray(); A.setBaseFx(P.sleeping && A.state.started ? sleepFx : null);
      $('nameInput').value = P.name === 'ぼく' ? '' : P.name;
      A.toast('復元しました');
    } catch (err) { A.toast('復元できません: ' + err.message); }
  };

  setInterval(tick, 30e3);
  document.addEventListener('visibilitychange', () => { if (document.hidden) save(); else tick(); });
  addEventListener('pagehide', save);
  tick(); hud(); buildTray();

  window.YouARPet = { get data() { return P; }, tick, save }; // デバッグ用
})();
