// You AR(iPhone アプリ)
// カメラ越しの部屋で、3Dの「あなた」とルームメイトとして暮らす。
// ARKit で本物の床を認識し、決めた円の中を歩き回る。会話・記憶・生活リズムは端末の中だけで動く(サーバーなし)。
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, Modal, ScrollView, Switch, Dimensions, KeyboardAvoidingView, Platform, Alert, AppState, PixelRatio } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { ViroARSceneNavigator, ViroARScene, ViroAmbientLight, ViroDirectionalLight, Viro3DObject, ViroNode, ViroQuad, ViroImage } from '@reactvision/react-viro';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Speech from 'expo-speech';
import * as Notifications from 'expo-notifications';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';

const MODEL_NEUTRAL = require('./assets/me_neutral.glb');
const MODEL_SMILE = require('./assets/me_smile.glb');
const RETICLE = require('./assets/reticle.png');
const RING = require('./assets/ring.png');

const ACCENT = '#ff4f81';
const { width: SW, height: SH } = Dimensions.get('window');
const TOP = 56, BOTTOM = 34;

/* ---------- 3Dモデルの動き(モデルに入っている動きの名前と長さ) ---------- */
const CLIPS = {
  idle: ['idle_breath', 'idle_look'], walk: ['walk_cycle'], greet: ['greet_wave', 'greet_hello'], bye: ['bye_wave'],
  happy: ['happy_jump', 'happy_cheer'], sad: ['sad_slump'], yes: ['yes_nod', 'yes_nod_small'], no: ['no_headshake'],
  surprise: ['surprise_startle'], dance: ['dance_sway', 'dance_groove'], eat: ['eat_bite'], pet: ['pet_shy'],
};
const DUR = { idle_breath: 4, idle_look: 6, walk_cycle: 1.1, greet_wave: 2.4, greet_hello: 1.6, bye_wave: 2.2, happy_jump: 1.4, happy_cheer: 1.6,
  sad_slump: 2.4, yes_nod: 1.2, yes_nod_small: 0.9, no_headshake: 1.3, surprise_startle: 1.2, dance_sway: 3.2, dance_groove: 3, eat_bite: 2.4, pet_shy: 1.8 };
const SMILE = ['happy', 'greet', 'dance', 'eat', 'pet', 'bye'];

/* ---------- ルームメイトの記憶・設定 ---------- */
const KEY = 'youar.rm.v2', HOUR = 3600e3, DAY = 24 * HOUR;
const now = () => Date.now();
const pick = a => a[Math.floor(Math.random() * a.length)];
const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = v => Math.max(0, Math.min(100, v));
const wait = ms => new Promise(r => setTimeout(r, ms));
const SNACKS = [{ e: '🍪', n: 'クッキー' }, { e: '🍘', n: 'せんべい' }, { e: '🍫', n: 'チョコ' }, { e: '🍦', n: 'アイス' },
  { e: '🍊', n: 'みかん' }, { e: '🍵', n: 'お茶' }, { e: '🍙', n: 'おにぎり' }, { e: '🍟', n: 'ポテト' }];
const COLORS = ['青', '緑', '赤', '黒', 'オレンジ'], MUSIC = ['昔のJ-POP', 'ジャズっぽいやつ', 'ローファイ', 'アニソン', 'ロック'];
const defData = () => ({
  v: 2, name: 'ルームメイト', userName: '', firstMet: now(), lastSeen: now(), visits: 0, met: false,
  mood: 70, energy: 70, bond: 0, fav: pick(SNACKS).n, color: pick(COLORS), music: pick(MUSIC),
  facts: [], log: [], shared: 0, lastSnack: '', janken: { w: 0, l: 0, d: 0 }, lastGreetDay: '',
  settings: { tts: true, chatter: true, notify: false },
});
const EVENTS = ['仕事', 'バイト', '学校', '授業', 'テスト', '試験', '面接', '旅行', 'デート', '誕生日', '病院', 'ライブ', '試合', '発表', '出張', '引っ越し', 'レポート', '締め切り', '飲み会', '帰省'];
const ACTS = [
  { id: 'read', e: '📖', doing: '本読んでる', lines: ['本、読んでる', 'これ、続きが気になって'], when: 'morning day evening' },
  { id: 'phone', e: '📱', doing: 'スマホ見てる', lines: ['動画見てた', 'ちょっとSNS見てた'], when: 'day evening night' },
  { id: 'music', e: '🎧', doing: '音楽聴いてる', lines: ['いい曲見つけた', 'いまこれ聴いてるんだ'], when: 'morning day evening night' },
  { id: 'game', e: '🎮', doing: 'ゲームしてる', lines: ['ゲームしてた', 'あとちょっとでクリアなんだよね'], when: 'day evening night' },
  { id: 'tea', e: '🍵', doing: 'お茶飲んでる', lines: ['お茶いれた', 'ちょっと休憩'], when: 'morning day evening' },
  { id: 'stretch', e: '🙆', doing: 'ストレッチしてる', lines: ['体バキバキだわ', 'ストレッチ〜'], when: 'morning day evening' },
  { id: 'window', e: '🪟', doing: '外ぼーっと見てる', lines: ['外見てた、いい天気', 'なんか空きれい'], when: 'morning day evening' },
  { id: 'yawn', e: '🥱', doing: 'ぼーっとしてる', lines: ['ねむ…'], when: 'morning night' },
];
const OWN = ['最近あのお店のパン気になってるんだよね', '昨日、変な夢みた', '今度の休み、何しよっかなって考えてた', 'コンビニの新しいアイス、うまそうだった', 'なんか急に掃除したくなってきた', 'さっき窓の外、猫がいたよ'];
const BACK = ['へえ、そうなんだ', 'なるほどね〜', 'それでそれで?', 'うんうん', 'まじか', 'いいじゃん'];
const QUESTIONS = ['今日どんな一日だった?', 'そっちは最近どう?', '晩ごはん、何にする?', '最近ハマってることある?'];
const HANDS = { g: '✊', c: '✌️', p: '✋' };

const hr = () => new Date().getHours();
const part = () => { const h = hr(); return h >= 5 && h < 10 ? 'morning' : h >= 10 && h < 17 ? 'day' : h >= 17 && h < 22 ? 'evening' : 'night'; };
const dayKey = () => { const d = new Date(); if (d.getHours() < 5) d.setDate(d.getDate() - 1); return d.toDateString(); };
function isNight() {
  let h = 0; for (const ch of dayKey()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const bed = 23 + (h % 6) * 0.5, d = new Date(), x = d.getHours() + d.getMinutes() / 60, z = x < 7 ? x + 24 : x;   // 寝る時間は日によって23:00〜25:30
  return z >= bed;
}
const timeStr = () => { const d = new Date(); return `${d.getHours()}時${d.getMinutes()}分`; };
const short = t => t.length > 24 ? t.slice(0, 24) + '…' : t;

/* ---------- ルームメイトの頭脳(会話・記憶・生活)。画面や3Dとは io を通してやりとりする ---------- */
function makeBrain(R, io) {
  let pending = null, recent = [], talkCount = 0, cur = null, locked = false, nextAt = now() + 6000, lastAct = now();
  let sleeping = false, awakeUntil = 0, asleepTaps = [];
  const prevSeen = R.lastSeen;
  const U = () => R.userName;
  const days = () => Math.floor((now() - R.firstMet) / DAY) + 1;
  const save = () => { R.lastSeen = now(); io.save(R); };
  const say = (t, intent, o = {}) => io.say(t, intent, o);
  const touch = () => { lastAct = now(); nextAt = Math.max(nextAt, now() + 9000); };
  const fresh = arr => { const a = arr.filter(x => !recent.includes(x)); const r = pick(a.length ? a : arr); recent.push(r); if (recent.length > 10) recent.shift(); return r; };
  const bond = n => { R.bond += n; R.mood = clamp(R.mood + n); };
  const doing = () => sleeping ? '寝てた' : cur ? cur.doing : 'ぼーっとしてる';
  const setAct = a => { cur = a; io.setIcon(a ? a.e : null); };

  function addFact(kind, text, key) {
    key = key || kind + ':' + text;
    if (R.facts.some(f => f.key === key)) return;
    R.facts.push({ key, kind, text, at: now(), asked: 0 }); if (R.facts.length > 40) R.facts.shift(); save(); io.factsChanged();
  }
  function learn(t) {
    if (/君|あなた|きみ|お前|そっち/.test(t)) return;
    let m = t.match(/(?:(?:僕|私|俺|わたし|おれ|ぼく|あたし)の)?名前は([^?？\s。!!]{1,10}?)(?:です|だよ|っていう|といいます|$)/) || t.match(/([^?？\s。!!]{1,10}?)(?:って|と)呼んで/);
    if (m) { R.userName = m[1]; addFact('name', '名前は' + R.userName, 'name'); }
    if ((m = t.match(/(.{1,12}?)(?:が|は|も)(?:大?好き|すき)/))) addFact('like', m[1] + 'が好き');
    if ((m = t.match(/(.{1,12}?)(?:が|は)(?:大?嫌い|きらい|苦手|にがて)/))) addFact('dislike', m[1] + 'が苦手');
    const ev = EVENTS.find(k => t.includes(k));
    if (ev && /(明日|あした|今日|昨日|来週|今週|週末|あさって|今度|これから)/.test(t)) addFact('event', short(t), 'ev:' + ev + ':' + dayKey());
    if (/疲れ|つかれ|しんどい|だるい|眠い|ねむい/.test(t)) addFact('feel', '疲れてた', 'feel:' + dayKey());
  }
  function followUp() {
    const f = R.facts.find(x => (x.kind === 'event' || x.kind === 'feel') && !x.asked && now() - x.at > 3 * HOUR && now() - x.at < 4 * DAY);
    if (!f) return null; f.asked++; save();
    return f.kind === 'event' ? `そういえば「${f.text}」って言ってたけど、どうだった?` : 'そういえば前に疲れてたけど、最近はどう?';
  }

  // 睡眠:夜は自分で寝る。話しかけると寝言、3回続けると起きる
  function syncSleep() {
    const want = awakeUntil < now() && isNight();
    if (want && !sleeping) { sleeping = true; io.stop(); setAct(null); io.setSleep(true); }
    else if (!want && sleeping) { sleeping = false; io.setSleep(false); if (io.ready()) say(pick(['ふぁ〜、おはよ…', 'ん…朝か…おはよう']), 'yes'); }
  }
  function wakeUp() {
    awakeUntil = now() + 40 * 60e3; sleeping = false; asleepTaps = []; io.setSleep(false); R.mood = clamp(R.mood - 5);
    say(pick(['ふぁ…もう、しょうがないなぁ。どうしたの?', 'んん…起きた起きた。なに?']), 'surprise'); save();
  }
  function asleepReact() {
    asleepTaps = asleepTaps.filter(t => now() - t < 3 * 60e3); asleepTaps.push(now());
    if (asleepTaps.length >= 3) return wakeUp();
    say(pick(['…ん…あと5分…', 'むにゃ…', 'すぅ…すぅ…', '…あした…']), null, { voice: false, ms: 3000 });
  }

  async function task(fn) {
    if (locked) return; locked = true; io.stop(); setAct(null);
    try { await fn(); } catch (e) { console.warn(e); } finally { locked = false; nextAt = now() + rnd(12e3, 25e3); }
  }
  const comeFront = async () => { const [x, z] = io.zoneFront(true); await io.walkTo(x, z); };

  // 自分の暮らし:うろうろして、好きなことをする
  async function life() {
    if (!io.ready()) return;
    syncSleep();
    if (sleeping || locked || now() < nextAt) return;
    locked = true;
    try {
      if (cur && now() > cur.until) setAct(null);
      if (Math.random() < .6) { setAct(null); const [x, z] = io.zoneRandom(); await io.walkTo(x, z); }
      if (!sleeping && Math.random() < .6) {
        const a = pick(ACTS.filter(a => a.when.includes(part())));
        setAct(Object.assign({}, a, { until: now() + rnd(20e3, 50e3) }));
        if (Math.random() < .3 && R.settings.chatter) say(pick(a.lines), 'yes', { voice: false, ms: 3500 });
      }
    } finally { locked = false; nextAt = now() + rnd(8e3, 22e3); }
  }
  // ときどき自分から話しかける
  function chatter() {
    if (!io.ready() || locked || sleeping || !R.settings.chatter) return;
    if (now() - lastAct < 60e3 || Math.random() > .3) return;
    let line, intent = 'yes'; const h = hr();
    if (cur && Math.random() < .5) line = pick(cur.lines);
    else if (h >= 11 && h < 13 && Math.random() < .5) line = 'そろそろお昼じゃない?';
    else if (h >= 18 && h < 20 && Math.random() < .5) line = 'おなかすいてきたな〜、今日の晩ごはん何にしよ';
    else if (h >= 23 || h < 4) line = 'そろそろ寝ない?夜更かしはほどほどにね';
    else if (R.lastSnack && Math.random() < .3) line = `この前一緒に食べた${R.lastSnack}、また食べたいな`;
    else if (Math.random() < .3) line = followUp() || fresh(OWN);
    else [line, intent] = pick([['ひま〜', 'no'], ['ねえねえ', 'greet'], ['あそぼ!', 'happy'], ['ふんふ〜ん♪', 'dance'], ['ここ、居心地いいよね', 'yes']]);
    say(line, intent, { voice: false, ms: 4500 }); lastAct = now();
  }

  /* ---------- いっしょに(友達同士の行動) ---------- */
  async function snack(sn) {
    await task(async () => {
      if (sleeping) return asleepReact();
      await comeFront();
      const fav = sn.n === R.fav;
      say(fav ? `${sn.n}!? 僕これ大好きなんだよね!` : pick([`お、${sn.n}いいね!`, `${sn.n}か〜、もらうね`, 'ちょうど何か食べたかった!']), 'happy');
      await wait(1700);
      io.pop(sn.e, 4200);
      say(pick(['いただきます!', 'じゃあ、いただきまーす']), 'eat'); await wait(2800);
      say(pick(['もぐもぐ…おいしい', 'うまっ', fav ? 'やっぱこれだわ〜' : 'これ、いいね']), 'happy'); await wait(2400);
      R.shared++; R.lastSnack = sn.n; bond(3);
      if (R.shared === 1) addFact('shared', `最初に一緒に食べたのは${sn.n}`, 'shared:first');
      say(pick(['また一緒に食べようね', 'ひとりで食べるより、おいしいね', `次は${pick(SNACKS.filter(x => x !== sn)).n}にしよっか`]), 'yes'); save();
    });
  }
  async function shoulderTap() {
    touch();
    if (sleeping) return asleepReact();
    await task(async () => {
      say(pick(['わっ、びっくりした!なに?', 'ん?どうした?', 'お、なになに?']), 'surprise'); await wait(2400);
      bond(1);
      const q = followUp() || pick(['今日どんな一日だった?', '最近ハマってることある?', '晩ごはん、何にする?', '休みの日って何してるの?', '最近よく眠れてる?']);
      pending = { type: 'q', until: now() + 5 * 60e3 }; say(q, 'yes'); save();
    });
  }
  async function massage() {
    await task(async () => {
      if (sleeping) return asleepReact();
      await comeFront();
      say('肩、もんであげるよ。ほら後ろ向いて', 'happy'); await wait(2000);
      io.pop('💆', 8500);
      for (const l of ['うわ、けっこう凝ってるね', 'ここ?ここがいい?', 'どう?気持ちいい?']) { say(l, 'pet', { voice: false, ms: 2600 }); await wait(2700); }
      say('はい、おしまい!おつかれさま', 'happy'); bond(4); save();
    });
  }
  async function highFive() {
    await task(async () => {
      if (sleeping) return asleepReact();
      await comeFront(); say('ハイタッチしよ!せーの…', 'yes'); await wait(1500);
      say('ほらここ!早く!', 'surprise', { voice: false, ms: 1800 });
      const hit = await io.hand(1700);
      if (hit) { say('イェーイ!', 'happy'); bond(2); }
      else { say('あれ?ミスった笑 もう一回やる?', 'no'); pending = { type: 'highfive', until: now() + 2 * 60e3 }; }
      save();
    });
  }
  async function janken() {
    await task(async () => {
      if (sleeping) return asleepReact();
      await comeFront(); say('じゃんけんしよ!', 'happy'); await wait(1400);
      for (let round = 0; round < 12; round++) {
        say('最初はグー!じゃんけん…', 'yes', { voice: false, ms: 5000 });
        const mine = await io.choose([{ key: 'g', label: HANDS.g }, { key: 'c', label: HANDS.c }, { key: 'p', label: HANDS.p }], 'どれを出す?', 15000, true);
        if (!mine) { say('あれ、やめちゃう?', 'no'); break; }
        const his = pick(['g', 'c', 'p']);
        io.pop(HANDS[mine] + '  vs  ' + HANDS[his], 2600);
        const win = (mine === 'g' && his === 'c') || (mine === 'c' && his === 'p') || (mine === 'p' && his === 'g');
        const res = mine === his ? 'd' : win ? 'w' : 'l'; R.janken[res]++;
        if (res === 'd') say(pick(['あいこか!もう一回!', 'おお、同じ!']), 'surprise');
        else if (res === 'w') say(pick(['くっそー、負けた!', 'やるじゃん!', 'うわ、負けたー']), 'sad');
        else say(pick(['やった、勝った!', 'いえーい、僕の勝ち!', 'ふふん、まだまだだね']), 'happy');
        await wait(2400);
        if (res !== 'd') { bond(1); const again = await io.choose([{ key: 'y', label: 'もう一回!' }, { key: 'n', label: 'おしまい' }], '', 12000); if (again !== 'y') break; }
      }
      save();
      const j = R.janken; if (j.w + j.l >= 3) say(`通算、あなたの${j.w}勝${j.l}敗だね`, 'yes', { voice: false });
    });
  }
  async function stroll() {
    await task(async () => {
      if (sleeping) return asleepReact();
      for (let i = 0; i < 3; i++) { const [x, z] = io.zoneRandom(); if (!(await io.walkTo(x, z))) return; await wait(700); }
      say(pick(['ちょっとスッキリした', 'たまには歩かないとね']), 'happy', { voice: false });
    });
  }
  async function callTo(x, z) {
    touch();
    if (sleeping) return asleepReact();
    await task(async () => { const ok = await io.walkTo(x, z); if (ok) say(pick(['呼んだ?', 'なになに?', 'はいはーい', 'お、どうした?']), 'greet'); });
  }

  /* ---------- 会話(AIなし:状況に合わせたルール) ---------- */
  function rules(t) {
    const has = re => re.test(t), u = U() ? U() + '、' : '', ask = has(/[?？]|かな|かい$/);
    if (pending && pending.until > now()) {
      const p = pending, yes = /^(うん|はい|いいよ|お願い|頼む|オッケー|ok|もちろん|ぜひ|やる|やろう|する)/i.test(t), no = /^(いや|ううん|大丈夫|いい(よ|です)?$|やめとく|結構|いらない)/.test(t);
      const stripped = t.replace(/^(僕|俺|私|わたし|ぼく|おれ)は/, '').replace(/(です|だよ|って呼んで|でいい|で)$/, '');
      const notName = /ありがと|こんにち|おはよ|こんばん|^うん|^はい|いいよ|よろしく|ごめん|すごい|かわいい|ただいま|おやすみ|なんで|いや|わからない|こと|あった|した|たい|ない|から|けど|ました|いる|する|悲|嬉|楽|疲|好き|嫌い|今日|明日|昨日/.test(t)
        || stripped.length > 8 || (/[がをに]/.test(stripped) && stripped.length > 3);
      if (p.type === 'askName' && notName) pending = null;
      if (p.type === 'askName' && !notName && !ask) { pending = null; R.userName = stripped.replace(/[。.!!]/g, ''); addFact('name', '名前は' + R.userName, 'name'); return { reply: `${R.userName}ね、覚えた!よろしく`, intent: 'happy' }; }
      if (yes && p.type === 'massage') { pending = null; return { reply: 'じゃ、失礼して…', intent: 'happy', after: massage }; }
      if (yes && p.type === 'snack') { pending = null; return { reply: 'やった!どれにする?', intent: 'happy', after: io.openSnacks }; }
      if (yes && p.type === 'play') { pending = null; return { reply: 'よし、勝負だ!', intent: 'happy', after: janken }; }
      if (yes && p.type === 'highfive') { pending = null; return { reply: '今度こそ!', intent: 'yes', after: highFive }; }
      if (no && p.type !== 'q' && p.type !== 'askName') { pending = null; return { reply: pick(['そっか、またいつでも言ってね', 'りょうかい']), intent: 'yes' }; }
      if (p.type === 'q') pending = null;
    }
    if (has(/おはよう/)) return { reply: part() === 'morning' ? u + 'おはよ!よく眠れた?' : 'おはよ…って、もう朝じゃないけどね笑', intent: 'greet' };
    if (has(/こんにちは/)) return { reply: u + pick(['やあ!', 'こんちは〜', 'おっ、こんにちは']), intent: 'greet' };
    if (has(/こんばんは/)) return { reply: u + 'こんばんは〜', intent: 'greet' };
    if (has(/ただいま/)) { bond(2); return { reply: u + (hr() >= 21 ? 'おかえり、遅かったね。おつかれ' : 'おかえり!おつかれ〜'), intent: 'happy' }; }
    if (has(/いってきます|行ってきます/)) return { reply: 'いってらっしゃい!気をつけてね', intent: 'bye' };
    if (has(/おやすみ/)) return { reply: isNight() || hr() >= 21 ? 'おやすみ〜、また明日ね' : 'え、もう寝るの?早くない?笑', intent: 'bye' };
    if (has(/おつかれ|お疲れ/)) return { reply: 'おつかれ〜!今日もよくやったね', intent: 'happy' };
    if (has(/バイバイ|ばいばい|またね|じゃあね|さようなら/)) return { reply: pick(['またね〜!', 'うん、またあとで!']), intent: 'bye' };
    if (has(/(君|あなた|きみ|お前).*(名前|なまえ)|名前は[?？]?$|なんていう|何ていう/)) return { reply: `${R.name}だよ`, intent: 'greet' };
    if (has(/(僕|私|俺|わたし|おれ|ぼく).*(名前|なまえ).*(覚え|知って)/)) {
      if (U()) return { reply: `${U()}でしょ?ちゃんと覚えてるよ`, intent: 'happy' };
      pending = { type: 'askName', until: now() + 3 * 60e3 }; return { reply: '教えてくれたら覚えるよ。なんて呼べばいい?', intent: 'yes' };
    }
    if (has(/何して(る|た|いる)|なにして/)) return { reply: `いま?${doing()}${cur || sleeping ? '' : 'だけ'}。そっちは?`, intent: 'yes' };
    if (has(/元気|調子|機嫌|げんき/) && ask) return { reply: R.energy < 30 ? 'ちょっと眠いかも。そっちは?' : R.mood > 70 ? 'めっちゃ元気!そっちは?' : R.mood < 35 ? 'うーん、ぼちぼちかな。そっちは?' : 'ふつうだよ。そっちは?', intent: R.mood < 35 ? 'sad' : 'happy' };
    if (has(/好きな(食べ物|たべもの|おやつ|お菓子|もの)/)) return { reply: `${R.fav}かな〜。そっちは?`, intent: 'happy' };
    if (has(/好きな(色|いろ)/)) return { reply: `${R.color}かな。そっちは?`, intent: 'yes' };
    if (has(/好きな(音楽|曲|歌)/)) return { reply: `${R.music}をよく聴くよ`, intent: 'yes' };
    if (has(/何時|なんじ/)) return { reply: `いま${timeStr()}だよ`, intent: 'yes' };
    if (has(/何日|なんにち|いつから|どれくらい|どのくらい/)) return { reply: `一緒に暮らし始めて、${days()}日目だね`, intent: 'happy' };
    if (has(/疲れ|つかれ|しんどい|だるい|眠い|ねむい/)) { pending = { type: 'massage', until: now() + 3 * 60e3 }; return { reply: u + 'おつかれ…肩もんであげようか?', intent: 'sad' }; }
    if (has(/悲しい|かなしい|つらい|辛い|落ち込|さみしい|寂しい|泣きたい|凹/)) return { reply: 'そっか…話聞くよ。ゆっくりでいいからね', intent: 'sad' };
    if (has(/むかつく|ムカつく|腹立つ|イライラ|ムカムカ/)) return { reply: 'うわ、それはきついな…何があったの?', intent: 'surprise' };
    if (has(/嬉しい|うれしい|やった|楽しい|たのしい|最高/)) return { reply: 'おお、よかったじゃん!なになに?', intent: 'happy' };
    if (has(/受かった|合格|うまくいった|上手くいった|成功|できた|勝った|決まった/)) { bond(1); return { reply: pick(['おお、すごいじゃん!おめでとう!', 'よかった〜!がんばったもんね']), intent: 'happy' }; }
    if (has(/落ちた|不合格|だめだった|ダメだった|失敗|ミスった|負けた|最悪/)) return { reply: 'そっか…がんばったんだから。話聞くよ', intent: 'sad' };
    if (has(/暇|ひま|退屈/)) { pending = { type: 'play', until: now() + 3 * 60e3 }; return { reply: 'じゃあ、じゃんけんでもする?', intent: 'yes' }; }
    if (has(/おなか|お腹|腹減|はらへ|すいた/)) { pending = { type: 'snack', until: now() + 3 * 60e3 }; return { reply: 'おやつあるよ、一緒に食べる?', intent: 'happy' }; }
    if (has(/じゃんけん/)) return { reply: 'いいね、勝負だ!', intent: 'happy', after: janken };
    if (has(/ハイタッチ/)) return { reply: 'いいよ!', intent: 'happy', after: highFive };
    if (has(/肩(もんで|揉んで)/)) return { reply: 'しょうがないなあ', intent: 'yes', after: massage };
    if (has(/おやつ|お菓子|おかし/)) return { reply: 'いいね!どれにする?', intent: 'happy', after: io.openSnacks };
    if (has(/散歩|歩こ|うろうろ/)) return { reply: 'いいね、ちょっと歩こっか', intent: 'happy', after: stroll };
    if (has(/踊/)) return { reply: '見てて!', intent: 'dance' };
    if (has(/(一緒に|いっしょに|しよう|やろう|遊ぼ|あそぼ)/)) { pending = { type: 'play', until: now() + 3 * 60e3 }; return { reply: 'いいね!じゃあじゃんけんで勝負しよっか', intent: 'happy' }; }
    if (has(/ありがと|サンキュ|助かった/)) return { reply: pick(['どういたしまして!', 'いえいえ〜']), intent: 'happy' };
    if (has(/ごめん|すまん/)) return { reply: 'いいよいいよ、気にしないで', intent: 'yes' };
    if (has(/かっこいい|かわいい|えらい|すごい|天才|好き/) && !has(/嫌い|きらい/)) { bond(1); return { reply: pick(['え、急にどうしたの笑 でもうれしい', 'へへ、ありがと']), intent: 'happy' }; }
    if (has(/バカ|ばか|アホ/)) return { reply: 'ひどいなー笑', intent: 'no' };
    const ev = EVENTS.find(k => t.includes(k));
    if (ev && /(明日|あした|今日|来週|今週|週末|あさって|今度|これから|ある|だった)/.test(t)) {
      if (/面接|試験|テスト|発表|試合|レポート|締め切り/.test(ev)) return { reply: `${ev}か…緊張するね。でもきっと大丈夫。終わったら聞かせて`, intent: 'yes' };
      if (/旅行|デート|ライブ|飲み会|帰省/.test(ev)) return { reply: 'いいなー!楽しんできてね。お土産話、待ってる', intent: 'happy' };
      if (/誕生日/.test(ev)) return { reply: 'おめでとう!…って、誰の?笑', intent: 'happy' };
      if (/病院/.test(ev)) return { reply: '大丈夫?無理しないで、お大事にね', intent: 'sad' };
      return { reply: `${ev}かぁ。がんばってね`, intent: 'yes' };
    }
    if (ask) return { reply: fresh(['うーん、どうだろ…なんでそう思ったの?', '難しいこと聞くなあ笑', '僕はこう思うけど…そっちは?']), intent: 'yes' };
    talkCount++;
    if (talkCount % 3 === 0) return { reply: 'そういえばさ、' + fresh(OWN), intent: 'yes' };
    if (talkCount % 4 === 0) { pending = { type: 'q', until: now() + 5 * 60e3 }; return { reply: followUp() || fresh(QUESTIONS), intent: 'yes' }; }
    return { reply: fresh(BACK), intent: 'yes' };
  }

  function talk(text) {
    text = (text || '').trim(); if (!text) return;
    touch();
    if (sleeping) { if (/起きて|おきて|朝だよ|あさだよ/.test(text)) return wakeUp(); asleepReact(); return; }
    R.log.push({ w: 'u', t: text, at: now() }); if (R.log.length > 24) R.log.shift();
    learn(text); R.mood = clamp(R.mood + 1);
    const r = rules(text);
    R.log.push({ w: 'r', t: r.reply, at: now() });
    say(r.reply, r.intent, { summary: '「' + short(text) + '」' });
    if (r.after) setTimeout(r.after, 1800);
    save();
  }

  // 出迎え:時間帯と、どれくらい会っていなかったかで変える
  function start() {
    R.visits++; syncSleep();
    if (sleeping) { say('すぅ…すぅ…', null, { voice: false, ms: 3500 }); io.toast('寝てるみたい。タップを3回すると起きるかも'); save(); return; }
    const away = (now() - prevSeen) / HOUR, today = new Date().toDateString();
    let line, intent = 'greet';
    if (!R.met) {
      R.met = true; line = 'はじめまして…って言うのも変か笑 今日からルームメイトだね。よろしく!';
      setTimeout(() => { pending = { type: 'askName', until: now() + 5 * 60e3 }; say('そういえば、なんて呼べばいい?', 'yes'); }, 6500);
    } else if (away >= 72) { line = 'おっ、帰ってきた!けっこう会ってなかったから心配してたよ'; intent = 'surprise'; }
    else if (away >= 24) line = 'ひさしぶり!元気だった?';
    else if (R.lastGreetDay !== today && part() === 'morning') line = (U() ? U() + '、' : '') + 'おはよう!';
    else if (away >= 3) line = `おかえり!${Math.round(away)}時間ぶりだね`;
    else line = pick(['お、来た来た', 'やっほー', 'おかえり〜']);
    R.lastGreetDay = today;
    setTimeout(() => say(line, intent), 900);
    const f = R.met && away >= 3 ? followUp() : null;
    if (f) setTimeout(() => { pending = { type: 'q', until: now() + 5 * 60e3 }; say(f, 'yes'); }, 6500);
    else setTimeout(() => io.toast('肩をたたく=僕をタップ / 呼ぶ=床をタップ'), 3500);
    save();
  }
  const baseExpr = () => (!sleeping && R.mood > 82) ? 'smile' : 'neutral';

  const timers = [setInterval(life, 2500), setInterval(chatter, 15e3)];
  return { talk, start, snack, shoulderTap, massage, highFive, janken, callTo, baseExpr, isSleeping: () => sleeping, stopAll: () => timers.forEach(clearInterval) };
}

/* ---------- AR の場面(ViroReact)。表示する内容は App から viroAppProps で受け取る ---------- */
function RoomScene(props) {
  const p = props.sceneNavigator.viroAppProps;
  useEffect(() => { p.onNav && p.onNav(props.sceneNavigator); }, []);
  const z = p.zone;
  return (
    <ViroARScene onCameraARHitTest={p.onHit} onCameraTransformUpdate={p.onCam} anchorDetectionTypes={['PlanesHorizontal']}>
      <ViroAmbientLight color="#ffffff" intensity={350} />
      <ViroDirectionalLight color="#ffffff" direction={[-0.3, -1, -0.45]} intensity={650} castsShadow shadowOpacity={0.45}
        shadowOrthographicSize={5} shadowOrthographicPosition={z ? [z.c[0], z.c[1] + 3, z.c[2]] : [0, 3, 0]} shadowNearZ={0.5} shadowFarZ={8} shadowMapSize={2048} />
      {p.reticle ? <ViroImage source={RETICLE} position={p.reticle} rotation={[-90, 0, 0]} width={0.28} height={0.28} /> : null}
      {z ? <ViroQuad position={[z.c[0], z.c[1] + 0.002, z.c[2]]} rotation={[-90, 0, 0]} width={10} height={10} arShadowReceiver onClick={p.onFloorTap} /> : null}
      {z && p.ringOpacity > 0 ? <ViroImage source={RING} position={[z.c[0], z.c[1] + 0.005, z.c[2]]} rotation={[-90, 0, 0]} width={z.r * 2} height={z.r * 2} opacity={p.ringOpacity} /> : null}
      {p.avatarVisible ? (
        <ViroNode position={p.pos} rotation={[0, p.yaw, 0]} scale={[p.scale, p.scale, p.scale]} onClick={p.onAvatarTap} onPinch={p.onPinch}>
          <Viro3DObject source={MODEL_NEUTRAL} type="GLB" visible={p.expr !== 'smile'} animation={p.anim} />
          <Viro3DObject source={MODEL_SMILE} type="GLB" visible={p.expr === 'smile'} animation={p.anim} />
        </ViroNode>
      ) : null}
    </ViroARScene>
  );
}

/* ---------- アプリ本体 ---------- */
export default function App() {
  const [screen, setScreen] = useState('start');          // start → find → zone → home
  const [data, setData] = useState(null);                 // 記憶・設定
  const [reticle, setReticle] = useState(null);
  const [zone, setZone] = useState(null);                 // { c:[x,y,z], r }
  const [ringOpacity, setRingOpacity] = useState(0.8);
  const [frame, setFrame] = useState({ pos: [0, 0, -1.5], yaw: 0 });
  const [scale, setScale] = useState(1);
  const [anim, setAnim] = useState({ name: 'idle_breath', loop: true, k: 0 });
  const [expr, setExprState] = useState('neutral');
  const [bubble, setBubble] = useState(null);             // { text, sub }
  const [bubblePos, setBubblePos] = useState(null);
  const [icon, setIcon] = useState(null);
  const [sleeping, setSleeping] = useState(false);
  const [toast, setToast] = useState(null);
  const [popItem, setPopItem] = useState(null);
  const [hand, setHand] = useState(null);                 // ハイタッチの手 { x, y }
  const [choice, setChoice] = useState(null);             // { options, hint, big }
  const [sheet, setSheet] = useState(null);               // null | 'menu' | 'snacks'
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [text, setText] = useState('');
  const [listening, setListening] = useState(false);
  const [, force] = useState(0);

  const S = useRef({ nav: null, cam: [0, 0, 0], hit: null, lastHitAt: 0, target: null, walkRes: null, faceUntil: 0, pos: [0, 0, -1.5], yaw: 0,
    lastClip: '', animTimer: 0, exprTimer: 0, toastTimer: 0, bubbleTimer: 0, walking: false, zone: null, screen: 'start', active: true, brain: null, data: null }).current;
  S.zone = zone; S.screen = screen; S.data = data; S.settingsOpen = settingsOpen;

  // 記憶・設定を読み込む
  useEffect(() => {
    AsyncStorage.getItem(KEY).then(s => { let d = null; try { d = JSON.parse(s); } catch (_) {} setData(d && d.v === 2 ? Object.assign(defData(), d, { settings: Object.assign(defData().settings, d.settings || {}) }) : defData()); });
    const sub = AppState.addEventListener('change', st => { S.active = st === 'active'; if (st !== 'active') { saveData(); scheduleNotes(); } else Notifications.cancelAllScheduledNotificationsAsync().catch(() => {}); });
    return () => sub.remove();
  }, []);
  const saveData = () => { if (S.data) { S.data.lastSeen = now(); AsyncStorage.setItem(KEY, JSON.stringify(S.data)).catch(() => {}); } };

  // しばらく会わないときだけ、ひとことメッセージ(端末の中で予約。サーバーなし。夜は送らない)
  async function scheduleNotes() {
    const d = S.data; if (!d || !d.settings.notify) return;
    await Notifications.cancelAllScheduledNotificationsAsync().catch(() => {});
    const call = d.userName ? d.userName + '、' : '';
    for (const [h, body] of [[24, call + '今日はどうしてた?また話そうよ'], [72, call + 'ひさしぶり。元気にしてる?']]) {
      const at = new Date(now() + h * HOUR); if (at.getHours() < 9) at.setHours(12, 0, 0); if (at.getHours() >= 22) { at.setDate(at.getDate() + 1); at.setHours(12, 0, 0); }
      Notifications.scheduleNotificationAsync({ content: { title: d.name, body }, trigger: { type: 'date', date: at } }).catch(() => {});
    }
  }

  /* ---------- 3Dのあなたを動かす ---------- */
  function playClip(intent) {
    if (!intent || !CLIPS[intent]) return;
    let c = CLIPS[intent]; if (c.length > 1) c = c.filter(x => x !== S.lastClip);
    const name = pick(c); S.lastClip = name;
    clearTimeout(S.animTimer);
    setAnim({ name, loop: false, k: Math.random() });
    S.animTimer = setTimeout(() => setAnim({ name: S.walking ? 'walk_cycle' : pick(CLIPS.idle), loop: true, k: Math.random() }), DUR[name] * 1000);
  }
  function setExpr(e) { setExprState(e); }
  function emote(intent) {
    if (!intent) return;
    setExpr(SMILE.includes(intent) ? 'smile' : 'neutral');
    clearTimeout(S.exprTimer); S.exprTimer = setTimeout(() => setExpr(S.brain ? S.brain.baseExpr() : 'neutral'), 4500);
  }
  function showToast(m) { setToast(m); clearTimeout(S.toastTimer); S.toastTimer = setTimeout(() => setToast(null), 2600); }
  function say(t, intent, o = {}) {
    setBubble({ text: t, sub: o.summary || '' });
    clearTimeout(S.bubbleTimer); S.bubbleTimer = setTimeout(() => setBubble(null), o.ms || 6000);
    if (o.voice !== false && S.data && S.data.settings.tts) { Speech.stop(); Speech.speak(t.replace(/[!!??〜♪]/g, ''), { language: 'ja-JP', pitch: 1.1 }); }
    if (intent) { playClip(intent); emote(intent); }
    S.faceUntil = now() + 3500;
  }
  const clampZone = (x, z) => { const zz = S.zone; if (!zz) return [x, z]; const dx = x - zz.c[0], dz = z - zz.c[2], d = Math.hypot(dx, dz), m = zz.r * 0.92; return d > m ? [zz.c[0] + dx / d * m, zz.c[2] + dz / d * m] : [x, z]; };
  function walkTo(x, z) {
    [x, z] = clampZone(x, z);
    if (S.walkRes) { const r = S.walkRes; S.walkRes = null; r(false); }
    if (Math.hypot(x - S.pos[0], z - S.pos[2]) < 0.05) return Promise.resolve(true);
    S.target = [x, z]; S.walking = true; clearTimeout(S.animTimer); setAnim({ name: 'walk_cycle', loop: true, k: Math.random() });
    setIcon(null);
    return new Promise(res => { S.walkRes = res; });
  }
  function stopWalk() {
    if (S.walkRes) { const r = S.walkRes; S.walkRes = null; r(false); }
    if (S.walking) { S.walking = false; S.target = null; setAnim({ name: pick(CLIPS.idle), loop: true, k: Math.random() }); }
  }
  function zoneRandom() { const zz = S.zone, a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * zz.r * 0.9; return [zz.c[0] + Math.cos(a) * d, zz.c[2] + Math.sin(a) * d]; }
  function zoneFront(jit) {
    const zz = S.zone; let dx = S.cam[0] - zz.c[0], dz = S.cam[2] - zz.c[2]; const d = Math.hypot(dx, dz) || 1; dx /= d; dz /= d;
    const k = Math.max(0, Math.min(zz.r * 0.8, d - 0.9)), j = jit ? (Math.random() - 0.5) * 0.5 : 0;
    return clampZone(zz.c[0] + dx * k - dz * j, zz.c[2] + dz * k + dx * j);
  }

  // 1秒に30回:歩く・向きを変える
  useEffect(() => {
    const id = setInterval(() => {
      if (S.screen !== 'home' && S.screen !== 'zone') return;
      const dt = 1 / 30; let moved = false; let face = null;
      if (S.target) {
        const dx = S.target[0] - S.pos[0], dz = S.target[1] - S.pos[2], d = Math.hypot(dx, dz), step = 0.55 * dt;
        face = Math.atan2(dx, dz) * 180 / Math.PI;
        if (d <= step) { S.pos = [S.target[0], S.pos[1], S.target[1]]; S.target = null; S.walking = false; setAnim({ name: pick(CLIPS.idle), loop: true, k: Math.random() }); const r = S.walkRes; S.walkRes = null; r && r(true); }
        else S.pos = [S.pos[0] + dx / d * step, S.pos[1], S.pos[2] + dz / d * step];
        moved = true;
      } else if (now() < S.faceUntil) face = Math.atan2(S.cam[0] - S.pos[0], S.cam[2] - S.pos[2]) * 180 / Math.PI;   // 話すときはこちらを向く
      if (face !== null) {
        let t = face - S.yaw; t = ((t + 540) % 360) - 180;
        if (Math.abs(t) > 0.5) { S.yaw += t * 0.2; moved = true; }
      }
      if (moved) setFrame({ pos: S.pos.slice(), yaw: S.yaw });
    }, 33);
    return () => clearInterval(id);
  }, []);

  // 吹き出しを頭の上に出す(3Dの位置 → 画面の位置)
  useEffect(() => {
    if (!bubble && !icon && !popItem) return;
    const id = setInterval(async () => {
      if (!S.nav || !S.nav.project) return;
      try {
        const r = await S.nav.project([S.pos[0], S.pos[1] + 1.78 * scale, S.pos[2]]);
        let [x, y] = r.screenPosition || r; if (x > SW * 1.3 || y > SH * 1.3) { x /= PixelRatio.get(); y /= PixelRatio.get(); }
        setBubblePos([x, y]);
      } catch (_) {}
    }, 120);
    return () => clearInterval(id);
  }, [bubble, icon, popItem, scale]);

  // 頭脳を動かす(暮らす場所が決まったら)
  useEffect(() => {
    if (screen !== 'home' || !data || S.brain) return;
    const io = {
      say, walkTo, stop: stopWalk, zoneRandom, zoneFront, toast: showToast,
      setIcon: e => setIcon(e), setSleep: v => { setSleeping(v); if (v) setExpr('neutral'); },
      pop: (e, ms) => { setPopItem(e); setTimeout(() => setPopItem(null), ms || 3000); },
      hand: ms => new Promise(res => { setHand({ x: SW * (0.25 + Math.random() * 0.5), y: SH * 0.34, res }); setTimeout(() => { setHand(h => { if (h) h.res(false); return null; }); }, ms); }),
      choose: (options, hint, ms, big) => new Promise(res => { let done = false; const fin = v => { if (done) return; done = true; setChoice(null); res(v); }; setChoice({ options, hint, big, fin }); setTimeout(() => fin(null), ms); }),
      openSnacks: () => setSheet('snacks'), factsChanged: () => force(x => x + 1),
      save: d => { AsyncStorage.setItem(KEY, JSON.stringify(d)).catch(() => {}); },
      ready: () => S.screen === 'home' && S.active && !S.settingsOpen,
    };
    S.brain = makeBrain(data, io);
    S.brain.start();
    return () => { S.brain && S.brain.stopAll(); S.brain = null; };
  }, [screen, data]);

  // 声で話しかける
  useSpeechRecognitionEvent('result', e => { const t = e.results && e.results[0] && e.results[0].transcript; if (t && e.isFinal !== false) { S.brain && S.brain.talk(t); } });
  useSpeechRecognitionEvent('end', () => setListening(false));
  async function mic() {
    if (listening) { ExpoSpeechRecognitionModule.stop(); return; }
    const p = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!p.granted) { showToast('マイクと音声認識を許可してね'); return; }
    ExpoSpeechRecognitionModule.start({ lang: 'ja-JP', interimResults: false }); setListening(true); showToast('話しかけてね');
  }
  const send = () => { const t = text; setText(''); S.brain && S.brain.talk(t); };

  /* ---------- 床を見つける・広さを決める ---------- */
  const onHit = e => {
    if (S.screen !== 'find') return;
    const t = now(); if (t - S.lastHitAt < 120) return; S.lastHitAt = t;
    const h = (e.hitTestResults || []).find(r => /Plane/.test(r.type));
    S.hit = h ? h.transform.position : null; setReticle(S.hit);
    if (e.cameraOrientation) S.cam = e.cameraOrientation.position;
  };
  const onCam = c => { S.cam = c.position || (c.cameraTransform && c.cameraTransform.position) || S.cam; };
  function placeHere() {
    if (!S.hit) return;
    const c = S.hit; setZone({ c, r: 1.4 }); S.pos = [c[0], c[1], c[2]]; S.yaw = Math.atan2(S.cam[0] - c[0], S.cam[2] - c[2]) * 180 / Math.PI;
    setFrame({ pos: S.pos.slice(), yaw: S.yaw }); setReticle(null); setRingOpacity(0.8); setScreen('zone');
  }
  function liveHere() {
    setScreen('home'); setRingOpacity(0.3); setTimeout(() => setRingOpacity(0), 3000);
  }
  function redoZone() { setSettingsOpen(false); stopWalk(); setZone(null); setScreen('find'); }

  const appProps = useMemo(() => ({
    onNav: n => { S.nav = n; }, onHit, onCam, reticle: screen === 'find' ? reticle : null, zone, ringOpacity,
    avatarVisible: !!zone && (screen === 'zone' || screen === 'home'), pos: frame.pos, yaw: frame.yaw, scale, expr,
    anim: { name: anim.name, run: true, loop: anim.loop, interruptible: true },
    onAvatarTap: () => S.brain && S.brain.shoulderTap(),
    onFloorTap: pos => { if (S.screen === 'home' && S.brain && pos) S.brain.callTo(pos[0], pos[2]); },
    onPinch: (state, f) => { if (state === 2) setScale(s => Math.max(0.3, Math.min(1.3, s * (f > 1 ? 1.02 : 0.98)))); },
  }), [screen, reticle, zone, ringOpacity, frame, scale, expr, anim]);

  /* ---------- 画面 ---------- */
  if (screen === 'start') {
    return (
      <View style={[st.fill, st.center, { backgroundColor: '#0b0b14', padding: 32, gap: 28 }]}>
        <StatusBar style="light" />
        <View style={st.logo}><Text style={{ color: ACCENT, fontSize: 44, fontWeight: '900' }}>Y</Text></View>
        <View style={{ alignItems: 'center', gap: 10 }}>
          <Text style={{ color: '#fff', fontSize: 40, fontWeight: '900', letterSpacing: 1 }}>You AR</Text>
          <Text style={{ color: '#c9c6d6', fontSize: 15, lineHeight: 26, textAlign: 'center' }}>カメラ越しの部屋で、{'\n'}3Dの「あなた」とルームメイトとして暮らそう。</Text>
        </View>
        <View style={{ width: '100%', alignItems: 'center', gap: 12 }}>
          <Pressable style={[st.btn, { width: '100%', height: 56 }]} onPress={() => setScreen('find')} disabled={!data}><Text style={st.btnText}>{data ? 'はじめる' : '準備中…'}</Text></Pressable>
          <Text style={{ color: '#a9a5b8', fontSize: 12 }}>カメラの映像は端末の外に送信されません</Text>
        </View>
      </View>
    );
  }

  const d = data || defData();
  return (
    <View style={st.fill}>
      <StatusBar style="light" />
      <ViroARSceneNavigator style={st.fill} autofocus initialScene={{ scene: RoomScene }} viroAppProps={appProps}
        shadowsEnabled pbrEnabled hdrEnabled occlusionMode="peopleOnly" worldAlignment="Gravity" />

      {/* 吹き出し・今していること・おやつ */}
      {bubble && bubblePos && screen === 'home' ? (
        <View pointerEvents="none" style={[st.bubble, { left: Math.max(16, Math.min(SW - 236, bubblePos[0] - 110)), top: Math.max(TOP + 50, bubblePos[1] - 90) }]}>
          {bubble.sub ? <Text style={st.bubbleSub}>{bubble.sub}</Text> : null}
          <Text style={st.bubbleText}>{bubble.text}</Text>
        </View>
      ) : null}
      {(icon || sleeping) && bubblePos && screen === 'home' && !bubble ? (
        <View pointerEvents="none" style={[st.icon, { left: bubblePos[0] + 24, top: bubblePos[1] + 10 }]}><Text style={{ fontSize: 20 }}>{sleeping ? '💤' : icon}</Text></View>
      ) : null}
      {popItem ? <View pointerEvents="none" style={st.pop}><Text style={{ fontSize: 56 }}>{popItem}</Text></View> : null}
      {hand ? <Pressable onPress={() => { hand.res(true); setHand(null); }} style={[st.hand, { left: hand.x - 44, top: hand.y - 44 }]}><Text style={{ fontSize: 56 }}>✋</Text></Pressable> : null}
      {toast ? <View pointerEvents="none" style={st.toast}><Text style={{ color: '#fff', fontSize: 13 }}>{toast}</Text></View> : null}

      {/* ① 床を見つける / ② 広さを決める */}
      {screen === 'find' ? (
        <View style={st.panel}>
          <Text style={st.panelTitle}>① 床を見つけよう</Text>
          <Text style={st.panelText}>スマホをゆっくり動かして床を映してね。白い丸が出たら、暮らす場所の真ん中に合わせて「ここ」を押してね。</Text>
          <Pressable style={[st.btn, !reticle && { opacity: 0.4 }]} disabled={!reticle} onPress={placeHere}><Text style={st.btnText}>ここ</Text></Pressable>
        </View>
      ) : null}
      {screen === 'zone' && zone ? (
        <View style={st.panel}>
          <Text style={st.panelTitle}>② 広さを決めよう</Text>
          <Text style={st.panelText}>ピンクの円の中を、僕が歩き回るよ。</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Pressable style={[st.btnSub, { flex: 1 }]} onPress={() => setZone(z => ({ ...z, r: Math.max(0.4, z.r - 0.2) }))}><Text style={st.btnText}>狭く</Text></Pressable>
            <Text style={{ color: '#d7d4e2', width: 64, textAlign: 'center' }}>{zone.r.toFixed(1)}m</Text>
            <Pressable style={[st.btnSub, { flex: 1 }]} onPress={() => setZone(z => ({ ...z, r: Math.min(3, z.r + 0.2) }))}><Text style={st.btnText}>広く</Text></Pressable>
          </View>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Pressable style={[st.btnSub, { flex: 1 }]} onPress={redoZone}><Text style={st.btnText}>やり直す</Text></Pressable>
            <Pressable style={[st.btn, { flex: 2 }]} onPress={liveHere}><Text style={st.btnText}>ここで暮らす</Text></Pressable>
          </View>
        </View>
      ) : null}

      {/* 一緒に暮らす */}
      {screen === 'home' ? (
        <>
          <Pressable accessibilityLabel="設定" style={st.gear} onPress={() => setSettingsOpen(true)}><Text style={{ color: '#fff', fontSize: 20 }}>⚙</Text></Pressable>
          {choice ? (
            <View style={st.choice}>
              {choice.hint ? <Text style={{ color: '#d7d4e2', width: '100%', textAlign: 'center', marginBottom: 4 }}>{choice.hint}</Text> : null}
              {choice.options.map(o => (
                <Pressable key={o.key} style={[st.choiceBtn, choice.big && { minWidth: 76 }]} onPress={() => choice.fin(o.key)}><Text style={{ color: '#fff', fontSize: choice.big ? 34 : 16, fontWeight: '700' }}>{o.label}</Text></Pressable>
              ))}
            </View>
          ) : null}
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'position' : undefined} style={st.barWrap}>
            <View style={st.bar}>
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                <TextInput value={text} onChangeText={setText} onSubmitEditing={send} returnKeyType="send" placeholder="話しかける言葉を入力…" placeholderTextColor="#8a8796" style={st.input} accessibilityLabel="話しかける言葉" />
                <Pressable accessibilityLabel="送信" style={st.round} onPress={send}><Text style={{ color: '#fff', fontSize: 18 }}>➤</Text></Pressable>
                <Pressable accessibilityLabel="声で話しかける" style={[st.round, { backgroundColor: listening ? '#e11' : 'rgba(255,255,255,0.18)' }]} onPress={mic}><Text style={{ color: '#fff', fontSize: 18 }}>🎤</Text></Pressable>
              </View>
              <Pressable style={st.btnSub} onPress={() => setSheet('menu')}><Text style={st.btnText}>いっしょに</Text></Pressable>
            </View>
          </KeyboardAvoidingView>
        </>
      ) : null}

      {/* いっしょに(下から出るメニュー) */}
      <Modal visible={!!sheet} transparent animationType="slide" onRequestClose={() => setSheet(null)}>
        <Pressable style={{ flex: 1 }} onPress={() => setSheet(null)} />
        <View style={st.sheet}>
          <View style={st.grabber} />
          {sheet === 'menu' ? (
            <>
              <Text style={st.sheetTitle}>いっしょに</Text>
              {[
                ['食', 'おやつを食べる', '一緒に食べるおやつを選ぶ', () => setSheet('snacks')],
                ['肩', '肩をたたく', 'こっちを向いて、話しかけてくる', () => { setSheet(null); S.brain && S.brain.shoulderTap(); }],
                ['揉', '肩をもんでもらう', '疲れたときに', () => { setSheet(null); S.brain && S.brain.massage(); }],
                ['手', 'ハイタッチ', '出てきた手をタップ', () => { setSheet(null); S.brain && S.brain.highFive(); }],
                ['拳', 'じゃんけん', '勝ち負けを覚えている', () => { setSheet(null); S.brain && S.brain.janken(); }],
              ].map(([m, t, s, fn]) => (
                <Pressable key={t} style={st.row} onPress={fn}>
                  <View style={st.rowMark}><Text style={{ color: '#fff', fontWeight: '900' }}>{m}</Text></View>
                  <View><Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>{t}</Text><Text style={{ color: '#b4b0c4', fontSize: 12 }}>{s}</Text></View>
                </Pressable>
              ))}
            </>
          ) : (
            <>
              <Text style={st.sheetTitle}>一緒に食べるおやつ</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                {SNACKS.map(sn => (
                  <Pressable key={sn.n} style={st.snack} onPress={() => { setSheet(null); S.brain && S.brain.snack(sn); }}>
                    <Text style={{ fontSize: 30 }}>{sn.e}</Text><Text style={{ color: '#d7d4e2', fontSize: 11 }}>{sn.n}</Text>
                  </Pressable>
                ))}
              </View>
            </>
          )}
        </View>
      </Modal>

      {/* 設定 */}
      <Modal visible={settingsOpen} animationType="slide" onRequestClose={() => setSettingsOpen(false)}>
        <ScrollView style={{ flex: 1, backgroundColor: '#0b0b14' }} contentContainerStyle={{ padding: 20, paddingTop: TOP, paddingBottom: 48, gap: 16 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ color: '#fff', fontSize: 26, fontWeight: '900' }}>設定</Text>
            <Pressable style={[st.btn, { height: 40, paddingHorizontal: 18 }]} onPress={() => { setSettingsOpen(false); saveData(); }}><Text style={st.btnText}>閉じる</Text></Pressable>
          </View>
          <Text style={st.label}>ルームメイトの名前</Text>
          <TextInput style={st.field} defaultValue={d.name === 'ルームメイト' ? '' : d.name} placeholder="ルームメイト" placeholderTextColor="#77738a" onEndEditing={e => { d.name = e.nativeEvent.text.trim() || 'ルームメイト'; saveData(); }} />
          <Text style={st.label}>あなたの名前</Text>
          <TextInput style={st.field} defaultValue={d.userName} placeholder="呼んでほしい名前" placeholderTextColor="#77738a" onEndEditing={e => { d.userName = e.nativeEvent.text.trim(); saveData(); force(x => x + 1); }} />
          <View style={st.card}>
            {[['tts', '声で返事する', 'iPhoneの読み上げ音声'], ['chatter', 'ときどき自分から話しかけてくる', ''], ['notify', 'しばらく会わないと、ひとことメッセージ', '通知(夜は送りません)']].map(([k, t, s]) => (
              <View key={k} style={st.toggleRow}>
                <View style={{ flex: 1 }}><Text style={{ color: '#fff', fontSize: 15 }}>{t}</Text>{s ? <Text style={{ color: '#b4b0c4', fontSize: 12 }}>{s}</Text> : null}</View>
                <Switch value={!!d.settings[k]} trackColor={{ true: ACCENT }} onValueChange={async v => {
                  if (k === 'notify' && v) { const p = await Notifications.requestPermissionsAsync(); if (!p.granted) { Alert.alert('通知が許可されませんでした'); return; } }
                  d.settings[k] = v; saveData(); force(x => x + 1);
                }} />
              </View>
            ))}
          </View>
          <Text style={st.label}>おぼえていること</Text>
          {d.facts.length ? d.facts.slice().reverse().map(f => (
            <View key={f.key} style={st.fact}>
              <Text style={{ color: '#fff', fontSize: 14, flex: 1 }}>{f.text}</Text>
              <Pressable style={st.factBtn} onPress={() => { d.facts = d.facts.filter(x => x !== f); saveData(); force(x => x + 1); }}><Text style={{ color: '#fff', fontSize: 12 }}>消す</Text></Pressable>
            </View>
          )) : <Text style={{ color: '#8a8796' }}>まだ何も覚えていません。話してみてね。</Text>}
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
            <Pressable style={[st.btnSub, { flex: 1, backgroundColor: '#221f30' }]} onPress={redoZone}><Text style={[st.btnText, { fontSize: 14 }]}>暮らす場所を決め直す</Text></Pressable>
            <Pressable style={[st.btnSub, { flex: 1, backgroundColor: '#3a1f2a' }]} onPress={() => Alert.alert('思い出を全部消す', 'はじめましてからやり直しますか?', [{ text: 'やめる' }, { text: '消す', style: 'destructive', onPress: () => { AsyncStorage.removeItem(KEY); const nd = defData(); S.brain && S.brain.stopAll(); S.brain = null; setData(nd); setSettingsOpen(false); } }])}><Text style={[st.btnText, { fontSize: 14, color: '#ffd6e2' }]}>思い出を全部消す</Text></Pressable>
          </View>
        </ScrollView>
      </Modal>
    </View>
  );
}

const st = StyleSheet.create({
  fill: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  logo: { width: 96, height: 96, borderRadius: 28, backgroundColor: '#1c1630', alignItems: 'center', justifyContent: 'center' },
  btn: { height: 50, borderRadius: 999, backgroundColor: ACCENT, alignItems: 'center', justifyContent: 'center' },
  btnSub: { height: 48, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  panel: { position: 'absolute', left: 16, right: 16, top: TOP, padding: 18, borderRadius: 22, backgroundColor: 'rgba(10,10,20,0.86)', gap: 14 },
  panelTitle: { color: '#fff', fontSize: 17, fontWeight: '700' },
  panelText: { color: '#d7d4e2', fontSize: 14, lineHeight: 24 },
  bubble: { position: 'absolute', width: 220, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 18, backgroundColor: '#fff', alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 10 },
  bubbleSub: { color: '#6a6778', fontSize: 11, marginBottom: 2 },
  bubbleText: { color: '#141320', fontSize: 16, fontWeight: '700', textAlign: 'center' },
  icon: { position: 'absolute', width: 36, height: 36, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.92)', alignItems: 'center', justifyContent: 'center' },
  pop: { position: 'absolute', left: 0, right: 0, bottom: 200, alignItems: 'center' },
  hand: { position: 'absolute', width: 88, height: 88, borderRadius: 44, backgroundColor: 'rgba(255,255,255,0.25)', alignItems: 'center', justifyContent: 'center' },
  toast: { position: 'absolute', alignSelf: 'center', bottom: 190, paddingVertical: 8, paddingHorizontal: 16, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.7)' },
  gear: { position: 'absolute', right: 14, top: TOP - 2, width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(10,10,20,0.55)', alignItems: 'center', justifyContent: 'center' },
  barWrap: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  bar: { paddingHorizontal: 14, paddingTop: 14, paddingBottom: BOTTOM, backgroundColor: 'rgba(10,10,20,0.62)', gap: 12 },
  input: { flex: 1, height: 46, borderRadius: 999, paddingHorizontal: 18, fontSize: 15, backgroundColor: '#fff', color: '#141320' },
  round: { width: 46, height: 46, borderRadius: 23, backgroundColor: ACCENT, alignItems: 'center', justifyContent: 'center' },
  choice: { position: 'absolute', left: 16, right: 16, bottom: 200, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 10, padding: 12, borderRadius: 20, backgroundColor: 'rgba(10,10,20,0.8)' },
  choiceBtn: { minHeight: 52, paddingHorizontal: 16, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center' },
  sheet: { padding: 16, paddingBottom: BOTTOM + 8, borderTopLeftRadius: 26, borderTopRightRadius: 26, backgroundColor: '#13121c', gap: 10 },
  grabber: { width: 40, height: 5, borderRadius: 3, backgroundColor: '#4a4758', alignSelf: 'center', marginBottom: 6 },
  sheetTitle: { color: '#fff', fontSize: 17, fontWeight: '700', marginBottom: 4 },
  row: { height: 58, borderRadius: 16, backgroundColor: '#221f30', flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16 },
  rowMark: { width: 36, height: 36, borderRadius: 12, backgroundColor: ACCENT, alignItems: 'center', justifyContent: 'center' },
  snack: { width: 76, height: 76, borderRadius: 16, backgroundColor: '#221f30', alignItems: 'center', justifyContent: 'center' },
  label: { color: '#b4b0c4', fontSize: 13 },
  field: { height: 46, borderRadius: 12, paddingHorizontal: 14, fontSize: 15, backgroundColor: '#221f30', color: '#fff' },
  card: { borderRadius: 16, backgroundColor: '#16141f', overflow: 'hidden' },
  toggleRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#262333' },
  fact: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 14, paddingRight: 6, borderRadius: 12, backgroundColor: '#16141f' },
  factBtn: { height: 34, paddingHorizontal: 12, borderRadius: 999, backgroundColor: '#2c2940', alignItems: 'center', justifyContent: 'center' },
});
