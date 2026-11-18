/* You AR — ルームメイト
 * 世話をする相手ではなく、同じ部屋で暮らす友達。自分の生活リズムがあり、範囲の中をうろうろし、
 * 話したことを覚え、おやつ・じゃんけん・ハイタッチなどを一緒にする。数値は画面に出さない。
 * すべて端末の中(localStorage / IndexedDB)で動き、サーバーは使わない。 */
(() => {
  const A = window.YouAR, $ = A.$, pick = A.pick;
  const KEY = 'youar.rm.v2', HOUR = 3600e3, DAY = 24 * HOUR;
  const now = () => Date.now();
  const clamp = v => Math.max(0, Math.min(100, v));
  const rnd = (a, b) => a + Math.random() * (b - a);
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const dbg = { night:null };

  /* ---------- 保存データ ---------- */
  const SNACKS = [{ e:'🍪', n:'クッキー' }, { e:'🍘', n:'せんべい' }, { e:'🍫', n:'チョコ' }, { e:'🍦', n:'アイス' },
                  { e:'🍊', n:'みかん' }, { e:'🍵', n:'お茶' }, { e:'🍙', n:'おにぎり' }, { e:'🍟', n:'ポテト' }];
  const COLORS = ['青', '緑', '赤', '黒', 'オレンジ'], MUSIC = ['昔のJ-POP', 'ジャズっぽいやつ', 'ローファイ', 'アニソン', 'ロック'];
  const def = () => ({
    v:2, name:'ルームメイト', userName:'', firstMet:now(), lastSeen:now(), visits:0, met:false,
    mood:70, energy:70, bond:0, fav:pick(SNACKS).n, color:pick(COLORS), music:pick(MUSIC),
    facts:[], log:[], shared:0, lastSnack:'', janken:{ w:0, l:0, d:0 }, lastGreetDay:''
  });
  let R = load();
  function load() { try { const j = JSON.parse(localStorage.getItem(KEY)); if (j && j.v === 2) return Object.assign(def(), j); } catch (_) {} return def(); }
  const prevSeen = R.lastSeen; // 前回このアプリを閉じた時刻(出迎えに使う)
  function save() {
    R.lastSeen = now();
    try { localStorage.setItem(KEY, JSON.stringify(R)); } catch (_) {}
    A.idb.set('rm', { name:R.name, userName:R.userName, lastSeen:R.lastSeen }).catch(() => {}); // sw.js(閉じている間の通知)が読む
  }
  const U = () => R.userName;
  const days = () => Math.floor((now() - R.firstMet) / DAY) + 1;

  /* ---------- 時間帯・睡眠 ---------- */
  const hr = () => new Date().getHours();
  const part = () => { const h = hr(); return h >= 5 && h < 10 ? 'morning' : h >= 10 && h < 17 ? 'day' : h >= 17 && h < 22 ? 'evening' : 'night'; };
  const dayKey = () => { const d = new Date(); if (d.getHours() < 5) d.setDate(d.getDate() - 1); return d.toDateString(); };
  function bedtime() { let h = 0; for (const ch of dayKey()) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return 23 + (h % 6) * .5; } // 日によって23:00〜25:30
  function isNight() {
    if (dbg.night != null) return dbg.night;
    const d = new Date(), x = d.getHours() + d.getMinutes() / 60, z = x < 7 ? x + 24 : x;
    return z >= bedtime();
  }
  const timeStr = () => { const d = new Date(); return `${d.getHours()}時${d.getMinutes()}分`; };
  const moodWord = () => R.mood > 70 ? '上機嫌' : R.mood < 35 ? '少し落ち込み気味' : 'ふつう';

  /* ---------- 演出の部品 ---------- */
  function particle(emoji, x, y, cls = '') {
    const p = document.createElement('div'); p.className = 'particle ' + cls; p.textContent = emoji;
    p.style.setProperty('--x', x - 14 + 'px'); p.style.setProperty('--y', y - 14 + 'px'); p.style.setProperty('--dx', (Math.random() - .5) * 60 + 'px');
    $('fxLayer').append(p); setTimeout(() => p.remove(), 2600);
  }
  function pop(emoji, x, y, tappable) {
    const el = document.createElement('div'); el.className = 'pop' + (tappable ? ' tappable' : ''); el.textContent = emoji;
    el.style.setProperty('--tx', x - 30 + 'px'); el.style.setProperty('--ty', y - 30 + 'px'); el.style.transform = `translate(${x - 30}px, ${y - 30}px)`;
    document.body.append(el); return el;
  }
  const unpop = el => { el.style.transition = 'opacity .4s'; el.style.opacity = 0; setTimeout(() => el.remove(), 450); };
  const say = (t, intent, o = {}) => A.say(t, intent, o);

  /* ---------- 覚えていること ---------- */
  function addFact(kind, text, key) {
    key = key || kind + ':' + text;
    if (R.facts.some(f => f.key === key)) return;
    R.facts.push({ key, kind, text, at:now(), asked:0 });
    if (R.facts.length > 40) R.facts.shift();
    save(); renderFacts();
  }
  const short = t => t.length > 24 ? t.slice(0, 24) + '…' : t;
  const EVENTS = ['仕事', 'バイト', '学校', '授業', 'テスト', '試験', '面接', '旅行', 'デート', '誕生日', '病院', 'ライブ', '試合', '発表', '出張', '引っ越し', 'レポート', '締め切り', '飲み会', '帰省'];
  function learn(t) {
    if (/君|あなた|きみ|お前|そっち/.test(t)) return;
    let m = t.match(/(?:(?:僕|私|俺|わたし|おれ|ぼく|あたし)の)?名前は([^?？\s。!!]{1,10}?)(?:です|だよ|っていう|といいます|$)/) || t.match(/([^?？\s。!!]{1,10}?)(?:って|と)呼んで/);
    if (m) { R.userName = m[1]; $('userNameInput').value = R.userName; addFact('name', '名前は' + R.userName, 'name'); }
    if ((m = t.match(/(.{1,12}?)(?:が|は|も)(?:大?好き|すき)/))) addFact('like', m[1] + 'が好き');
    if ((m = t.match(/(.{1,12}?)(?:が|は)(?:大?嫌い|きらい|苦手|にがて)/))) addFact('dislike', m[1] + 'が苦手');
    const ev = EVENTS.find(k => t.includes(k));
    if (ev && /(明日|あした|今日|昨日|来週|今週|週末|あさって|今度|これから)/.test(t)) addFact('event', short(t), 'ev:' + ev + ':' + dayKey());
    if (/疲れ|つかれ|しんどい|だるい|眠い|ねむい/.test(t)) addFact('feel', '疲れてた', 'feel:' + dayKey());
  }
  const KIND = { name:'🏷️', like:'💗', dislike:'💦', event:'📅', feel:'🫠', shared:'🍪', ai:'💭' };
  function renderFacts() {
    const box = $('factList'); box.textContent = '';
    if (!R.facts.length) { box.innerHTML = '<p>まだ何も覚えていません。話してみてね。</p>'; return; }
    R.facts.slice().reverse().forEach(f => {
      const row = document.createElement('div'); row.className = 'factRow';
      const s = document.createElement('span'); s.textContent = (KIND[f.kind] || '💭') + ' ' + f.text;
      const b = document.createElement('button'); b.className = 'sub'; b.textContent = '消す';
      b.onclick = () => { R.facts = R.facts.filter(x => x !== f); save(); renderFacts(); };
      row.append(s, b); box.append(row);
    });
  }
  // 少し前に話したことを、あとで聞き返す
  function followUp() {
    const f = R.facts.find(x => (x.kind === 'event' || x.kind === 'feel') && !x.asked && now() - x.at > 3 * HOUR && now() - x.at < 4 * DAY);
    if (!f) return null;
    f.asked++; save();
    return f.kind === 'event' ? `そういえば「${f.text}」って言ってたけど、どうだった?` : 'そういえば前に疲れてたけど、最近はどう?';
  }

  /* ---------- 睡眠 ---------- */
  let sleepApplied = false, awakeUntil = 0, asleepTaps = [];
  const sleepFx = t => ({ dy:(14 + Math.sin(t / 900) * 4) * A.state.s, sy:.95 + Math.sin(t / 900) * .015, rot:.07 });
  const sleeping = () => sleepApplied;
  function syncSleep() {
    const want = awakeUntil < now() && isNight();
    if (want && !sleepApplied) { sleepApplied = true; A.stopWalk(); clearAct(); A.setBaseFx(sleepFx); A.setExpr('neutral'); document.body.classList.add('sleeping'); }
    else if (!want && sleepApplied) {
      sleepApplied = false; A.setBaseFx(null); document.body.classList.remove('sleeping');
      if (A.state.started && !A.state.selfie) say(pick(['ふぁ〜、おはよ…', 'ん…朝か…おはよう']), 'yes');
    }
  }
  function wakeUp() {
    awakeUntil = now() + 40 * 60e3; sleepApplied = false; asleepTaps = [];
    A.setBaseFx(null); document.body.classList.remove('sleeping'); R.mood = clamp(R.mood - 5);
    say(pick(['ふぁ…もう、しょうがないなぁ。どうしたの?', 'んん…起きた起きた。なに?']), 'surprise'); save();
  }
  function asleepReact() {
    asleepTaps = asleepTaps.filter(t => now() - t < 3 * 60e3); asleepTaps.push(now());
    if (asleepTaps.length >= 3) return wakeUp();
    say(pick(['…ん…あと5分…', 'むにゃ…', 'すぅ…すぅ…', '…あした…']), 'yes', { voice:false, ms:3000 });
  }
  setInterval(() => { if (sleepApplied && A.state.started && !document.hidden && !A.state.selfie) { const [x, y] = A.headPoint(); particle(pick(['z', 'Z', 'z']), x + 20, y - 10, 'z'); } }, 1800);

  /* ---------- 暮らし(うろうろ・好きなこと) ---------- */
  const ACTS = [
    { id:'read',    e:'📖', doing:'本読んでる',       lines:['本、読んでる', 'これ、続きが気になって'],      when:'morning day evening' },
    { id:'phone',   e:'📱', doing:'スマホ見てる',     lines:['動画見てた', 'ちょっとSNS見てた'],            when:'day evening night' },
    { id:'music',   e:'🎧', doing:'音楽聴いてる',     lines:['いい曲見つけた', 'いまこれ聴いてるんだ'],      when:'morning day evening night' },
    { id:'game',    e:'🎮', doing:'ゲームしてる',     lines:['ゲームしてた', 'あとちょっとでクリアなんだよね'], when:'day evening night' },
    { id:'tea',     e:'🍵', doing:'お茶飲んでる',     lines:['お茶いれた', 'ちょっと休憩'],                 when:'morning day evening' },
    { id:'stretch', e:'🙆', doing:'ストレッチしてる', lines:['体バキバキだわ', 'ストレッチ〜'],             when:'morning day evening' },
    { id:'window',  e:'🪟', doing:'外ぼーっと見てる', lines:['外見てた、いい天気', 'なんか空きれい'],        when:'morning day evening' },
    { id:'yawn',    e:'🥱', doing:'ぼーっとしてる',   lines:['ねむ…'],                                     when:'morning night' },
    { id:'cook',    e:'🍳', doing:'ごはん作ってる',   lines:['なんか作ってる', '今日はちょっと凝ってみた'], when:'morning evening' },
  ];
  let cur = null, locked = false, nextAt = now() + 6000, lastAct = now();
  const touch = () => { lastAct = now(); nextAt = Math.max(nextAt, now() + 9000); };
  const doing = () => sleeping() ? '寝てた' : cur ? cur.doing : 'ぼーっとしてる';
  function clearAct() { cur = null; }
  async function task(fn) {
    if (locked) return; locked = true; A.stopWalk(); clearAct();
    try { await fn(); } catch (e) { console.error(e); } finally { locked = false; nextAt = now() + rnd(12e3, 25e3); }
  }
  const ready = () => A.state.started && !A.state.selfie && A.zone.on && !document.hidden;

  async function life() {
    if (!ready()) return;
    syncSleep();
    if (sleeping() || locked || now() < nextAt) return;
    locked = true;
    try {
      if (cur && now() > cur.until) cur = null;
      if (Math.random() < .6) { cur = null; const [x, y] = A.zoneRandom(); await A.walkWorld(x, y); }
      if (!sleeping() && Math.random() < .6) {
        const a = pick(ACTS.filter(a => a.when.includes(part())));
        cur = Object.assign({}, a, { until:now() + rnd(20e3, 50e3) });
        if (Math.random() < .3 && $('chatter').checked) say(pick(a.lines), 'yes', { voice:false, ms:3500 });
      }
    } finally { locked = false; nextAt = now() + rnd(8e3, 22e3); }
  }
  setInterval(life, 2500);
  // 好きなことをしているときのマークを、頭の横に出す
  const icon = $('actIcon');
  (function iconLoop() {
    if (cur && ready() && !sleeping() && !A.state.walking) {
      const [hx, hy] = A.headPoint(); icon.hidden = false; icon.textContent = cur.e;
      icon.style.left = hx + 70 * A.state.s + 'px'; icon.style.top = hy + 30 * A.state.s + 'px';
    } else icon.hidden = true;
    requestAnimationFrame(iconLoop);
  })();

  /* ---------- いっしょに(友達同士の行動) ---------- */
  const comeFront = async () => { const [fx, fy] = A.zoneFront(true); await A.walkWorld(fx, fy); };
  const userSpot = () => [innerWidth / 2, innerHeight - 250];
  const bond = n => { R.bond += n; R.mood = clamp(R.mood + n); };

  async function snack(sn) {
    await task(async () => {
      if (sleeping()) return asleepReact();
      await comeFront();
      const fav = sn.n === R.fav;
      say(fav ? `${sn.n}!? 僕これ大好きなんだよね!` : pick([`お、${sn.n}いいね!`, `${sn.n}か〜、もらうね`, `ちょうど何か食べたかった!`]), 'happy');
      await wait(1700);
      const [ux, uy] = userSpot(), [hx, hy] = A.headPoint();
      const mine = pop(sn.e, ux, uy), his = pop(sn.e, hx + 10, hy + 70 * A.state.s);
      say(pick(['いただきます!', 'じゃあ、いただきまーす']), 'eat'); await wait(1500);
      A.play('eat'); particle('✨', hx, hy); await wait(1300);
      unpop(mine); unpop(his);
      say(pick(['もぐもぐ…おいしい', 'うまっ', fav ? 'やっぱこれだわ〜' : 'これ、いいね']), 'happy'); await wait(2400);
      R.shared++; R.lastSnack = sn.n; bond(3);
      if (R.shared === 1) addFact('shared', `最初に一緒に食べたのは${sn.n}`, 'shared:first');
      say(pick(['また一緒に食べようね', 'ひとりで食べるより、おいしいね', `次は${pick(SNACKS.filter(x => x !== sn)).n}にしよっか`]), 'yes'); save();
    });
  }
  async function shoulderTap() {
    if (sleeping()) return asleepReact();
    await task(async () => {
      A.play('surprise'); say(pick(['わっ、びっくりした!なに?', 'ん?どうした?', 'お、なになに?']), 'surprise'); await wait(2400);
      bond(1);
      const q = followUp() || pick(['今日どんな一日だった?', '最近ハマってることある?', '晩ごはん、何にする?', '休みの日って何してるの?', '最近よく眠れてる?']);
      pending = { type:'q', until:now() + 5 * 60e3 }; say(q, 'yes'); save();
    });
  }
  async function massage() {
    await task(async () => {
      if (sleeping()) return asleepReact();
      await comeFront();
      say('肩、もんであげるよ。ほら後ろ向いて', 'happy'); await wait(2000);
      const [ux, uy] = userSpot(), h = pop('💆', ux, uy - 40);
      for (const l of ['うわ、けっこう凝ってるね', 'ここ?ここがいい?', 'どう?気持ちいい?']) { say(l, 'pet', { voice:false, ms:2600 }); particle('✨', ux + rnd(-60, 60), uy - 40); await wait(2700); }
      unpop(h); say('はい、おしまい!おつかれさま', 'happy'); bond(4); save();
    });
  }
  async function highFive() {
    await task(async () => {
      if (sleeping()) return asleepReact();
      await comeFront(); say('ハイタッチしよ!せーの…', 'yes'); await wait(1500);
      const hand = pop('✋', innerWidth * (.3 + Math.random() * .4), innerHeight * .36, true);
      say('ほらここ!早く!', 'surprise', { voice:false, ms:1800 });
      const hit = await new Promise(res => { hand.onclick = () => res(true); setTimeout(() => res(false), 1700); });
      if (hit) { hand.remove(); particle('✨', innerWidth / 2, innerHeight * .36); say('イェーイ!', 'happy'); bond(2); }
      else { unpop(hand); say('あれ?ミスった笑 もう一回やる?', 'no'); pending = { type:'highfive', until:now() + 2 * 60e3 }; }
      save();
    });
  }
  const HANDS = { g:'✊', c:'✌️', p:'✋' };
  async function janken() {
    await task(async () => {
      if (sleeping()) return asleepReact();
      await comeFront(); say('じゃんけんしよ!', 'happy'); await wait(1400);
      const tray = $('acts');
      for (let round = 0; round < 12; round++) {
        say('最初はグー!じゃんけん…', 'yes', { voice:false, ms:5000 });
        const mine = await new Promise(res => {
          tray.textContent = ''; tray.hidden = false;
          for (const k of ['g', 'c', 'p']) { const b = document.createElement('button'); b.className = 'item'; b.textContent = HANDS[k]; b.onclick = () => res(k); tray.append(b); }
          const h = document.createElement('div'); h.className = 'actHint'; h.textContent = 'どれを出す?'; tray.append(h);
          setTimeout(() => res(null), 15000);
        });
        tray.hidden = true; if (!mine) { say('あれ、やめちゃう?', 'no'); break; }
        const his = pick(['g', 'c', 'p']), [ux, uy] = userSpot(), [hx, hy] = A.headPoint();
        const a = pop(HANDS[mine], ux, uy), b = pop(HANDS[his], hx, hy - 40 * A.state.s);
        const win = (mine === 'g' && his === 'c') || (mine === 'c' && his === 'p') || (mine === 'p' && his === 'g');
        const res = mine === his ? 'd' : win ? 'w' : 'l'; R.janken[res]++;
        await wait(300);
        if (res === 'd') say(pick(['あいこか!もう一回!', 'おお、同じ!']), 'surprise');
        else if (res === 'w') say(pick(['くっそー、負けた!', 'やるじゃん!', 'うわ、負けたー']), 'sad');
        else say(pick(['やった、勝った!', 'いえーい、僕の勝ち!', 'ふふん、まだまだだね']), 'happy');
        await wait(2400); unpop(a); unpop(b);
        if (res !== 'd') { bond(1); if (!(await again())) break; }
      }
      tray.hidden = true; save();
      const j = R.janken, n = j.w + j.l; if (n >= 3) say(`通算、あなたの${j.w}勝${j.l}敗だね`, 'yes', { voice:false });
    });
  }
  // 「もう一回」か「おしまい」
  const again = () => new Promise(res => {
    const tray = $('acts'); tray.textContent = ''; tray.hidden = false;
    const go = (v) => () => { tray.hidden = true; res(v); };
    const b1 = document.createElement('button'); b1.className = 'act'; b1.textContent = 'もう一回!'; b1.onclick = go(true);
    const b2 = document.createElement('button'); b2.className = 'act sub'; b2.textContent = 'おしまい'; b2.onclick = go(false);
    tray.append(b1, b2); setTimeout(go(false), 12000);
  });
  async function stroll() {
    await task(async () => {
      if (sleeping()) return asleepReact();
      for (let i = 0; i < 3; i++) { const [x, y] = A.zoneRandom(); if (!(await A.walkWorld(x, y))) return; await wait(700); }
      say(pick(['ちょっとスッキリした', 'たまには歩かないとね']), 'happy', { voice:false });
    });
  }

  /* ---------- メニュー ---------- */
  const acts = $('acts');
  function menu() {
    acts.textContent = '';
    const items = [['🍪 おやつ', snackMenu], ['👋 肩をたたく', shoulderTap], ['💆 肩をもんでもらう', massage], ['✋ ハイタッチ', highFive], ['✌️ じゃんけん', janken]];
    for (const [label, fn] of items) { const b = document.createElement('button'); b.className = 'act'; b.textContent = label; b.onclick = () => { fn === snackMenu ? fn() : (acts.hidden = true, fn()); }; acts.append(b); }
  }
  function snackMenu() {
    acts.textContent = '';
    for (const sn of SNACKS) { const b = document.createElement('button'); b.className = 'item'; b.textContent = sn.e; b.title = sn.n; b.onclick = () => { acts.hidden = true; snack(sn); }; acts.append(b); }
    const h = document.createElement('div'); h.className = 'actHint'; h.textContent = '一緒に食べるおやつを選んでね'; acts.append(h);
  }
  $('actBtn').onclick = () => { touch(); if (acts.hidden) { menu(); acts.hidden = false; } else acts.hidden = true; };

  /* ---------- ジェスチャへの反応 ---------- */
  let strokeAcc = 0, lastStroke = 0;
  A.hooks.stroke = (d, x, y) => {
    touch(); strokeAcc += d; if (strokeAcc < 240) return; strokeAcc = 0;
    if (sleeping()) { particle('💤', x, y); return; }
    R.mood = clamp(R.mood + 2); R.bond += .5; particle(pick(['✨', '💆']), x, y);
    if (now() - lastStroke > 3500 && !locked) { lastStroke = now(); say(pick(['あ〜そこそこ', 'うまいじゃん', 'きもちいい〜', 'ちょっ、くすぐったいって笑']), 'pet', { voice:false, ms:2500 }); }
  };
  A.hooks.poke = () => { touch(); shoulderTap(); };
  A.hooks.call = async (wx, wfy) => {
    touch();
    if (sleeping()) { asleepReact(); return; }
    await task(async () => { const ok = await A.walkWorld(wx, wfy); if (ok) say(pick(['呼んだ?', 'なになに?', 'はいはーい', 'お、どうした?']), 'greet'); });
  };
  A.hooks.walk = () => { cur = null; };
  A.hooks.baseExpr = () => (!sleeping() && R.mood > 82) ? 'smile' : 'neutral'; // 機嫌がとてもいいときは、普段から笑顔
  A.hooks.zoneChanged = () => { cur = null; nextAt = now() + 4000; say('おお、ここが僕の居場所ね', 'happy'); };

  /* ---------- 会話 ---------- */
  let pending = null, recent = [], talkCount = 0;
  const fresh = arr => { const a = arr.filter(x => !recent.includes(x)); const r = pick(a.length ? a : arr); recent.push(r); if (recent.length > 10) recent.shift(); return r; };
  const OWN = ['最近あのお店のパン気になってるんだよね', '昨日、変な夢みた', '今度の休み、何しよっかなって考えてた', 'コンビニの新しいアイス、うまそうだった', 'なんか急に掃除したくなってきた', 'さっき窓の外、猫がいたよ'];
  const BACK = ['へえ、そうなんだ', 'なるほどね〜', 'それでそれで?', 'うんうん', 'まじか', 'いいじゃん'];
  const QUESTIONS = ['今日どんな一日だった?', 'そっちは最近どう?', '晩ごはん、何にする?', '最近ハマってることある?'];

  function rules(t) {
    const has = re => re.test(t), u = U() ? U() + '、' : '', ask = has(/[?？]|かな|かい$/);
    // --- 返事待ちへの答え
    if (pending && pending.until > now()) {
      const p = pending, yes = /^(うん|はい|いいよ|お願い|頼む|オッケー|ok|もちろん|ぜひ|やる|やろう|する)/i.test(t), no = /^(いや|ううん|大丈夫|いい(よ|です)?$|やめとく|結構|いらない)/.test(t);
      const stripped = t.replace(/^(僕|俺|私|わたし|ぼく|おれ)は/, '').replace(/(です|だよ|って呼んで|でいい|で)$/, '');
      const notName = /ありがと|こんにち|おはよ|こんばん|^うん|^はい|いいよ|よろしく|ごめん|すごい|かわいい|ただいま|おやすみ|なんで|いや|わからない|こと|あった|した|たい|ない|から|けど|ました|いる|する|悲|嬉|楽|疲|好き|嫌い|今日|明日|昨日/.test(t)
        || stripped.length > 8 || (/[がをに]/.test(stripped) && stripped.length > 3);
      if (p.type === 'askName' && notName) pending = null;   // 名前らしくない答えなら、名前を聞くのはやめて普通に会話する
      if (p.type === 'askName' && t.length <= 10 && !ask && !notName) { pending = null; R.userName = t.replace(/^(僕|俺|私|わたし|ぼく|おれ)は/, '').replace(/(です|だよ|って呼んで|でいい|で)$/, '').replace(/[。.!!]/g, ''); $('userNameInput').value = R.userName; addFact('name', '名前は' + R.userName, 'name'); return { reply:`${R.userName}ね、覚えた!よろしく`, intent:'happy' }; }
      if (yes && p.type === 'massage') { pending = null; return { reply:'じゃ、失礼して…', intent:'happy', after:massage }; }
      if (yes && p.type === 'snack') { pending = null; return { reply:'やった!どれにする?', intent:'happy', after:() => { menu(); snackMenu(); acts.hidden = false; } }; }
      if (yes && p.type === 'play') { pending = null; return { reply:'よし、勝負だ!', intent:'happy', after:janken }; }
      if (yes && p.type === 'highfive') { pending = null; return { reply:'今度こそ!', intent:'yes', after:highFive }; }
      if (no && p.type !== 'q') { pending = null; return { reply:pick(['そっか、またいつでも言ってね', 'りょうかい']), intent:'yes' }; }
      if (p.type === 'q') pending = null;
    }
    // --- あいさつ
    if (has(/おはよう/)) return { reply:part() === 'morning' ? u + 'おはよ!よく眠れた?' : 'おはよ…って、もう朝じゃないけどね笑', intent:'greet' };
    if (has(/こんにちは/)) return { reply:u + pick(['やあ!', 'こんちは〜', 'おっ、こんにちは']), intent:'greet' };
    if (has(/こんばんは/)) return { reply:u + 'こんばんは〜', intent:'greet' };
    if (has(/ただいま/)) { bond(2); return { reply:u + (hr() >= 21 ? 'おかえり、遅かったね。おつかれ' : 'おかえり!おつかれ〜'), intent:'happy' }; }
    if (has(/いってきます|行ってきます/)) return { reply:'いってらっしゃい!気をつけてね', intent:'bye' };
    if (has(/おやすみ/)) return { reply:isNight() || hr() >= 21 ? 'おやすみ〜、また明日ね' : 'え、もう寝るの?早くない?笑', intent:'bye' };
    if (has(/おつかれ|お疲れ/)) return { reply:'おつかれ〜!今日もよくやったね', intent:'happy' };
    if (has(/バイバイ|ばいばい|またね|じゃあね|さようなら/)) return { reply:pick(['またね〜!', 'うん、またあとで!']), intent:'bye' };
    // --- 僕について聞かれた
    if (has(/(君|あなた|きみ|お前).*(名前|なまえ)|名前は[?？]?$|なんていう|何ていう/)) return { reply:`${R.name}だよ`, intent:'greet' };
    if (has(/(僕|私|俺|わたし|おれ|ぼく).*(名前|なまえ).*(覚え|知って)/)) {
      if (U()) return { reply:`${U()}でしょ?ちゃんと覚えてるよ`, intent:'happy' };
      pending = { type:'askName', until:now() + 3 * 60e3 }; return { reply:'教えてくれたら覚えるよ。なんて呼べばいい?', intent:'yes' };
    }
    if (has(/何して(る|た|いる)|なにして/)) return { reply:`いま?${doing()}${cur || sleeping() ? '' : 'だけ'}。そっちは?`, intent:'yes' };
    if (has(/元気|調子|機嫌|げんき/) && ask) return { reply:R.energy < 30 ? 'ちょっと眠いかも。そっちは?' : R.mood > 70 ? 'めっちゃ元気!そっちは?' : R.mood < 35 ? 'うーん、ぼちぼちかな。そっちは?' : 'ふつうだよ。そっちは?', intent:R.mood < 35 ? 'sad' : 'happy' };
    if (has(/好きな(食べ物|たべもの|おやつ|お菓子|もの)/)) return { reply:`${R.fav}かな〜。そっちは?`, intent:'happy' };
    if (has(/好きな(色|いろ)/)) return { reply:`${R.color}かな。そっちは?`, intent:'yes' };
    if (has(/好きな(音楽|曲|歌)/)) return { reply:`${R.music}をよく聴くよ`, intent:'yes' };
    if (has(/何時|なんじ/)) return { reply:`いま${timeStr()}だよ`, intent:'yes' };
    if (has(/何日|なんにち|いつから|どれくらい|どのくらい/)) return { reply:`一緒に暮らし始めて、${days()}日目だね`, intent:'happy' };
    // --- あなたの気持ち
    if (has(/疲れ|つかれ|しんどい|だるい|眠い|ねむい/)) { pending = { type:'massage', until:now() + 3 * 60e3 }; return { reply:u + 'おつかれ…肩もんであげようか?', intent:'sad' }; }
    if (has(/悲しい|かなしい|つらい|辛い|落ち込|さみしい|寂しい|泣きたい|凹/)) return { reply:'そっか…話聞くよ。ゆっくりでいいからね', intent:'sad' };
    if (has(/むかつく|ムカつく|腹立つ|イライラ|ムカムカ/)) return { reply:'うわ、それはきついな…何があったの?', intent:'surprise' };
    if (has(/嬉しい|うれしい|やった|楽しい|たのしい|最高/)) return { reply:'おお、よかったじゃん!なになに?', intent:'happy' };
    if (has(/受かった|合格|うまくいった|上手くいった|成功|できた|勝った|決まった/)) { bond(1); return { reply:pick(['おお、すごいじゃん!おめでとう!', 'よかった〜!がんばったもんね']), intent:'happy' }; }
    if (has(/落ちた|不合格|だめだった|ダメだった|失敗|ミスった|負けた|最悪/)) return { reply:'そっか…がんばったんだから。話聞くよ', intent:'sad' };
    if (has(/暇|ひま|退屈/)) { pending = { type:'play', until:now() + 3 * 60e3 }; return { reply:'じゃあ、じゃんけんでもする?', intent:'yes' }; }
    if (has(/おなか|お腹|腹減|はらへ|すいた/)) { pending = { type:'snack', until:now() + 3 * 60e3 }; return { reply:'おやつあるよ、一緒に食べる?', intent:'happy' }; }
    // --- 誘い
    if (has(/じゃんけん/)) return { reply:'いいね、勝負だ!', intent:'happy', after:janken };
    if (has(/ハイタッチ/)) return { reply:'いいよ!', intent:'happy', after:highFive };
    if (has(/肩(もんで|揉んで)/)) return { reply:'しょうがないなあ', intent:'yes', after:massage };
    if (has(/おやつ|お菓子|おかし/)) return { reply:'いいね!どれにする?', intent:'happy', after:() => { menu(); snackMenu(); acts.hidden = false; } };
    if (has(/散歩|歩こ|うろうろ/)) return { reply:'いいね、ちょっと歩こっか', intent:'happy', after:stroll };
    if (has(/踊/)) return { reply:'見てて!', intent:'dance' };
    if (has(/(一緒に|いっしょに|しよう|やろう|遊ぼ|あそぼ)/)) { pending = { type:'play', until:now() + 3 * 60e3 }; return { reply:'いいね!じゃあじゃんけんで勝負しよっか', intent:'happy' }; }
    // --- お礼・おわび・ほめ言葉
    if (has(/ありがと|サンキュ|助かった/)) return { reply:pick(['どういたしまして!', 'いえいえ〜']), intent:'happy' };
    if (has(/ごめん|すまん/)) return { reply:'いいよいいよ、気にしないで', intent:'yes' };
    if (has(/かっこいい|かわいい|えらい|すごい|天才|好き/) && !has(/嫌い|きらい/)) { bond(1); return { reply:pick(['え、急にどうしたの笑 でもうれしい', 'へへ、ありがと']), intent:'happy' }; }
    if (has(/バカ|ばか|アホ/)) return { reply:'ひどいなー笑', intent:'no' };
    // --- 予定の話:内容に合わせて応援する(あとで聞き返す)
    const ev = EVENTS.find(k => t.includes(k));
    if (ev && /(明日|あした|今日|来週|今週|週末|あさって|今度|これから|ある|だった)/.test(t)) {
      if (/面接|試験|テスト|発表|試合|レポート|締め切り/.test(ev)) return { reply:`${ev}か…緊張するね。でもきっと大丈夫。終わったら聞かせて`, intent:'yes' };
      if (/旅行|デート|ライブ|飲み会|帰省/.test(ev)) return { reply:'いいなー!楽しんできてね。お土産話、待ってる', intent:'happy' };
      if (/誕生日/.test(ev)) return { reply:'おめでとう!…って、誰の?笑', intent:'happy' };
      if (/病院/.test(ev)) return { reply:'大丈夫?無理しないで、お大事にね', intent:'sad' };
      return { reply:`${ev}かぁ。がんばってね`, intent:'yes' };
    }
    // --- それ以外:相づち。ときどき自分の話や質問もする
    if (ask) return { reply:fresh(['うーん、どうだろ…なんでそう思ったの?', '難しいこと聞くなあ笑', '僕はこう思うけど…そっちは?']), intent:'yes' };
    talkCount++;
    if (talkCount % 3 === 0) return { reply:'そういえばさ、' + fresh(OWN), intent:'yes' };
    if (talkCount % 4 === 0) { pending = { type:'q', until:now() + 5 * 60e3 }; return { reply:followUp() || fresh(QUESTIONS), intent:'yes' }; }
    return { reply:fresh(BACK), intent:'yes' };
  }

  async function aiTalk(t) {
    const f = R.facts.slice(-12).map(x => x.text).join('、') || 'まだ特になし';
    const sys = `あなたは${U() || '相手'}と同じ部屋で暮らす、対等な友達でルームメイトの「${R.name}」です。タメ口で、短く(35字以内)自然に返事します。質問ばかりせず、ときどき自分の話や感想も言います。世話される存在ではなく、普通の友達として接します。いまは${timeStr()}。あなたは今「${doing()}」。機嫌は${moodWord()}。相手について覚えていること: ${f}。JSONだけを出力: {"reply":"返事","intent":"${A.TALK_INTENTS.join('|')}","memo":"相手について新しく覚えるべきことが話に出たら短く。なければ空文字"}`;
    const hist = R.log.slice(-8).map(x => ({ role:x.w === 'u' ? 'user' : 'assistant', content:x.t }));
    const j = await A.llmJSON(sys, hist);
    if (!j || !j.reply) return null;
    if (j.memo && String(j.memo).length < 40) addFact('ai', String(j.memo));
    return { reply:String(j.reply).slice(0, 80), intent:A.TALK_INTENTS.includes(j.intent) ? j.intent : 'yes' };
  }

  A.hooks.talk = async text => {
    text = (text || '').trim(); if (!text) return;
    touch();
    if (sleeping()) { if (/起きて|おきて|朝だよ|あさだよ/.test(text)) return wakeUp(); A.showBubble(pick(['むにゃ…', 'すぅ…すぅ…', 'zzz…']), '「' + text + '」', 3000); asleepReact(); return; }
    R.log.push({ w:'u', t:text, at:now() }); if (R.log.length > 24) R.log.shift();
    learn(text); R.mood = clamp(R.mood + 1);
    A.showBubble('…', '「' + short(text) + '」');
    let r = null;
    if ($('llm').checked) r = await aiTalk(text);
    if (!r) r = rules(text);
    R.log.push({ w:'r', t:r.reply, at:now() });
    say(r.reply, r.intent, { summary:'「' + short(text) + '」' });
    if (r.after) setTimeout(r.after, 1800);
    save();
  };

  /* ---------- 出迎え・自分から話しかける ---------- */
  A.hooks.started = () => {
    R.visits++; syncSleep(); renderFacts();
    if (sleeping()) { A.showBubble('すぅ…すぅ…', '', 3500); toast2('寝てるみたい。そっとしておく?肩をたたくと起きるかも'); save(); return; }
    const away = (now() - prevSeen) / HOUR, today = new Date().toDateString();
    let line, intent = 'greet';
    if (!R.met) {
      R.met = true; line = 'はじめまして…って言うのも変か笑 今日からルームメイトだね。よろしく!';
      setTimeout(() => { pending = { type:'askName', until:now() + 5 * 60e3 }; say('そういえば、なんて呼べばいい?', 'yes'); }, 6500);
    }
    else if (away >= 72) { line = 'おっ、帰ってきた!けっこう会ってなかったから心配してたよ'; intent = 'surprise'; }
    else if (away >= 24) { line = 'ひさしぶり!元気だった?'; }
    else if (R.lastGreetDay !== today && part() === 'morning') line = (U() ? U() + '、' : '') + 'おはよう!';
    else if (away >= 3) line = `おかえり!${Math.round(away)}時間ぶりだね`;
    else line = pick(['お、来た来た', 'やっほー', 'おかえり〜']);
    R.lastGreetDay = today;
    setTimeout(() => say(line, intent), 700);
    const f = R.met && away >= 3 ? followUp() : null;
    if (f) setTimeout(() => { pending = { type:'q', until:now() + 5 * 60e3 }; say(f, 'yes'); }, 6500);
    else setTimeout(() => toast2('肩をたたく=僕をタップ / 呼ぶ=ダブルタップ'), 3000);
    save();
  };
  const toast2 = m => A.toast(m);

  setInterval(() => {
    if (!ready() || locked || sleeping() || !$('chatter').checked) return;
    if (now() - lastAct < 60e3 || Math.random() > .3) return;
    let line, intent = 'yes';
    const h = hr();
    if (cur && Math.random() < .5) line = pick(cur.lines);
    else if (h >= 11 && h < 13 && Math.random() < .5) line = 'そろそろお昼じゃない?';
    else if (h >= 18 && h < 20 && Math.random() < .5) line = 'おなかすいてきたな〜、今日の晩ごはん何にしよ';
    else if (h >= 23 || h < 4) line = 'そろそろ寝ない?夜更かしはほどほどにね';
    else if (R.lastSnack && Math.random() < .3) line = `この前一緒に食べた${R.lastSnack}、また食べたいな`;
    else if (Math.random() < .3) { const f = followUp(); line = f || fresh(OWN); }
    else { [line, intent] = pick([['ひま〜', 'no'], ['ねえねえ', 'greet'], ['あそぼ!', 'happy'], ['ふんふ〜ん♪', 'dance'], ['ここ、居心地いいよね', 'yes']]); }
    say(line, intent, { voice:false, ms:4500 }); lastAct = now();
  }, 15e3);

  /* ---------- 設定・保存 ---------- */
  $('nameInput').value = R.name === 'ルームメイト' ? '' : R.name;
  $('userNameInput').value = R.userName;
  $('nameInput').onchange = e => { R.name = e.target.value.trim() || 'ルームメイト'; save(); };
  $('userNameInput').onchange = e => { R.userName = e.target.value.trim(); if (R.userName) addFact('name', '名前は' + R.userName, 'name'); else R.facts = R.facts.filter(f => f.key !== 'name'); save(); renderFacts(); };
  $('resetBtn').onclick = () => {
    if (!confirm('思い出や覚えたことを全部消して、はじめましてからやり直しますか?')) return;
    try { localStorage.removeItem(KEY); } catch (_) {}
    R = def(); save(); renderFacts(); $('nameInput').value = ''; $('userNameInput').value = ''; A.toast('リセットしました');
  };

  // 通知(サーバーなし。sw.js が閉じている間に確認する)
  let notifyCfg = { on:false, last:{} };
  A.idb.get('notify').then(c => { if (c) { notifyCfg = c; $('notifyOn').checked = !!c.on; } }).catch(() => {});
  $('notifyOn').onchange = async e => {
    if (e.target.checked) {
      if (!('Notification' in window) || !('serviceWorker' in navigator)) { e.target.checked = false; A.toast('この端末は通知に未対応です'); return; }
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { e.target.checked = false; A.toast('通知が許可されませんでした'); return; }
      notifyCfg.on = true; await A.idb.set('notify', notifyCfg).catch(() => {}); save();
      const reg = await navigator.serviceWorker.ready;
      if ('periodicSync' in reg) {
        try { await reg.periodicSync.register('pet-check', { minInterval:6 * HOUR }); A.toast('しばらく会わないときだけ、ひとことメッセージを送ります'); }
        catch (_) { A.toast('閉じている間の通知は、ホーム画面に追加すると使えます'); }
      } else A.toast('この端末では、アプリを開いている間だけです');
    } else {
      notifyCfg.on = false; A.idb.set('notify', notifyCfg).catch(() => {});
      navigator.serviceWorker && navigator.serviceWorker.ready.then(r => r.periodicSync && r.periodicSync.unregister('pet-check')).catch(() => {});
    }
  };

  // ホーム画面に追加
  let installEvt = null;
  addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; $('installBtn').hidden = false; });
  $('installBtn').onclick = async () => { if (!installEvt) return; installEvt.prompt(); await installEvt.userChoice.catch(() => {}); installEvt = null; $('installBtn').hidden = true; };

  // バックアップ・復元(ファイルで受け渡し)
  $('backupBtn').onclick = () => {
    save();
    const blob = new Blob([JSON.stringify({ app:'you-ar', v:2, savedAt:now(), rm:R }, null, 1)], { type:'application/json' });
    const d = new Date(), ymd = d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `you-ar-backup-${ymd}.json`; a.click();
    A.toast('バックアップを保存しました');
  };
  $('restoreFile').onchange = async e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    try {
      const j = JSON.parse(await f.text());
      if (j.app !== 'you-ar' || !j.rm || j.rm.v !== 2) throw new Error('形式が違います(古いバージョンのバックアップは読めません)');
      if (!confirm(`${new Date(j.savedAt).toLocaleString()} のバックアップで上書きしますか?`)) return;
      R = Object.assign(def(), j.rm); save(); renderFacts();
      $('nameInput').value = R.name === 'ルームメイト' ? '' : R.name; $('userNameInput').value = R.userName;
      A.toast('復元しました');
    } catch (err) { A.toast('復元できません: ' + err.message); }
  };
  document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
  addEventListener('pagehide', save);

  renderFacts(); save();
  window.YouARRoom = { get data() { return R; }, save, dbg, syncSleep, shoulderTap, snack, janken, highFive, massage, SNACKS };
})();
