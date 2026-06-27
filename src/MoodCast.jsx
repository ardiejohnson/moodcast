import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { LineChart, Line, XAxis, YAxis, ReferenceLine, ReferenceArea, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { geoNaturalEarth1, geoPath } from "d3-geo";
import { feature as topoFeature } from "topojson-client";
import world110m from "./world-110m.json";

/* ----------------------------------------------------------------------
   MOODCAST - a weather app for public mood.
   Hero index - 7 categories - drill-down - open search & questions -
   saveable + reorderable subjects - per-entity graphs - custom view -
   settings - share card. Taxonomy is pure data.
   ---------------------------------------------------------------------- */

const INK = "#1B2330", INK2 = "#5A6472", LINE = "#E3E7EC", PAPER = "#F1F4F7", CARD = "#FFFFFF", ACCENT = "#1B2330";
const F = { display: "'Bricolage Grotesque', system-ui, sans-serif", ui: "'Plus Jakarta Sans', system-ui, sans-serif" };

const CATEGORIES = [
  { id: "econ", label: "Economy & Cost of Living", query: "cost of living and economy news today", subs: [
    { id: "infl", label: "Inflation", query: "inflation news today" },
    { id: "house", label: "Housing & Rent", query: "housing costs and rent news today" },
    { id: "jobs", label: "Jobs & Wages", query: "jobs and wages news today" },
    { id: "price", label: "Prices & Groceries", query: "grocery prices and cost of goods news" }] },
  { id: "pol", label: "Politics", query: "politics news today", subs: [
    { id: "elec", label: "Elections", query: "elections and campaigns news today" },
    { id: "policy", label: "Policy & Law", query: "policy and legislation news today" },
    { id: "gov", label: "Government & Leaders", query: "government and political leaders news today" },
    { id: "controv", label: "Controversy", query: "political controversy news today" }] },
  { id: "world", label: "World & Current Events", query: "world news and current events today", subs: [
    { id: "conflict", label: "Conflict & War", query: "global conflict and war news today" },
    { id: "climate", label: "Disasters & Climate", query: "natural disasters and climate news today" },
    { id: "diplo", label: "Diplomacy", query: "international diplomacy news today" },
    { id: "breaking", label: "Breaking News", query: "major breaking world news today" }] },
  { id: "tech", label: "Tech & AI", query: "technology and AI news today", subs: [
    { id: "ai", label: "Artificial Intelligence", query: "artificial intelligence news today" },
    { id: "bigtech", label: "Big Tech", query: "big tech company news today" },
    { id: "gadgets", label: "Gadgets & Products", query: "new gadgets and tech products news" },
    { id: "startup", label: "Startups", query: "startup and venture news today" }] },
  { id: "health", label: "Health & Mental Health", query: "health and mental health news today", subs: [
    { id: "mh", label: "Mental Health", query: "mental health news this week" },
    { id: "care", label: "Healthcare", query: "healthcare and medicine news today" },
    { id: "fit", label: "Fitness & Wellness", query: "fitness and wellness news this week" },
    { id: "research", label: "Medical Research", query: "medical research breakthroughs news" }] },
  { id: "money", label: "Money & Markets", query: "stock market and finance news today", subs: [
    { id: "stocks", label: "Stocks", query: "stock market news today" },
    { id: "crypto", label: "Crypto", query: "cryptocurrency news today" },
    { id: "housing", label: "Housing Market", query: "housing market news today" },
    { id: "biz", label: "Business", query: "business and corporate news today" }] },
  { id: "culture", label: "Culture & Entertainment", query: "entertainment and pop culture news today", subs: [
    { id: "screen", label: "Movies & TV", query: "movies and TV news this week" },
    { id: "music", label: "Music", query: "music news this week" },
    { id: "celeb", label: "Celebrities", query: "celebrity news this week" },
    { id: "sport", label: "Sports", query: "sports news today" },
    { id: "viral", label: "Viral & Internet", query: "viral internet culture news this week" }] },
];

const STOPS = [[0,[46,53,80]],[20,[70,87,122]],[38,[124,133,149]],[50,[182,169,142]],[65,[224,178,94]],[80,[244,169,59]],[100,[255,196,77]]];
function moodRGB(m){ m=Math.max(0,Math.min(100,m)); for(let i=0;i<STOPS.length-1;i++){const[a,ca]=STOPS[i],[b,cb]=STOPS[i+1];if(m<=b){const t=(m-a)/(b-a||1);return ca.map((v,k)=>Math.round(v+(cb[k]-v)*t));}} return STOPS[STOPS.length-1][1]; }
const rgb=(a)=>`rgb(${a[0]},${a[1]},${a[2]})`;
const scl=(a,f)=>a.map(v=>Math.round(Math.max(0,Math.min(255,v*f))));
const moodColor=(m)=>m==null?"#AEB4BD":rgb(moodRGB(m));
const moodWord=(m)=>m==null?"No mood yet":m<18?"Stormy":m<34?"Rainy":m<46?"Overcast":m<60?"Partly cloudy":m<74?"Fair":m<88?"Sunny":"Radiant";
const glyphType=(m)=>m==null?"none":m<18?"storm":m<34?"rain":m<46?"cloud":m<60?"partly":m<74?"fair":m<88?"sun":"radiant";
const toMood=(s)=>Math.round((Math.max(-100,Math.min(100,s))+100)/2);
const appendSeries=(prev,mood,t,cap=160)=>{ if(mood==null)return prev||[]; return [...(prev||[]),{t,mood}].slice(-cap); };
const slug=(s)=>"sub:"+s.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,42);

/* AI-estimated monthly reconstruction of overall public/news sentiment (0 stormy .. 100 radiant),
   generated once from the major events of each month. This is a rough reconstruction, NOT a
   measurement — it seeds the trend chart with a long arc; real readings accumulate after it. */
const SEED_MONTHLY = [
  [2020,1,47],[2020,2,41],[2020,3,22],[2020,4,25],[2020,5,27],[2020,6,31],[2020,7,33],[2020,8,35],[2020,9,34],[2020,10,31],[2020,11,39],[2020,12,41],
  [2021,1,30],[2021,2,38],[2021,3,43],[2021,4,45],[2021,5,49],[2021,6,51],[2021,7,46],[2021,8,34],[2021,9,41],[2021,10,45],[2021,11,47],[2021,12,39],
  [2022,1,40],[2022,2,27],[2022,3,30],[2022,4,35],[2022,5,32],[2022,6,31],[2022,7,37],[2022,8,41],[2022,9,39],[2022,10,41],[2022,11,45],[2022,12,47],
  [2023,1,46],[2023,2,43],[2023,3,41],[2023,4,47],[2023,5,49],[2023,6,51],[2023,7,49],[2023,8,45],[2023,9,49],[2023,10,31],[2023,11,36],[2023,12,41],
  [2024,1,43],[2024,2,45],[2024,3,47],[2024,4,44],[2024,5,46],[2024,6,47],[2024,7,39],[2024,8,44],[2024,9,45],[2024,10,42],[2024,11,47],[2024,12,49],
  [2025,1,49],[2025,2,47],[2025,3,49],[2025,4,43],[2025,5,46],[2025,6,49],[2025,7,51],[2025,8,49],[2025,9,51],[2025,10,49],[2025,11,51],[2025,12,53],
  [2026,1,50],[2026,2,50],[2026,3,50],[2026,4,49],[2026,5,50],
];
const SEED_HISTORY = SEED_MONTHLY.map(([y,m,v])=>({ t: Date.UTC(y, m-1, 1), overall: v, est: true }));

/* A 250-year reconstruction of U.S. public mood (0 stormy .. 100 radiant, 50 neutral), one point
   per year, 1776–2019. This is NOT a measurement. Scientific opinion polling did not exist before
   the 1930s, so earlier years are historically-grounded ESTIMATES built from documented conditions
   — wars, financial panics, depressions, booms. From 1952 onward the arc tracks the University of
   Michigan Index of Consumer Sentiment; from 1979, Gallup's satisfaction-with-direction series.
   Sources: U. Michigan Surveys of Consumers (sca.isr.umich.edu); Gallup; U.S. economic history. */
const SEED_ANNUAL = [
  [1776,58],[1777,44],[1778,48],[1779,45],[1780,42],[1781,60],[1782,56],[1783,60],[1784,48],[1785,45],
  [1786,41],[1787,50],[1788,60],[1789,64],[1790,60],[1791,60],[1792,58],[1793,52],[1794,50],[1795,56],
  [1796,54],[1797,50],[1798,46],[1799,48],[1800,54],[1801,58],[1802,58],[1803,64],[1804,62],[1805,60],
  [1806,56],[1807,46],[1808,44],[1809,48],[1810,52],[1811,50],[1812,46],[1813,44],[1814,40],[1815,60],
  [1816,54],[1817,64],[1818,64],[1819,44],[1820,46],[1821,50],[1822,54],[1823,58],[1824,56],[1825,60],
  [1826,56],[1827,56],[1828,54],[1829,56],[1830,58],[1831,56],[1832,54],[1833,56],[1834,54],[1835,58],
  [1836,58],[1837,40],[1838,38],[1839,38],[1840,40],[1841,40],[1842,42],[1843,46],[1844,52],[1845,56],
  [1846,54],[1847,56],[1848,60],[1849,62],[1850,54],[1851,56],[1852,56],[1853,56],[1854,50],[1855,48],
  [1856,46],[1857,42],[1858,44],[1859,44],[1860,42],[1861,38],[1862,35],[1863,38],[1864,40],[1865,46],
  [1866,48],[1867,48],[1868,48],[1869,52],[1870,54],[1871,52],[1872,54],[1873,42],[1874,38],[1875,38],
  [1876,40],[1877,44],[1878,48],[1879,52],[1880,56],[1881,54],[1882,56],[1883,54],[1884,50],[1885,52],
  [1886,50],[1887,54],[1888,54],[1889,56],[1890,52],[1891,52],[1892,52],[1893,36],[1894,33],[1895,38],
  [1896,42],[1897,48],[1898,56],[1899,60],[1900,60],[1901,56],[1902,58],[1903,58],[1904,56],[1905,58],
  [1906,54],[1907,44],[1908,50],[1909,54],[1910,54],[1911,54],[1912,54],[1913,54],[1914,48],[1915,50],
  [1916,52],[1917,48],[1918,42],[1919,44],[1920,46],[1921,46],[1922,56],[1923,58],[1924,60],[1925,62],
  [1926,62],[1927,62],[1928,64],[1929,58],[1930,42],[1931,34],[1932,26],[1933,30],[1934,36],[1935,40],
  [1936,44],[1937,40],[1938,38],[1939,42],[1940,46],[1941,44],[1942,44],[1943,48],[1944,54],[1945,62],
  [1946,56],[1947,56],[1948,58],[1949,56],[1950,56],[1951,56],[1952,60],[1953,62],[1954,62],[1955,64],
  [1956,64],[1957,58],[1958,56],[1959,60],[1960,60],[1961,62],[1962,62],[1963,56],[1964,64],[1965,66],
  [1966,64],[1967,60],[1968,48],[1969,56],[1970,52],[1971,52],[1972,56],[1973,48],[1974,42],[1975,44],
  [1976,52],[1977,54],[1978,52],[1979,42],[1980,40],[1981,44],[1982,42],[1983,54],[1984,62],[1985,62],
  [1986,64],[1987,60],[1988,62],[1989,62],[1990,54],[1991,52],[1992,54],[1993,58],[1994,60],[1995,62],
  [1996,64],[1997,66],[1998,68],[1999,70],[2000,70],[2001,54],[2002,54],[2003,54],[2004,56],[2005,54],
  [2006,56],[2007,56],[2008,36],[2009,40],[2010,44],[2011,44],[2012,48],[2013,48],[2014,52],[2015,58],
  [2016,54],[2017,58],[2018,58],[2019,58],
];
/* Notable events surfaced on the long-range chart tooltip. */
const MOOD_EVENTS = {
  1776:"Declaration of Independence",1781:"Victory at Yorktown",1783:"Independence won (Treaty of Paris)",
  1786:"Shays' Rebellion · postwar depression",1789:"Washington inaugurated",1803:"Louisiana Purchase",
  1807:"Embargo Act",1812:"War of 1812 begins",1814:"British burn Washington",1815:"War ends · New Orleans",
  1817:"Era of Good Feelings",1819:"Panic of 1819 — first depression",1825:"Erie Canal opens",
  1837:"Panic of 1837 — long depression",1845:"Manifest Destiny · Texas",1849:"California Gold Rush",
  1857:"Panic of 1857",1861:"Civil War begins",1863:"Gettysburg · Emancipation",1865:"Union victory · Lincoln killed",
  1869:"Transcontinental Railroad",1873:"Panic of 1873 — Long Depression",1893:"Panic of 1893 — severe depression",
  1898:"Spanish-American War",1900:"New century optimism",1907:"Panic of 1907",1917:"U.S. enters WWI",
  1918:"WWI · Spanish flu pandemic",1929:"Stock market crash",1932:"Depths of the Great Depression",
  1933:"New Deal begins",1941:"Pearl Harbor — WWII",1945:"Victory in WWII",1955:"Postwar boom peak",
  1963:"JFK assassinated",1965:"Peak consumer confidence",1968:"Assassinations · unrest · Tet",
  1969:"Moon landing",1974:"Watergate · oil crisis",1979:"Malaise · Iran hostage crisis",
  1980:"Record-low sentiment · recession",1983:"“Morning in America” recovery",1989:"Berlin Wall falls",
  1999:"Dot-com peak · 71% satisfied",2000:"Highest consumer sentiment",2001:"Dot-com bust · 9/11",
  2008:"Financial crisis · 7% satisfied",2011:"Debt-ceiling · S&P downgrade",2015:"Recovery strengthens",
  2020:"COVID-19 pandemic",2022:"Inflation · record-low sentiment",
};
const SEED_ANNUAL_HISTORY = SEED_ANNUAL.map(([y,v])=>({ t: Date.UTC(y,6,1), overall: v, est: true, ev: MOOD_EVENTS[y] }));
// Full estimated backdrop: annual 1776–2019 + monthly 2020→. Live readings layer on top.
const LONG_HISTORY = [...SEED_ANNUAL_HISTORY, ...SEED_HISTORY.map(s=>({...s, ev: MOOD_EVENTS[new Date(s.t).getUTCFullYear()] }))];
// Range presets for the trend chart (label → milliseconds; null = all 250 years).
const YEAR_MS = 365.25*24*3600*1000;
const RANGES = [
  ["1W",7*24*3600*1000],["1M",30*24*3600*1000],["6M",182*24*3600*1000],["1Y",YEAR_MS],["5Y",5*YEAR_MS],
  ["10Y",10*YEAR_MS],["20Y",20*YEAR_MS],["50Y",50*YEAR_MS],["100Y",100*YEAR_MS],["250Y",null],
];

const store = {
  async get(k){ try{ const v=localStorage.getItem(k); return v?JSON.parse(v):null; }catch{ return null; } },
  async set(k,v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch{} },
};
function parseJson(t){ if(!t)return null; let s=t.replace(/```json/gi,"").replace(/```/g,"").trim(); try{return JSON.parse(s);}catch{} const a=s.indexOf("{"),b=s.lastIndexOf("}"); if(a!==-1&&b>a){try{return JSON.parse(s.slice(a,b+1));}catch{return null;}} return null; }

let PASSCODE = "";          // set from localStorage on mount / when the user enters it
let onAuthFail = null;      // registered by the app to open the passcode gate on a 401
async function callModel(system, user){
  const res = await fetch("/api/grade", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-moodcast-pass": PASSCODE },
    body: JSON.stringify({ system, user }),
  });
  if(res.status===401){ if(onAuthFail)onAuthFail(); const e=new Error("unauthorized"); e.code=401; throw e; }
  if(!res.ok) throw new Error("HTTP "+res.status);
  const data = await res.json();
  return data.text || "";
}
async function gradeQuery(query, n=4){
  const system = `You are a public-mood analyst. Use web search to find the ${n} most recent items about the subject, `+
    `then grade the emotional tone of each. Respond with ONLY valid JSON, no markdown. Schema: `+
    `{"items":[{"title":"<actual headline, <=16 words>","source":"<outlet>","url":"<url>",`+
    `"summary":"<your own words, <=16 words>","score":<integer -100..100>}]}. Score: -100 very negative, 0 neutral, `+
    `+100 very positive. Judge mood, not importance. Paraphrase summaries. Return exactly ${n} items.`;
  const text = await callModel(system, `Subject: ${query}. Find the ${n} most recent, relevant items.`);
  const p = parseJson(text);
  const items = (p&&Array.isArray(p.items)?p.items:[]).map(it=>({
    title:String(it.title||"Untitled").slice(0,160), source:String(it.source||"").slice(0,50),
    url:typeof it.url==="string"?it.url:"", summary:String(it.summary||"").slice(0,160),
    score:Math.max(-100,Math.min(100,Math.round(Number(it.score)))) })).filter(it=>Number.isFinite(it.score));
  const mood = items.length ? Math.round(items.reduce((s,i)=>s+toMood(i.score),0)/items.length) : null;
  return { mood, items };
}

/* ---- shared board: latest reading + Sunny Side, seen by every visitor (api/board.js) ---- */
async function loadBoard(){
  try{
    const res=await fetch("/api/board",{cache:"no-store"});
    if(!res.ok)return {latest:null,sunny:null};
    const data=await res.json();
    return { latest:data?.latest||null, sunny:data?.sunny||null, dark:data?.dark||null };
  }catch{ return {latest:null,sunny:null,dark:null}; }
}
async function postBoard(payload){
  try{
    await fetch("/api/board",{
      method:"POST",
      headers:{ "Content-Type":"application/json", "x-moodcast-pass":PASSCODE },
      body:JSON.stringify(payload),
    });
  }catch{ /* best-effort; a failed publish must never break the local reading */ }
}
function saveBoardLatest(results,overall){
  // Strip per-device series; the server keeps only mood+items per entry.
  const slim={};
  for(const id in results){ const r=results[id]; if(!r)continue; slim[id]={mood:r.mood,items:r.items||[]}; }
  return postBoard({ results:slim, overall });
}
// Publish the featured story cards so every visitor sees the same ones.
function saveBoardSunny(card){ return postBoard({ sunny:card }); }
function saveBoardDark(card){ return postBoard({ dark:card }); }

/* ---- Mood Map: shared mood per country (see api/world.js) ---- */
async function fetchWorld(){
  try{ const res=await fetch("/api/world",{cache:"no-store"}); if(!res.ok)return {};
    const d=await res.json(); return d.countries||{};
  }catch{ return {}; }
}
async function saveWorldCountry(code,mood,items,label){
  try{ await fetch("/api/world",{ method:"POST",
    headers:{ "Content-Type":"application/json", "x-moodcast-pass":PASSCODE },
    body:JSON.stringify({ code, mood, items:(items||[]).slice(0,4), label }) });
  }catch{ /* best-effort */ }
}

/* ---- Yay/Boo crowd votes (see api/vote.js) ---- */
// Anonymous, stable per browser. Only used to dedup/switch a voter's own vote.
function voterId(){
  try{ let v=localStorage.getItem("ms:voter");
    if(!v){ v=Math.random().toString(36).slice(2,10)+Math.random().toString(36).slice(2,8); localStorage.setItem("ms:voter",v); }
    return v;
  }catch{ return "anon"; }
}
async function fetchVotes(ids){
  const list=(ids||[]).filter(Boolean); if(!list.length)return {votes:{},mine:{}};
  try{
    const res=await fetch(`/api/vote?ids=${encodeURIComponent(list.join(","))}&voter=${encodeURIComponent(voterId())}`,{cache:"no-store"});
    if(!res.ok)return {votes:{},mine:{}};
    const d=await res.json(); return { votes:d.votes||{}, mine:d.mine||{} };
  }catch{ return {votes:{},mine:{}}; }
}
async function castVote(id,dir,meta){
  const res=await fetch("/api/vote",{
    method:"POST",
    headers:{ "Content-Type":"application/json", "x-moodcast-pass":PASSCODE },
    body:JSON.stringify({ id, dir, voter:voterId(), ...(meta?{meta}:{}) }),
  });
  if(!res.ok)throw new Error("vote failed "+res.status);
  return res.json(); // { id, mine, votes:{yay,boo} }
}
async function fetchTopArticles(){
  try{ const res=await fetch("/api/vote?top=1",{cache:"no-store"});
    if(!res.ok)return {sunny:null,cloudy:null}; return res.json();
  }catch{ return {sunny:null,cloudy:null}; }
}

/* ---- Today's Chatter comments (see api/comments.js) ---- */
async function fetchCommentCounts(ids){
  const list=(ids||[]).filter(Boolean); if(!list.length)return {};
  try{
    const res=await fetch(`/api/comments?ids=${encodeURIComponent(list.join(","))}`,{cache:"no-store"});
    if(!res.ok)return {}; const d=await res.json(); return d.counts||{};
  }catch{ return {}; }
}
async function fetchComments(id){
  try{
    const res=await fetch(`/api/comments?id=${encodeURIComponent(id)}&voter=${encodeURIComponent(voterId())}`,{cache:"no-store"});
    if(!res.ok)return []; const d=await res.json(); return d.comments||[];
  }catch{ return []; }
}
async function postComment(id,text,name){
  const res=await fetch("/api/comments",{
    method:"POST",
    headers:{ "Content-Type":"application/json", "x-moodcast-pass":PASSCODE },
    body:JSON.stringify({ id, text, name, voter:voterId() }),
  });
  const d=await res.json().catch(()=>({})); if(!res.ok)throw new Error(d.error||("HTTP "+res.status));
  return d.comment;
}
async function moderateComment(id,cid,action){
  const res=await fetch("/api/comments",{
    method:"POST",
    headers:{ "Content-Type":"application/json", "x-moodcast-pass":PASSCODE },
    body:JSON.stringify({ id, cid, action, voter:voterId() }),
  });
  if(!res.ok)throw new Error("HTTP "+res.status); return res.json();
}

/* ---- weather-emoji reactions (see api/react.js) ---- */
const REACTIONS=["☀️","🌤️","⛈️","🌈"];
// Stable id for an article so it can carry its own votes/comments/reactions.
// Hash the FULL url/title so long, near-identical URLs don't collide (a slug
// slice truncated past the unique suffix would map several articles to one id).
function artId(it){ const s=String(it?.url||it?.title||"x"); let h=0; for(let i=0;i<s.length;i++)h=(Math.imul(h,31)+s.charCodeAt(i))|0; return "art:"+Math.abs(h).toString(36); }
async function fetchReactions(ids){
  const list=(ids||[]).filter(Boolean); if(!list.length)return {reactions:{},mine:{}};
  try{ const res=await fetch(`/api/react?ids=${encodeURIComponent(list.join(","))}&voter=${encodeURIComponent(voterId())}`,{cache:"no-store"});
    if(!res.ok)return {reactions:{},mine:{}}; const d=await res.json(); return {reactions:d.reactions||{},mine:d.mine||{}};
  }catch{ return {reactions:{},mine:{}}; }
}
async function toggleReaction(id,emoji){
  const res=await fetch("/api/react",{ method:"POST",
    headers:{ "Content-Type":"application/json", "x-moodcast-pass":PASSCODE },
    body:JSON.stringify({ id, emoji, voter:voterId() }) });
  if(!res.ok)throw new Error("react failed "+res.status); return res.json(); // {id, reactions, mine}
}
// The crowd's read, 0-100, from the Yay/Boo split — directly comparable to the AI mood.
function crowdMood(v){ const y=v?.yay||0,b=v?.boo||0,t=y+b; return t?Math.round((y/t)*100):null; }

/* ----------------------- visuals ----------------------- */
function Glyph({ mood, size=56 }){
  const t = glyphType(mood); const sun = moodColor(mood); const cloud="#A6AEB9"; const cloudHi="#C3CAD3"; const rain="#6E8BB0"; const bolt="#E9B84A";
  if(t==="none") return <svg width={size} height={size} viewBox="0 0 64 64"><circle cx="32" cy="32" r="13" fill="none" stroke="#CDD3DB" strokeWidth="3" strokeDasharray="3 5"/></svg>;
  const Sun = ({cx=32,cy=28,r=12,rays=true})=>(<g>
    {rays && [...Array(8)].map((_,i)=>{const a=i*Math.PI/4;return <line key={i} x1={cx+Math.cos(a)*(r+4)} y1={cy+Math.sin(a)*(r+4)} x2={cx+Math.cos(a)*(r+9)} y2={cy+Math.sin(a)*(r+9)} stroke={sun} strokeWidth="2.4" strokeLinecap="round"/>;})}
    <circle cx={cx} cy={cy} r={r} fill={sun}/></g>);
  const Cloud = ({x=20,y=30,c=cloud})=>(<g fill={c}><ellipse cx={x+8} cy={y+10} rx="13" ry="10"/><circle cx={x+2} cy={y+8} r="8"/><circle cx={x+16} cy={y+4} r="10"/><rect x={x-6} y={y+9} width="34" height="11" rx="5.5"/></g>);
  return (
    <svg width={size} height={size} viewBox="0 0 64 64">
      {t==="radiant" && <><Sun cx={32} cy={30} r={14}/><circle cx="48" cy="16" r="2.4" fill={sun}/><circle cx="14" cy="20" r="1.8" fill={sun}/></>}
      {t==="sun" && <Sun cx={32} cy={32} r={13}/>}
      {t==="fair" && <><Sun cx={24} cy={24} r={10}/><Cloud x={26} y={30} c={cloudHi}/></>}
      {t==="partly" && <><Sun cx={22} cy={22} r={9} rays={false}/><Cloud x={20} y={28}/></>}
      {t==="cloud" && <><Cloud x={14} y={24} c={cloudHi}/><Cloud x={22} y={28}/></>}
      {t==="rain" && <><Cloud x={18} y={20}/>{[26,34,42].map((x,i)=><line key={i} x1={x} y1="44" x2={x-3} y2="54" stroke={rain} strokeWidth="2.6" strokeLinecap="round"/>)}</>}
      {t==="storm" && <><Cloud x={18} y={18} c="#8E97A3"/><polygon points="32,42 26,54 31,54 28,62 40,48 34,48 38,42" fill={bolt}/></>}
    </svg>
  );
}
function Spark({ series, color }){
  if(!series || series.length<2) return null;
  const w=64,h=20; const pts = series.map((v,i)=>{const x=(i/(series.length-1))*w;const y=h-(Math.max(0,Math.min(100,v))/100)*h;return `${x.toFixed(1)},${y.toFixed(1)}`;}).join(" ");
  return <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}><polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.85"/></svg>;
}
// Tooltip for the long-range public-mood chart: shows the mood, whether it's an
// estimate or a real reading, and any notable historical event for that point.
function MoodTip({ active, payload, labelFmt }){
  if(!active||!payload||!payload.length)return null; const p=payload[0].payload;
  return (
    <div style={{background:"#fff",border:`1px solid ${LINE}`,borderRadius:10,padding:"8px 11px",fontFamily:F.ui,fontSize:12,boxShadow:"0 6px 18px rgba(27,35,48,.12)",maxWidth:220}}>
      <div style={{fontWeight:700,color:INK}}>{labelFmt(p.t)}</div>
      <div style={{marginTop:2}}><b style={{color:moodColor(p.overall),fontWeight:800}}>{p.overall}</b> <span style={{color:INK2}}>{moodWord(p.overall)}</span> <span style={{color:"#9AA3AE",fontSize:11}}>· {p.live?"reading":"estimate"}</span></div>
      {p.ev&&<div style={{marginTop:5,color:INK2,lineHeight:1.35,borderTop:`1px solid ${LINE}`,paddingTop:5}}>{p.ev}</div>}
    </div>
  );
}
function EntityGraph({ series }){
  if(!series || series.length<2)
    return <div style={{padding:"22px 12px",textAlign:"center",color:INK2,fontSize:12.5,background:CARD,border:`1px dashed ${LINE}`,borderRadius:12}}>Not enough history yet — each reading adds a point and the graph fills in here.</div>;
  const data=series.map(p=>({t:p.t,mood:p.mood}));
  return (
    <div style={{height:170,background:CARD,border:`1px solid ${LINE}`,borderRadius:12,padding:"10px 8px 4px"}}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{top:6,right:12,bottom:2,left:-22}}>
          <defs><linearGradient id="eg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#F4A93B"/><stop offset="100%" stopColor="#46577A"/></linearGradient></defs>
          <CartesianGrid stroke={LINE} vertical={false}/>
          <XAxis dataKey="t" tickFormatter={t=>new Date(t).toLocaleDateString([],{month:"short",day:"numeric"})} stroke={LINE} tickLine={false} minTickGap={40}/>
          <YAxis domain={[0,100]} ticks={[0,50,100]} stroke={LINE} tickLine={false}/>
          <ReferenceLine y={50} stroke={INK2} strokeDasharray="3 3"/>
          <Tooltip contentStyle={{borderRadius:10,border:`1px solid ${LINE}`,fontFamily:F.ui,fontSize:12}} labelFormatter={t=>new Date(t).toLocaleString()}/>
          <Line type="monotone" dataKey="mood" name="Mood" stroke="url(#eg)" strokeWidth={3} dot={{r:2.5}} isAnimationActive={false}/>
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
function Spinner({ size=16, color=INK2, stroke=2.4 }){
  return (<svg className="spin" width={size} height={size} viewBox="0 0 24 24" fill="none" style={{display:"block",flexShrink:0}} aria-label="loading" role="status">
    <circle cx="12" cy="12" r="9" stroke={color} strokeOpacity="0.22" strokeWidth={stroke}/>
    <path d="M21 12a9 9 0 0 0-9-9" stroke={color} strokeWidth={stroke} strokeLinecap="round"/></svg>);
}
// Animated "···" ellipsis to make in-progress work obvious.
function Dots({ color=INK2 }){ return <span className="dots" style={{color,letterSpacing:1}}><b>·</b><b>·</b><b>·</b></span>; }
function ConfirmButton({ label, onConfirm, style }){
  const [armed,setArmed]=useState(false);
  useEffect(()=>{ if(armed){const t=setTimeout(()=>setArmed(false),2600);return ()=>clearTimeout(t);} },[armed]);
  return <button style={style} onClick={()=>{ if(armed){setArmed(false);onConfirm();} else setArmed(true); }}>{armed?"Tap again to confirm":label}</button>;
}

const VOTE_SUN = "#E9A23B", VOTE_STORM = "#5E7EA8";
// Overall hero vote: "higher or lower than N?" with up/down arrows, styled for
// the dark hero. Reuses the same yay/boo storage (yay = higher, boo = lower).
function HeroVote({ overall, data, mine, onVote, count=0, onComment }){
  const yay=data?.yay||0, boo=data?.boo||0, total=yay+boo; const cm=crowdMood(data);
  const btn=(dir,arrow,label,color)=>{ const on=mine===dir; const n=dir==="yay"?yay:boo;
    return <button onClick={()=>onVote(dir)} style={{display:"inline-flex",alignItems:"center",gap:7,padding:"8px 16px",borderRadius:999,fontSize:14,fontWeight:800,cursor:"pointer",
      background:on?color:"rgba(255,255,255,.16)",color:"#fff",border:`1px solid ${on?color:"rgba(255,255,255,.32)"}`,backdropFilter:"blur(3px)",transition:"all .12s"}}>
      <span style={{color:on?"#fff":color,fontSize:16,lineHeight:1}}>{arrow}</span>{label}{n>0&&<b style={{opacity:.9}}>{n}</b>}</button>; };
  return (
    <div style={{marginTop:16}}>
      <div style={{fontSize:14,fontWeight:600,opacity:.95,marginBottom:9}}>Does today feel <span style={{color:VOTE_SUN,fontWeight:800}}>higher</span> or <span style={{color:"#9FB6D6",fontWeight:800}}>lower</span> than {overall}? <span style={{opacity:.7,fontWeight:500}}>The forecast is the AI’s — this is the crowd’s.</span></div>
      <div style={{display:"flex",alignItems:"center",gap:9,flexWrap:"wrap"}}>
        {btn("yay","▲","Higher",VOTE_SUN)}
        {btn("boo","▼","Lower","#7E9AC0")}
        {total>0 && <span style={{fontSize:12.5,opacity:.9,fontWeight:700}}>crowd says {cm} · {total} vote{total>1?"s":""}</span>}
        <button onClick={onComment} style={{display:"inline-flex",alignItems:"center",gap:6,marginLeft:"auto",background:"transparent",border:"none",cursor:"pointer",color:"#fff",opacity:.9,fontSize:13,fontWeight:700}}>💬 {count||"Comment"}</button>
      </div>
    </div>
  );
}
// Article reactions: tap ☀️ (sunshine) or ⛈️ (storm) on a specific story.
// Reuses the yay/boo vote storage (yay = sunshine, boo = storm). `mine` is
// "yay"|"boo"|null; tapping again toggles off.
function ArticleReact({ data, mine, onVote }){
  const yay=Math.max(0,data?.yay||0), boo=Math.max(0,data?.boo||0);
  const pill=(dir,emoji,n,color)=>{ const on=mine===dir;
    return <button onClick={(e)=>{e.stopPropagation();onVote(dir);}} title={dir==="yay"?"Sunshine — I like this":"Storm cloud — I don't"}
      style={{display:"inline-flex",alignItems:"center",gap:4,padding:"3px 9px",borderRadius:999,fontSize:13,fontWeight:800,cursor:"pointer",lineHeight:1,
        background:on?color:CARD,border:`1px solid ${on?color:LINE}`,color:on?"#fff":INK}}>
      <span style={{fontSize:13.5}}>{emoji}</span>{n>0&&n}</button>; };
  return <div style={{display:"inline-flex",gap:7,flexShrink:0}}>{pill("yay","☀️",yay,"#E9A23B")}{pill("boo","⛈️",boo,"#7E9AC0")}</div>;
}
// The crowd's most-loved / most-disliked article of the day, for the home card.
function CrowdPick({ pick, kind }){
  if(!pick||!pick.title)return null; const sunny=kind==="sunny";
  const grad=sunny?"linear-gradient(135deg,#FFF6E0,#FFFDF7)":"linear-gradient(135deg,#EEF2F8,#FAFBFD)";
  const edge=sunny?"#F0E2BE":"#D7E0EC";
  return (
    <a href={pick.url||undefined} target={pick.url?"_blank":undefined} rel="noreferrer" style={{display:"block",textDecoration:"none",color:INK,background:grad,border:`1px solid ${edge}`,borderRadius:14,padding:"12px 14px"}}>
      <div style={{fontSize:11,fontWeight:800,letterSpacing:".08em",textTransform:"uppercase",color:sunny?"#B5860B":"#5E7196"}}>{sunny?"☀️ Crowd’s sunniest":"⛈️ Crowd’s cloudiest"}</div>
      <div style={{fontFamily:F.display,fontWeight:700,fontSize:14.5,lineHeight:1.3,marginTop:5}}>{pick.title}</div>
      <div style={{fontSize:11.5,color:INK2,marginTop:6,fontWeight:600}}>{pick.source||""}{pick.source?" · ":""}☀️ {pick.yay||0} · ⛈️ {pick.boo||0}</div>
    </a>
  );
}

// Small "💬 N" entry point that opens a card's Today's Chatter thread.
function CommentButton({ count=0, onClick, compact=false }){
  return (
    <button onClick={(e)=>{e.stopPropagation();onClick();}} style={{display:"inline-flex",alignItems:"center",gap:6,marginTop:compact?8:10,
      background:"transparent",border:"none",padding:0,cursor:"pointer",color:count?INK:INK2,fontSize:compact?12:12.5,fontWeight:700}}>
      <span style={{fontSize:compact?13:14}}>💬</span>{count?`${count} comment${count>1?"s":""}`:"Comment"}
    </button>
  );
}
// Quick weather-emoji reactions — a no-typing way to react. Self-loads for `id`.
function ReactionBar({ id }){
  const [counts,setCounts]=useState({});
  const [mine,setMine]=useState([]);
  useEffect(()=>{ let live=true; fetchReactions([id]).then(r=>{ if(!live)return; setCounts(r.reactions[id]||{}); setMine(r.mine[id]||[]); }); return ()=>{live=false;}; },[id]);
  const tap=async(e)=>{ const has=mine.includes(e);
    setCounts(c=>({...c,[e]:Math.max(0,(c?.[e]||0)+(has?-1:1))})); // optimistic
    setMine(m=>has?m.filter(x=>x!==e):[...m,e]);
    try{ const r=await toggleReaction(id,e); setCounts(r.reactions); setMine(r.mine); }catch{}
  };
  return (
    <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
      {REACTIONS.map(e=>{ const on=mine.includes(e); const n=counts[e]||0; return (
        <button key={e} onClick={()=>tap(e)} style={{display:"inline-flex",alignItems:"center",gap:5,padding:"6px 12px",borderRadius:999,
          fontSize:15,fontWeight:800,cursor:"pointer",lineHeight:1,transition:"transform .1s",
          background:on?"#FFF4DC":CARD,border:`1px solid ${on?VOTE_SUN:LINE}`,color:INK}}>
          {e}{n>0&&<span style={{fontSize:12.5,fontWeight:800,color:INK2}}>{n}</span>}
        </button>);})}
    </div>
  );
}
const cAgo=(t)=>{ if(!t)return""; const s=Math.floor((Date.now()-t)/1000); return s<60?"now":s<3600?`${Math.floor(s/60)}m`:s<86400?`${Math.floor(s/3600)}h`:`${Math.floor(s/86400)}d`; };
// "Today's Chatter" — a daily comment thread for one card. Centered modal.
function CommentsModal({ id, label, onClose, onCount }){
  const [list,setList]=useState(null); // null = loading
  const [text,setText]=useState("");
  const [name,setName]=useState(()=>{ try{ return localStorage.getItem("ms:cname")||""; }catch{ return ""; } });
  const [busy,setBusy]=useState(false);
  const [err,setErr]=useState("");
  const load=useCallback(async()=>{ const c=await fetchComments(id); setList(c); onCount&&onCount(id,c.length); },[id,onCount]);
  useEffect(()=>{ load(); },[load]);
  const submit=async()=>{
    const t=text.trim(); if(!t||busy)return; setBusy(true); setErr("");
    try{ const nm=name.trim(); if(nm){ try{ localStorage.setItem("ms:cname",nm); }catch{} }
      const c=await postComment(id,t,nm); setText("");
      setList(prev=>{ const next=[c,...(prev||[])]; onCount&&onCount(id,next.length); return next; });
    }catch(e){ setErr(String(e.message||"Couldn't post").slice(0,80)); }
    setBusy(false);
  };
  const remove=async(cid)=>{ setList(prev=>{ const next=(prev||[]).filter(c=>c.cid!==cid); onCount&&onCount(id,next.length); return next; });
    try{ await moderateComment(id,cid,"delete"); }catch{} };
  const report=async(cid)=>{ try{ await moderateComment(id,cid,"report"); }catch{}
    setList(prev=>(prev||[]).map(c=>c.cid===cid?{...c,reported:true}:c)); };
  return (
    <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(20,26,36,.5)",backdropFilter:"blur(3px)",display:"flex",alignItems:"flex-end",justifyContent:"center",padding:"0 0",zIndex:75}}>
      <div onClick={e=>e.stopPropagation()} style={{width:"min(520px,100%)",maxHeight:"82vh",display:"flex",flexDirection:"column",background:PAPER,borderRadius:"20px 20px 0 0",boxShadow:"0 -16px 50px rgba(0,0,0,.3)"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"16px 18px",borderBottom:`1px solid ${LINE}`}}>
          <div><div style={{fontFamily:F.display,fontWeight:800,fontSize:17}}>Today’s chatter</div>
            <div style={{fontSize:12.5,color:INK2,fontWeight:600,textTransform:"capitalize"}}>{label} · resets daily</div></div>
          <button onClick={onClose} style={{background:"transparent",fontSize:20,color:INK2,lineHeight:1}}>×</button>
        </div>
        <div style={{flex:1,overflowY:"auto",padding:"12px 18px",display:"flex",flexDirection:"column",gap:10}}>
          <div style={{display:"flex",flexDirection:"column",gap:8,paddingBottom:6,borderBottom:`1px solid ${LINE}`}}>
            <div style={{fontSize:11.5,fontWeight:800,letterSpacing:".08em",color:INK2,textTransform:"uppercase"}}>Quick react</div>
            <ReactionBar id={id}/>
          </div>
          {list===null && <div style={{color:INK2,fontSize:13,display:"flex",alignItems:"center",gap:8,padding:"10px 0"}}><Spinner size={16}/>Loading…</div>}
          {list&&list.length===0 && <div style={{color:INK2,fontSize:13.5,padding:"14px 0",textAlign:"center"}}>No chatter yet today. Start it 👇</div>}
          {list&&list.map(c=>(
            <div key={c.cid} style={{background:CARD,border:`1px solid ${LINE}`,borderRadius:12,padding:"10px 12px"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",gap:8}}>
                <span style={{fontWeight:700,fontSize:13,color:INK}}>{c.name}{c.mine&&<span style={{color:INK2,fontWeight:600}}> · you</span>}</span>
                <span style={{fontSize:11,color:"#9AA3AE",fontWeight:600,whiteSpace:"nowrap"}}>{cAgo(c.ts)}</span>
              </div>
              <div style={{fontSize:14,color:INK,marginTop:3,lineHeight:1.4,wordBreak:"break-word"}}>{c.text}</div>
              <div style={{marginTop:6}}>{c.mine
                ? <button onClick={()=>remove(c.cid)} style={{background:"transparent",color:"#B4453A",fontSize:11.5,fontWeight:700,padding:0}}>Delete</button>
                : <button onClick={()=>report(c.cid)} disabled={c.reported} style={{background:"transparent",color:c.reported?"#9AA3AE":INK2,fontSize:11.5,fontWeight:700,padding:0}}>{c.reported?"Reported":"Report"}</button>}</div>
            </div>
          ))}
        </div>
        <div style={{borderTop:`1px solid ${LINE}`,padding:"12px 18px",display:"flex",flexDirection:"column",gap:8,background:PAPER}}>
          {err&&<div style={{fontSize:12,color:"#9A3B26"}}>{err}</div>}
          <input value={name} onChange={e=>setName(e.target.value)} placeholder="Name (optional)" maxLength={24}
            style={{border:`1px solid ${LINE}`,borderRadius:10,padding:"8px 11px",fontSize:13,background:CARD,fontFamily:"inherit"}}/>
          <div style={{display:"flex",gap:8}}>
            <input value={text} onChange={e=>setText(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")submit();}} placeholder="Add to today’s chatter…" maxLength={280}
              style={{flex:1,border:`1px solid ${LINE}`,borderRadius:10,padding:"10px 12px",fontSize:14,background:CARD,fontFamily:"inherit"}}/>
            <button onClick={submit} disabled={busy||!text.trim()} style={{background:ACCENT,color:"#fff",borderRadius:10,padding:"0 18px",fontSize:14,fontWeight:700,display:"flex",alignItems:"center",opacity:(busy||!text.trim())?.5:1,cursor:(busy||!text.trim())?"not-allowed":"pointer"}}>{busy?<Spinner size={15} color="#fff"/>:"Post"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---- Mood Map geometry (computed once) ---- */
// Natural Earth keeps continents shaped naturally (no Mercator polar bloat).
// Fit to the INHABITED world (excluding Antarctica) so the map fills the frame
// and is centered, rather than reserving empty space for the south pole.
const MAP_W=980;
const WORLD_FC = topoFeature(world110m, world110m.objects.countries);
const FIT_FC = { type:"FeatureCollection", features: WORLD_FC.features.filter(f=>(f.properties&&f.properties.name)!=="Antarctica") };
const MAP_PROJ = geoNaturalEarth1().fitWidth(MAP_W, FIT_FC);
const MAP_PATH = geoPath(MAP_PROJ);
const MAP_H = Math.ceil(MAP_PATH.bounds(FIT_FC)[1][1]); // tight height from the fitted bounds
const COUNTRY_PATHS = FIT_FC.features
  .map(f=>({ id:String(f.id), name:(f.properties&&f.properties.name)||"", d:MAP_PATH(f) }))
  .filter(c=>c.d && c.name);
// Major countries seeded by the "Read major countries" button (matched by name).
const BIG_COUNTRIES = ["United States of America","China","India","Russia","Brazil","United Kingdom","France","Germany","Japan","Ukraine","Israel","Mexico"];

// Flat interactive world choropleth. Countries fill with their mood color;
// hover for a tooltip, click to read that country's news.
function MoodMap({ moods, busy, onPick }){
  const ref=useRef(null);
  const [hover,setHover]=useState(null); // { id, name, mood, x, y }
  const move=(c,e)=>{ const r=ref.current?.getBoundingClientRect(); if(!r)return;
    const ent=moods[c.id]; setHover({ id:c.id, name:c.name, mood:ent?ent.mood:null, x:e.clientX-r.left, y:e.clientY-r.top, w:r.width }); };
  return (
    <div ref={ref} onMouseLeave={()=>setHover(null)} style={{position:"relative",background:"linear-gradient(180deg,#EAF2FB,#F4F8FC)",border:`1px solid ${LINE}`,borderRadius:16,overflow:"hidden"}}>
      <svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} width="100%" style={{display:"block"}}>
        {COUNTRY_PATHS.map(c=>{ const ent=moods[c.id]; const isBusy=busy&&busy.includes(c.id); const hot=hover&&hover.id===c.id;
          return <path key={c.id} d={c.d}
            fill={ent?moodColor(ent.mood):"#D7DFEA"} fillOpacity={isBusy?0.45:(ent?0.95:0.8)}
            stroke={hot?INK:"#FBFCFE"} strokeWidth={hot?1.1:0.5}
            onMouseMove={(e)=>move(c,e)} onClick={()=>onPick(c.id,c.name)}
            style={{cursor:"pointer",transition:"fill .5s ease, fill-opacity .3s"}}/>; })}
      </svg>
      {hover && <div style={{position:"absolute",left:Math.max(6,Math.min(hover.x+12,(hover.w||MAP_W)-150)),top:hover.y+12,pointerEvents:"none",background:"#fff",border:`1px solid ${LINE}`,borderRadius:9,padding:"6px 10px",fontSize:12,fontWeight:700,boxShadow:"0 6px 16px rgba(27,35,48,.16)",whiteSpace:"nowrap"}}>
        {hover.name}{hover.mood!=null?<> · <span style={{color:moodColor(hover.mood),fontWeight:800}}>{hover.mood}</span> <span style={{color:INK2,fontWeight:600}}>{moodWord(hover.mood)}</span></>:<span style={{color:INK2,fontWeight:600}}> · tap to read</span>}
      </div>}
    </div>
  );
}

/* --------------------------------- APP --------------------------------- */
export default function MoodCast(){
  const [results,setResults]=useState({});
  const [saved,setSaved]=useState([]);
  const [loadingIds,setLoadingIds]=useState([]);
  const [busy,setBusy]=useState(false);
  const [history,setHistory]=useState([]);
  const [lastRun,setLastRun]=useState(null);
  const [fromCrowd,setFromCrowd]=useState(false);
  const [votes,setVotes]=useState({});      // { id: {yay,boo} }
  const [myVotes,setMyVotes]=useState({});  // { id: "yay"|"boo"|null }
  const [commentCounts,setCommentCounts]=useState({}); // { id: n }
  const [commentsFor,setCommentsFor]=useState(null);   // { id, label } | null
  const [articlesModal,setArticlesModal]=useState(null); // { label, mood, items } | null
  const [topArts,setTopArts]=useState({sunny:null,cloudy:null}); // crowd's picks
  const [worldMoods,setWorldMoods]=useState({}); // { code: {mood,items,t,label} }
  const [worldSel,setWorldSel]=useState(null);   // selected country panel
  const [worldBusy,setWorldBusy]=useState([]);   // codes currently reading
  const [worldAllBusy,setWorldAllBusy]=useState(false);
  const [worldProgress,setWorldProgress]=useState(null); // { done, total } during "read all"
  const stopWorldRef=useRef(false);
  const [error,setError]=useState(null);
  const [detail,setDetail]=useState(null);
  const [detailLoading,setDetailLoading]=useState(false);
  const [q,setQ]=useState("");
  const [searchResult,setSearchResult]=useState(null);
  const [answer,setAnswer]=useState(null);
  const [searchBusy,setSearchBusy]=useState(false);
  const [questionBusy,setQuestionBusy]=useState(false);
  const [sunny,setSunny]=useState(null);
  const [sunnyBusy,setSunnyBusy]=useState(false);
  const [dark,setDark]=useState(null);
  const [darkBusy,setDarkBusy]=useState(false);
  const [recent,setRecent]=useState([]);
  const [share,setShare]=useState(false);
  const [copied,setCopied]=useState(false);
  const [reduced,setReduced]=useState(false);
  const [range,setRange]=useState("5Y");
  const [yearNote,setYearNote]=useState(null); // { t, label, mood, ev, live, text, loading }
  // settings + view prefs
  const [perCat,setPerCat]=useState(3);
  const [includeFollows,setIncludeFollows]=useState(true);
  const [auto,setAuto]=useState(false);
  const [interval,setIntervalMin]=useState(60);
  const [hiddenCats,setHiddenCats]=useState([]);
  const [catOrder,setCatOrder]=useState([]);
  const [editMode,setEditMode]=useState(false);
  const [showSettings,setShowSettings]=useState(false);
  const [loadedPrefs,setLoadedPrefs]=useState(false);
  const [gate,setGate]=useState(false);
  const [passInput,setPassInput]=useState("");
  const resultsRef=useRef(results); const timer=useRef(null);
  useEffect(()=>{resultsRef.current=results;},[results]);

  useEffect(()=>{(async()=>{
    const h=await store.get("ms:history"); if(h)setHistory(h);
    const last=await store.get("ms:last"); if(last){setResults(last.results||{});setLastRun(last.t||null);}
    const localT=last&&last.t?last.t:0;
    const r=await store.get("ms:recent"); if(r)setRecent(r);
    const sv=await store.get("ms:saved"); if(sv)setSaved(sv);
    const sn=await store.get("ms:sunny"); if(sn)setSunny(sn);
    const localSunnyT=sn&&sn.t?sn.t:0;
    const dk=await store.get("ms:dark"); if(dk)setDark(dk);
    const localDarkT=dk&&dk.t?dk.t:0;
    const pw=await store.get("ms:pass"); if(pw)PASSCODE=pw;
    const st=await store.get("ms:settings"); if(st){ if(st.perCat)setPerCat(st.perCat); if(typeof st.includeFollows==="boolean")setIncludeFollows(st.includeFollows);
      if(typeof st.interval==="number")setIntervalMin(st.interval); if(Array.isArray(st.hiddenCats))setHiddenCats(st.hiddenCats); if(Array.isArray(st.catOrder))setCatOrder(st.catOrder); }
    setLoadedPrefs(true);
    // Shared board: if the crowd's latest reading is newer than this device's,
    // show it. Merge over local entries so personal trend sparklines survive.
    const { latest, sunny, dark }=await loadBoard();
    if(latest&&latest.t&&latest.t>localT){
      setResults(prev=>{ const next={...prev};
        for(const id in (latest.results||{})){ const b=latest.results[id]; next[id]={...next[id],mood:b.mood,items:b.items||[],t:latest.t}; }
        return next; });
      setLastRun(latest.t); setFromCrowd(true);
    }
    // The featured cards are shared too — take the crowd's if newer than local.
    if(sunny&&sunny.t&&sunny.t>localSunnyT){ setSunny(sunny); store.set("ms:sunny",sunny); }
    if(dark&&dark.t&&dark.t>localDarkT){ setDark(dark); store.set("ms:dark",dark); }
  })();
    onAuthFail=()=>setGate(true);
    setReduced(window.matchMedia&&window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    return ()=>{ onAuthFail=null; };
  },[]);
  const submitPass=()=>{ const v=passInput.trim(); if(!v)return; PASSCODE=v; store.set("ms:pass",v); setGate(false); setPassInput(""); setError(null); };
  useEffect(()=>{ if(loadedPrefs)store.set("ms:settings",{perCat,includeFollows,interval,hiddenCats,catOrder}); },[perCat,includeFollows,interval,hiddenCats,catOrder,loadedPrefs]);
  useEffect(()=>{ if(loadedPrefs)store.set("ms:saved",saved); },[saved,loadedPrefs]);

  const visibleCats=(()=>{ const byId=Object.fromEntries(CATEGORIES.map(c=>[c.id,c])); const seen=new Set(); const out=[];
    (catOrder||[]).forEach(id=>{if(byId[id]&&!seen.has(id)){seen.add(id);out.push(byId[id]);}});
    CATEGORIES.forEach(c=>{if(!seen.has(c.id))out.push(c);});
    return out.filter(c=>!hiddenCats.includes(c.id)); })();

  const overall=(()=>{const v=CATEGORIES.map(c=>results[c.id]?.mood).filter(x=>x!=null);return v.length?Math.round(v.reduce((a,b)=>a+b,0)/v.length):null;})();
  const prevOverall=history.length?history[history.length-1].overall:null;
  const delta=overall!=null&&prevOverall!=null?overall-prevOverall:null;
  const brightest=(()=>{let best=null;CATEGORIES.forEach(c=>{const m=results[c.id]?.mood;if(m!=null&&(!best||m>best.m))best={c,m};});return best;})();
  const heaviest=(()=>{let w=null;CATEGORIES.forEach(c=>{const m=results[c.id]?.mood;if(m!=null&&(!w||m<w.m))w={c,m};});return w;})();
  const mover=(()=>{ let best=null; const ents=[...CATEGORIES.map(c=>({label:c.label,id:c.id})),...saved.map(s=>({label:s.subject,id:s.id}))];
    ents.forEach(e=>{const sx=results[e.id]?.series;if(sx&&sx.length>=2){const d=sx[sx.length-1].mood-sx[sx.length-2].mood;if(!best||Math.abs(d)>Math.abs(best.d))best={label:e.label,d};}});
    return best&&best.d!==0?best:null; })();
  const entitiesWithMood=()=>{ const out=[]; CATEGORIES.forEach(c=>{const m=results[c.id]?.mood;if(m!=null)out.push({id:c.id,label:c.label,mood:m});}); saved.forEach(s=>{const m=results[s.id]?.mood;if(m!=null)out.push({id:s.id,label:s.subject,mood:m});}); return out; };

  // Yay/Boo crowd votes for every votable card on the home screen.
  const votableIds=["overall",...CATEGORIES.map(c=>c.id),...saved.map(s=>s.id)];
  const voteIdsKey=votableIds.join(",");
  const votesRef=useRef(voteIdsKey); votesRef.current=voteIdsKey;
  const refreshVotes=useCallback(async()=>{ const ids=votesRef.current.split(",").filter(Boolean);
    const [v,counts,top]=await Promise.all([fetchVotes(ids),fetchCommentCounts(ids),fetchTopArticles()]);
    setVotes(prev=>({...prev,...v.votes})); setMyVotes(prev=>({...prev,...v.mine}));
    setCommentCounts(prev=>({...prev,...counts})); setTopArts(top); },[]);
  useEffect(()=>{ refreshVotes();
    const tick=()=>{ if(typeof document==="undefined"||!document.hidden)refreshVotes(); };
    const iv=setInterval(tick,20000); // light poll so votes & chatter counts feel live
    return ()=>clearInterval(iv);
  },[voteIdsKey,refreshVotes]);
  const bumpCount=useCallback((id,n)=>setCommentCounts(c=>({...c,[id]:n})),[]);
  // Pull comment counts for article-level threads (drill-down headlines + Sunny Side).
  useEffect(()=>{ const arts=new Set();
    if(sunny?.item)arts.add(artId(sunny.item));
    if(dark?.item)arts.add(artId(dark.item));
    if(detail){ const d=resultsRef.current[detail.id];
      (d?.items||[]).forEach(it=>arts.add(artId(it)));
      if(d?.subs)Object.values(d.subs).forEach(sd=>(sd?.items||[]).forEach(it=>arts.add(artId(it)))); }
    const ids=[...arts]; if(!ids.length)return;
    fetchCommentCounts(ids).then(counts=>setCommentCounts(c=>({...c,...counts})));
    fetchVotes(ids).then(v=>{ setVotes(p=>({...p,...v.votes})); setMyVotes(p=>({...p,...v.mine})); });
  },[detail,results,sunny,dark]);
  const handleVote=useCallback(async(id,dir,meta)=>{
    const cur=votes[id]||{yay:0,boo:0}; const prevMine=myVotes[id]||null;
    const opt={...cur}; let mine;
    if(prevMine===dir){ opt[dir]=Math.max(0,(opt[dir]||0)-1); mine=null; }
    else{ opt[dir]=(opt[dir]||0)+1; if(prevMine)opt[prevMine]=Math.max(0,(opt[prevMine]||0)-1); mine=dir; }
    setVotes(v=>({...v,[id]:opt})); setMyVotes(m=>({...m,[id]:mine})); // optimistic
    try{ const res=await castVote(id,dir,meta); setVotes(v=>({...v,[id]:res.votes})); setMyVotes(m=>({...m,[id]:res.mine})); }
    catch{ setVotes(v=>({...v,[id]:cur})); setMyVotes(m=>({...m,[id]:prevMine})); } // revert
  },[votes,myVotes]);

  const read=useCallback(async(entities,recordOverall=true)=>{
    if(busy||!entities.length)return; setBusy(true); setError(null); setLoadingIds(entities.map(e=>e.id));
    const merged={...resultsRef.current}; let fail=0; const t=Date.now(); if(recordOverall)setFromCrowd(false);
    for(let i=0;i<entities.length;i+=5){const batch=entities.slice(i,i+5);
      const res=await Promise.allSettled(batch.map(e=>gradeQuery(e.query,perCat)));
      res.forEach((r,j)=>{const id=batch[j].id;
        if(r.status==="fulfilled"){const prev=merged[id]||{};const series=appendSeries(prev.series,r.value.mood,t);
          merged[id]={...prev,mood:r.value.mood,items:r.value.items,series,t};
          setResults(s=>({...s,[id]:{...s[id],mood:r.value.mood,items:r.value.items,series,t}}));}
        else fail++; setLoadingIds(l=>l.filter(x=>x!==id));});}
    if(recordOverall){const all=CATEGORIES.map(c=>merged[c.id]?.mood).filter(x=>x!=null);
      if(all.length){const ov=Math.round(all.reduce((a,b)=>a+b,0)/all.length);const byCat={};CATEGORIES.forEach(c=>{if(merged[c.id]?.mood!=null)byCat[c.id]=merged[c.id].mood;});
        setHistory(h=>{const nh=[...h,{t,overall:ov,byCat}].slice(-240);store.set("ms:history",nh);return nh;});}}
    setLastRun(t); store.set("ms:last",{results:merged,t});
    // Publish a full "Read today's sky" to the shared board so every visitor sees it.
    if(recordOverall&&fail<entities.length){
      const ovAll=CATEGORIES.map(c=>merged[c.id]?.mood).filter(x=>x!=null);
      const ov=ovAll.length?Math.round(ovAll.reduce((a,b)=>a+b,0)/ovAll.length):null;
      saveBoardLatest(merged,ov);
    }
    if(fail===entities.length)setError("Couldn't reach the sky right now. Check your connection and try again.");
    setBusy(false);
  },[busy,perCat]);

  const readSunny=async()=>{
    if(sunnyBusy)return; setSunnyBusy(true);
    try{
      const r=await gradeQuery("the single most uplifting, genuinely positive good-news story in the world today",5);
      const items=(r.items||[]).filter(it=>Number.isFinite(it.score));
      const best=items.length?items.reduce((a,b)=>b.score>a.score?b:a):null;
      if(best){ const card={item:best,mood:toMood(best.score),t:Date.now()}; setSunny(card); store.set("ms:sunny",card); saveBoardSunny(card); }
    }catch{}
    setSunnyBusy(false);
  };
  const readDark=async()=>{
    if(darkBusy)return; setDarkBusy(true);
    try{
      const r=await gradeQuery("the single heaviest, most distressing or saddest serious news story in the world today",5);
      const items=(r.items||[]).filter(it=>Number.isFinite(it.score));
      const worst=items.length?items.reduce((a,b)=>b.score<a.score?b:a):null;
      if(worst){ const card={item:worst,mood:toMood(worst.score),t:Date.now()}; setDark(card); store.set("ms:dark",card); saveBoardDark(card); }
    }catch{}
    setDarkBusy(false);
  };
  const readAll=()=>{ readSunny(); readDark(); return read(includeFollows?[...CATEGORIES,...saved]:[...CATEGORIES],true); };

  // ---- Mood Map ----
  useEffect(()=>{ fetchWorld().then(setWorldMoods); },[]);
  const gradeCountry=useCallback(async(code,label)=>{
    setWorldBusy(b=>b.includes(code)?b:[...b,code]);
    try{ const r=await gradeQuery(`current public mood and the most significant recent news in ${label}`, Math.min(4,perCat));
      if(r.mood!=null){ const entry={mood:r.mood,items:r.items,t:Date.now(),label};
        setWorldMoods(m=>({...m,[code]:entry})); saveWorldCountry(code,r.mood,r.items,label); return entry; }
    }catch{} finally{ setWorldBusy(b=>b.filter(x=>x!==code)); }
    return null;
  },[perCat]);
  const onPickCountry=useCallback(async(code,label)=>{
    const ex=worldMoods[code];
    if(ex){ setWorldSel({code,label,mood:ex.mood,items:ex.items,loading:false}); return; }
    if(worldBusy.includes(code))return;
    setWorldSel({code,label,loading:true});
    const entry=await gradeCountry(code,label);
    setWorldSel(s=>s&&s.code===code?(entry?{code,label,mood:entry.mood,items:entry.items,loading:false}:{code,label,error:true,loading:false}):s);
  },[worldMoods,worldBusy,gradeCountry]);
  const readBigCountries=async()=>{
    if(worldAllBusy)return; setWorldAllBusy(true);
    for(const c of COUNTRY_PATHS.filter(c=>BIG_COUNTRIES.includes(c.name))){ if(!worldMoods[c.id]) await gradeCountry(c.id,c.name); }
    setWorldAllBusy(false);
  };
  const readAllCountries=async()=>{
    if(worldAllBusy)return;
    const targets=COUNTRY_PATHS.filter(c=>!worldMoods[c.id]);
    if(!targets.length)return;
    setWorldAllBusy(true); stopWorldRef.current=false; setWorldProgress({done:0,total:targets.length});
    for(let i=0;i<targets.length;i+=4){ // small concurrent batches to bound load
      if(stopWorldRef.current)break;
      await Promise.all(targets.slice(i,i+4).map(c=>gradeCountry(c.id,c.name)));
      setWorldProgress({done:Math.min(i+4,targets.length),total:targets.length});
    }
    setWorldAllBusy(false); setWorldProgress(null);
  };
  const worldCount=Object.keys(worldMoods).length;
  const refreshOne=(ent)=>read([ent],false);
  useEffect(()=>{ if(timer.current){clearInterval(timer.current);timer.current=null;}
    if(auto)timer.current=setInterval(()=>read(includeFollows?[...CATEGORIES,...saved]:[...CATEGORIES],true),Math.max(1,interval)*60000);
    return ()=>{if(timer.current)clearInterval(timer.current);}; },[auto,interval,includeFollows,saved,read]);

  const openById=(id)=>{ const c=CATEGORIES.find(x=>x.id===id); if(c)return openEntity("cat",c); const s=saved.find(x=>x.id===id); if(s)return openEntity("sub",s); };
  const openEntity=async(kind,ent)=>{
    setDetail({kind,id:ent.id});
    if(kind==="cat"){ if(resultsRef.current[ent.id]?.subs)return;
      setDetailLoading(true); const subs={};
      for(let i=0;i<ent.subs.length;i+=4){const batch=ent.subs.slice(i,i+4);
        const res=await Promise.allSettled(batch.map(s=>gradeQuery(s.query,Math.min(3,perCat))));
        res.forEach((r,j)=>{subs[batch[j].id]=r.status==="fulfilled"?r.value:{mood:null,items:[]};});}
      setResults(s=>({...s,[ent.id]:{...s[ent.id],subs}})); setDetailLoading(false);
    } else { if(resultsRef.current[ent.id]?.items?.length)return;
      setDetailLoading(true); try{const r=await gradeQuery(ent.query,perCat);const t=Date.now();
        setResults(s=>({...s,[ent.id]:{...s[ent.id],mood:r.mood,items:r.items,series:appendSeries(s[ent.id]?.series,r.mood,t),t}}));}catch{} setDetailLoading(false);
    }
  };

  const looksLikeQuestion=(s)=>{ const x=s.trim(); if(!x)return false; if(x.endsWith("?"))return true;
    if(/(worst|best|most|least|highest|lowest|gloom|brightest|happiest|saddest|darkest|heaviest)/i.test(x)&&/(mood|forecast|sentiment|feeling|positiv|negativ|topic|subject)/i.test(x))return true;
    const w=x.split(/\s+/); if(w.length>=4&&/^(what|which|who|where|when|why|how|is|are|does|do|should|can|will|rank|compare|name|tell|list)$/i.test(w[0]))return true; return false; };
  const strongQuestion=(s)=>/\?\s*$/.test(s.trim())||(/(worst|best|most|least|highest|lowest|gloom|brightest|happiest|saddest|darkest|heaviest)/i.test(s)&&/(mood|forecast|sentiment|feeling|positiv|negativ|topic|subject)/i.test(s));
  const removeRecent=(i)=>setRecent(prev=>{const nr=prev.filter((_,k)=>k!==i);store.set("ms:recent",nr);return nr;});

  const localSuperlative=(text)=>{ const t=text.toLowerCase();
    if(!/(worst|best|most|least|highest|lowest|gloom|brightest|happiest|saddest|darkest|heaviest|negative|positive)/.test(t))return null;
    if(!/(mood|forecast|sentiment|feeling|positiv|negativ|gloom|bright|topic|subject)/.test(t))return null;
    const ents=entitiesWithMood(); if(!ents.length)return null;
    const max=/(best|highest|brightest|happiest|most positive|positive|sunniest)/.test(t)&&!/(worst|lowest|heaviest|gloom|negative)/.test(t);
    const pick=max?ents.reduce((a,b)=>b.mood>a.mood?b:a):ents.reduce((a,b)=>b.mood<a.mood?b:a);
    const runners=[...ents].sort((a,b)=>max?b.mood-a.mood:a.mood-b.mood).slice(1,3);
    return { answer:`Right now, ${pick.label} has the ${max?"brightest":"heaviest"} forecast at ${pick.mood}/100 (${moodWord(pick.mood)}).${runners.length?` Next: ${runners.map(r=>`${r.label} ${r.mood}`).join(", ")}.`:""}`, openId:pick.id, mood:pick.mood, local:true }; };

  const askQuestion=async(text)=>{
    setSearchResult(null); setAnswer(null); setQuestionBusy(true);
    const loc=localSuperlative(text); if(loc){ setAnswer(loc); setQuestionBusy(false); return; }
    try{ const ctx=entitiesWithMood().map(e=>`${e.label} ${e.mood}`).join("; ");
      const system=`You answer questions for a consumer "public mood weather" app. Mood is 0-100 (0 stormy/negative, 50 neutral, 100 radiant/positive). `+
        `Current dashboard readings: ${ctx||"none yet"}. Use these to answer questions about them; you may use web search for broader questions. `+
        `Respond ONLY JSON: {"answer":"<conversational, specific, <=55 words>","subject":"<one subject if the question resolves to a specific thing, else empty>","score":<integer -100..100 or null>}.`;
      const txt=await callModel(system,text); const p=parseJson(txt)||{};
      setAnswer({ answer:String(p.answer||"I couldn't find a clear answer to that.").slice(0,400), subject:(p.subject||"").trim()||null, mood:typeof p.score==="number"?toMood(p.score):null, raw:text });
    }catch{ setAnswer({answer:"Couldn't reach the data right now — try again.",raw:text}); }
    setQuestionBusy(false);
  };

  const runSearch=async(subjectArg)=>{
    const subject=(subjectArg??q).trim(); if(!subject||searchBusy)return;
    setAnswer(null); setSearchBusy(true); setSearchResult(null);
    try{ const r=await gradeQuery(subject,perCat); const card={subject,mood:r.mood,items:r.items,t:Date.now()}; setSearchResult(card);
      setRecent(prev=>{const nr=[{subject,mood:r.mood,t:card.t},...prev.filter(x=>x.subject.toLowerCase()!==subject.toLowerCase())].slice(0,8);store.set("ms:recent",nr);return nr;});
      const id=slug(subject); if(saved.some(s=>s.id===id)){const t=card.t;setResults(s=>({...s,[id]:{...s[id],mood:r.mood,items:r.items,series:appendSeries(s[id]?.series,r.mood,t),t}}));}
    }catch{ setSearchResult({subject,mood:null,items:[],error:true}); }
    setSearchBusy(false);
  };
  const submitSearch=()=>{ const x=q.trim(); if(!x)return; looksLikeQuestion(x)?askQuestion(x):runSearch(); };

  const isSavedSubj=(subj)=>saved.some(s=>s.id===slug(subj));
  const saveSubject=(subj)=>{ const id=slug(subj); if(saved.some(s=>s.id===id))return; setSaved([...saved,{id,subject:subj,query:subj}]);
    if(searchResult&&slug(searchResult.subject)===id&&searchResult.mood!=null){const t=Date.now();setResults(s=>({...s,[id]:{mood:searchResult.mood,items:searchResult.items,series:appendSeries(s[id]?.series,searchResult.mood,t)}}));} };
  const unsave=(id)=>{ setSaved(saved.filter(s=>s.id!==id)); if(detail?.id===id)setDetail(null); };
  const moveSaved=(id,dir)=>{ const arr=[...saved]; const i=arr.findIndex(s=>s.id===id); const j=i+dir; if(j<0||j>=arr.length)return; [arr[i],arr[j]]=[arr[j],arr[i]]; setSaved(arr); };

  const moveCat=(id,dir)=>{ const vis=visibleCats.map(c=>c.id); const i=vis.indexOf(id); const j=i+dir; if(j<0||j>=vis.length)return; [vis[i],vis[j]]=[vis[j],vis[i]]; setCatOrder([...vis,...hiddenCats]); };
  const hideCat=(id)=>setHiddenCats([...hiddenCats,id]);
  const restoreCat=(id)=>setHiddenCats(hiddenCats.filter(x=>x!==id));
  const clearHistory=()=>{ setHistory([]); store.set("ms:history",[]); setResults(r=>{const n={};for(const k in r)n[k]={...r[k],series:[]};store.set("ms:last",{results:n,t:lastRun});return n;}); };

  const ago=(t)=>{if(!t)return"not yet";const s=Math.floor((Date.now()-t)/1000);return s<60?"just now":s<3600?`${Math.floor(s/60)}m ago`:s<86400?`${Math.floor(s/3600)}h ago`:`${Math.floor(s/86400)}d ago`;};
  const today=new Date().toLocaleDateString([], {weekday:"long", month:"long", day:"numeric"});
  const heroSentence = overall==null ? "Tap “Read today’s sky” to take the first reading."
    : `${moodWord(overall)} overall.${brightest&&heaviest&&brightest.c.id!==heaviest.c.id?` ${brightest.c.label} is the brightest spot; ${heaviest.c.label} is weighing things down.`:""}`;
  const summaryText = `MoodCast — ${today}\nPublic mood: ${overall??"—"}/100 (${moodWord(overall)})${delta!=null?` ${delta>0?"▲ up "+delta:delta<0?"▼ down "+Math.abs(delta):"steady"} since last`:""}\n${brightest?`Brightest: ${brightest.c.label} (${brightest.m})`:""} · ${heaviest?`Heaviest: ${heaviest.c.label} (${heaviest.m})`:""}`;
  const copy=async()=>{ try{await navigator.clipboard.writeText(summaryText);setCopied(true);setTimeout(()=>setCopied(false),1800);}catch{setCopied(false);} };
  const heroTop=rgb(scl(moodRGB(overall??50),0.5)), heroMid=moodColor(overall??50);
  // Full series: 250-year estimated backdrop + this device's real readings, filtered to the range.
  const fullHistory=[...LONG_HISTORY, ...history.map(h=>({t:h.t,overall:h.overall,live:true}))].sort((a,b)=>a.t-b.t);
  const firstLiveT=history.length?Math.min(...history.map(h=>h.t)):null;
  const rangeMs=RANGES.find(r=>r[0]===range)?.[1] ?? null;
  const cutoff=rangeMs?Date.now()-rangeMs:-Infinity;
  const chartData=fullHistory.filter(p=>p.t>=cutoff);
  // Shade the estimated stretch within view: from the first visible point up to where real data begins.
  const seedStart=chartData.length?chartData[0].t:0;
  const seedEnd=Math.min(firstLiveT??(chartData.length?chartData[chartData.length-1].t:0), chartData.length?chartData[chartData.length-1].t:0);
  // Axis/tooltip granularity scales with the selected range.
  const axisFmt=(t)=>{ const d=new Date(t);
    if(rangeMs!=null&&rangeMs<=182*24*3600*1000) return d.toLocaleDateString([],{month:"short",day:"numeric"});
    if(rangeMs!=null&&rangeMs<=5*YEAR_MS) return d.toLocaleDateString([],{year:"2-digit",month:"short"});
    return String(d.getUTCFullYear()); };
  const labelFmt=(t)=>{ const d=new Date(t);
    if(rangeMs!=null&&rangeMs<=YEAR_MS) return d.toLocaleDateString([],{year:"numeric",month:"long",day:"numeric"});
    if(rangeMs!=null&&rangeMs<=10*YEAR_MS) return d.toLocaleDateString([],{year:"numeric",month:"long"});
    return String(d.getUTCFullYear()); };
  const pointLabel=(p)=>{ const d=new Date(p.t); const y=d.getUTCFullYear();
    return p.live?d.toLocaleDateString([],{year:"numeric",month:"long",day:"numeric"}):(y<=2019?String(y):d.toLocaleDateString([],{year:"numeric",month:"long"})); };
  const onChartClick=async(e)=>{
    const p=e&&e.activePayload&&e.activePayload[0]&&e.activePayload[0].payload; if(!p)return;
    const label=pointLabel(p);
    setYearNote({ t:p.t, label, mood:p.overall, ev:p.ev, live:p.live, text:null, loading:!p.live });
    if(p.live){ setYearNote(n=>n&&n.t===p.t?{...n,text:`A real reading taken on ${label} — the news mood read ${p.overall}/100 (${moodWord(p.overall)}).`,loading:false}:n); return; }
    const key="ms:why:"+p.t;
    const cached=await store.get(key);
    if(cached){ setYearNote(n=>n&&n.t===p.t?{...n,text:cached,loading:false}:n); return; }
    try{
      const sys="You are a concise, accurate U.S. social historian writing for a 'public mood' app. In 3–5 sentences, explain the mood and national sentiment of the United States at the given time and WHY — the specific events, economy, wars, or cultural currents that shaped how optimistic or pessimistic people felt. Be factual and specific; name real events. No preamble, no caveats about data.";
      const user=`Time: ${label}. Estimated U.S. public mood: ${p.overall}/100 (0=stormy/bleak, 50=neutral, 100=radiant/hopeful)${p.ev?`. Key marker: ${p.ev}`:""}. Explain why the national mood was around this level then.`;
      const txt=await callModel(sys,user);
      if(txt){ store.set(key,txt); setYearNote(n=>n&&n.t===p.t?{...n,text:txt,loading:false}:n); }
      else setYearNote(n=>n&&n.t===p.t?{...n,text:"Couldn't load an explanation right now — try again.",loading:false}:n);
    }catch{ setYearNote(n=>n&&n.t===p.t?{...n,text:"Couldn't load an explanation right now — try again.",loading:false}:n); }
  };
  const outBusy=searchBusy||questionBusy;

  return (
    <div style={{fontFamily:F.ui,color:INK,background:PAPER,minHeight:"100%",padding:"clamp(12px,2.5vw,24px)"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700;12..96,800&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap');
        .ms *{box-sizing:border-box;}
        .ms button{font-family:${F.ui};cursor:pointer;border:none;}
        .ms button:focus-visible,.ms input:focus-visible{outline:2px solid ${INK};outline-offset:2px;}
        .ms .cat{transition:transform .15s ease, box-shadow .15s ease;}
        .ms .cat:hover{transform:translateY(-2px);box-shadow:0 10px 24px rgba(27,35,48,.10);}
        .ms a{color:${INK};text-decoration:underline;text-underline-offset:2px;}
        .ms input{font-family:${F.ui};font-size:15px;border:none;background:transparent;color:${INK};width:100%;}
        .ms input::placeholder{color:#9AA3AE;}
        .ms .num{width:58px;background:#fff;border:1px solid ${LINE};border-radius:8px;padding:6px 8px;font-size:14px;}
        .recharts-cartesian-axis-tick text{font-family:${F.ui};fill:${INK2};font-size:11px;}
        @keyframes ms-spin{to{transform:rotate(360deg);}}
        @keyframes ms-shimmer{0%{background-position:-180px 0;}100%{background-position:180px 0;}}
        .ms .spin{animation:ms-spin .8s linear infinite;transform-origin:center;}
        .ms .skel{background:linear-gradient(90deg,#EDF0F4 25%,#DFE4EA 37%,#EDF0F4 63%);background-size:360px 100%;animation:ms-shimmer 1.15s linear infinite;border-radius:6px;}
        .ms .busy-card{position:relative;}
        .ms .busy-card::after{content:"";position:absolute;inset:0;border-radius:18px;background:linear-gradient(90deg,transparent,rgba(255,255,255,.45),transparent);background-size:200% 100%;animation:ms-shimmer 1.3s linear infinite;pointer-events:none;}
        @keyframes ms-blink{0%,80%,100%{opacity:.18;}40%{opacity:1;}}
        .ms .dots b{animation:ms-blink 1.2s infinite;font-weight:900;}
        .ms .dots b:nth-child(2){animation-delay:.2s;} .ms .dots b:nth-child(3){animation-delay:.4s;}
        @media (prefers-reduced-motion: reduce){.ms *{transition:none !important;}.ms .spin{animation:none !important;}.ms .skel{animation:none !important;background:#E5EAEF !important;}.ms .busy-card::after{display:none;}.ms .dots b{animation:none !important;opacity:.7;}}
      `}</style>

      <div className="ms" style={{maxWidth:1080,margin:"0 auto"}}>
        <a href="https://ardiejohnson.com" style={{display:"inline-flex",alignItems:"center",gap:6,background:CARD,border:`1px solid ${LINE}`,borderRadius:999,padding:"5px 12px",fontSize:12.5,fontWeight:700,color:INK,textDecoration:"none",marginBottom:12}}>← ardiejohnson.com</a>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,gap:10}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <Glyph mood={overall} size={34}/>
            <div><div style={{fontFamily:F.display,fontWeight:800,fontSize:22,letterSpacing:"-0.02em",lineHeight:1}}>MoodCast</div>
              <div style={{fontSize:11,color:INK2,marginTop:2}}>{overall==null?"how the world feels today":`the world feels ${moodWord(overall).toLowerCase()} today`}</div></div>
          </div>
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            <button onClick={()=>setShowSettings(true)} title="Settings" style={{background:CARD,border:`1px solid ${LINE}`,borderRadius:12,padding:"9px 11px",display:"flex"}}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={INK} strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.2.62.79 1.05 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            </button>
            <button onClick={readAll} disabled={busy} style={primary(busy)}>{busy?<span style={{display:"inline-flex",alignItems:"center",gap:8}}><Spinner size={15} color="#fff"/>Reading the sky…</span>:overall==null?"Read today’s sky":"Refresh"}</button>
          </div>
        </div>

        {/* HERO */}
        <section style={{borderRadius:24,overflow:"hidden",position:"relative",background:`linear-gradient(160deg, ${heroTop} 0%, ${heroMid} 100%)`,color:"#fff",padding:"clamp(22px,4vw,36px)",minHeight:230,boxShadow:"0 18px 40px rgba(27,35,48,.18)"}}>
          <div style={{position:"absolute",top:"-30%",right:"-8%",width:280,height:280,borderRadius:"50%",background:`radial-gradient(circle, rgba(255,255,255,${overall!=null?Math.min(.55,overall/160):.2}) 0%, transparent 70%)`,pointerEvents:"none"}}/>
          <div style={{position:"relative",display:"flex",justifyContent:"space-between",alignItems:"center",gap:16,flexWrap:"wrap"}}>
            <div>
              <div style={{fontSize:13,opacity:.85,fontWeight:600}}>{today} · public mood</div>
              <div style={{display:"flex",alignItems:"baseline",gap:14,marginTop:4}}>
                <div style={{fontFamily:F.display,fontWeight:800,fontSize:"clamp(64px,13vw,104px)",lineHeight:.9,letterSpacing:"-0.04em",display:"flex",alignItems:"center",minHeight:"0.9em"}}>{overall!=null?overall:(busy?<Spinner size={52} color="#fff" stroke={3}/>:"——")}</div>
                <div><div style={{fontFamily:F.display,fontWeight:700,fontSize:"clamp(20px,3.4vw,30px)",lineHeight:1}}>{moodWord(overall)}</div>
                  {delta!=null&&<div style={{fontSize:14,fontWeight:600,opacity:.95,marginTop:4}}>{delta>0?`▲ up ${delta}`:delta<0?`▼ down ${Math.abs(delta)}`:"— steady"} since last</div>}</div>
              </div>
              <div style={{fontSize:15,opacity:.92,marginTop:10,maxWidth:440,lineHeight:1.45,fontWeight:500}}>{heroSentence}</div>
              {(brightest||heaviest) && <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:12}}>
                {brightest && <button onClick={()=>setArticlesModal({label:brightest.c.label,mood:brightest.m,items:results[brightest.c.id]?.items||[]})} style={{display:"inline-flex",alignItems:"center",gap:7,background:moodColor(brightest.m),color:brightest.m<46?"#fff":INK,border:"none",borderRadius:999,padding:"5px 12px",fontSize:12.5,fontWeight:600,cursor:"pointer"}}><span style={{fontSize:15,lineHeight:1}}>☀️</span><b style={{fontWeight:800}}>Brightest</b> {brightest.c.label} · {brightest.m} <span style={{opacity:.65}}>›</span></button>}
                {heaviest && (!brightest||heaviest.c.id!==brightest.c.id) && <button onClick={()=>setArticlesModal({label:heaviest.c.label,mood:heaviest.m,items:results[heaviest.c.id]?.items||[]})} style={{display:"inline-flex",alignItems:"center",gap:7,background:moodColor(heaviest.m),color:heaviest.m<46?"#fff":INK,border:"none",borderRadius:999,padding:"5px 12px",fontSize:12.5,fontWeight:600,cursor:"pointer"}}><span style={{fontSize:15,lineHeight:1}}>⛈️</span><b style={{fontWeight:800}}>Heaviest</b> {heaviest.c.label} · {heaviest.m} <span style={{opacity:.65}}>›</span></button>}
              </div>}
            </div>
            <div style={{filter:"drop-shadow(0 6px 14px rgba(0,0,0,.2))"}}><Glyph mood={overall} size={108}/></div>
          </div>
          {overall!=null && <HeroVote overall={overall} data={votes["overall"]} mine={myVotes["overall"]} onVote={(dir)=>handleVote("overall",dir)} count={commentCounts["overall"]} onComment={()=>setCommentsFor({id:"overall",label:"Today’s mood"})}/>}
          <div style={{position:"relative",marginTop:18,display:"flex",gap:10,flexWrap:"wrap",alignItems:"center"}}>
            <button onClick={()=>{setCopied(false);setShare(true);}} style={glassBtn}>Share today’s mood</button>
            <div style={{fontSize:12,opacity:.8}}>{lastRun?`last read ${ago(lastRun)}${fromCrowd?" by the crowd":""}`:"not read yet"} · scale 0 (stormy) - 100 (radiant)</div>
          </div>
        </section>

        {(topArts.sunny||topArts.cloudy) && <div style={{marginTop:14}}>
          <div style={{fontFamily:F.display,fontWeight:700,fontSize:15,color:INK2,letterSpacing:"0.02em",marginBottom:8}}>The crowd’s picks today <span style={{fontWeight:600,color:"#9AA3AE",fontSize:12}}>· updates live</span></div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(240px,1fr))",gap:12}}>
            <CrowdPick pick={topArts.sunny} kind="sunny"/>
            <CrowdPick pick={topArts.cloudy} kind="cloudy"/>
          </div>
        </div>}

        {error&&<div style={{marginTop:14,padding:"10px 14px",border:`1px solid #E7B4A8`,background:"#FBEDE9",borderRadius:12,color:"#9A3B26",fontSize:13}}>{error}</div>}

        {/* THE SUNNY SIDE */}
        <section style={{marginTop:18}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10,gap:10}}>
            <div style={{fontFamily:F.display,fontWeight:700,fontSize:15,color:INK2,letterSpacing:"0.02em",display:"flex",alignItems:"center",gap:8}}><Glyph mood={94} size={22}/>The Sunny Side</div>
            <button onClick={readSunny} disabled={sunnyBusy} style={{background:CARD,border:`1px solid ${LINE}`,borderRadius:999,padding:"6px 13px",fontSize:12.5,fontWeight:700,color:INK,opacity:sunnyBusy?.6:1,cursor:sunnyBusy?"default":"pointer",display:"flex",alignItems:"center",gap:7}}>{sunnyBusy?<><Spinner size={13}/>Finding…</>:"Refresh"}</button>
          </div>
          <div style={{background:"linear-gradient(135deg, #FFF6E0 0%, #FFFDF7 100%)",border:"1px solid #F0E2BE",borderRadius:18,padding:18,boxShadow:"0 2px 12px rgba(244,169,59,.12)"}}>
            {sunny ? (
              <div style={{display:"flex",gap:16,alignItems:"flex-start"}}>
                <div style={{flexShrink:0}}><Glyph mood={sunny.mood} size={52}/></div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:11,fontWeight:800,letterSpacing:"0.1em",color:"#B5860B",textTransform:"uppercase",marginBottom:6}}>Brightest story today</div>
                  <div style={{fontFamily:F.display,fontWeight:700,fontSize:18,lineHeight:1.25}}>{sunny.item.url?<a href={sunny.item.url} target="_blank" rel="noreferrer">{sunny.item.title}</a>:sunny.item.title}</div>
                  {sunny.item.summary&&<div style={{fontSize:13.5,color:INK2,marginTop:6,lineHeight:1.45}}>{sunny.item.summary}</div>}
                  <div style={{fontSize:12,color:"#9AA3AE",marginTop:8,fontWeight:600}}>{sunny.item.source||""}{sunny.t?` · ${ago(sunny.t)}`:""}</div>
                  <div style={{display:"flex",alignItems:"center",gap:10,marginTop:8,flexWrap:"wrap"}}>
                    <ArticleReact data={votes[artId(sunny.item)]} mine={myVotes[artId(sunny.item)]} onVote={(dir)=>handleVote(artId(sunny.item),dir,{title:sunny.item.title,source:sunny.item.source,url:sunny.item.url})}/>
                    <CommentButton count={commentCounts[artId(sunny.item)]} onClick={()=>setCommentsFor({id:artId(sunny.item),label:sunny.item.title.slice(0,60)})}/>
                  </div>
                </div>
                <div style={{fontFamily:F.display,fontWeight:800,fontSize:40,color:moodColor(sunny.mood),lineHeight:1,flexShrink:0}}>{sunny.mood}</div>
              </div>
            ) : (
              <div style={{display:"flex",alignItems:"center",gap:12,fontSize:14,color:INK2}}>{sunnyBusy?<><Spinner size={18}/>Scanning for the day’s most uplifting story…</>:"Tap Refresh (or “Read today’s sky”) to surface the most positive story in the news right now."}</div>
            )}
          </div>
        </section>

        {/* THE DARK SIDE */}
        <section style={{marginTop:14}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10,gap:10}}>
            <div style={{fontFamily:F.display,fontWeight:700,fontSize:15,color:INK2,letterSpacing:"0.02em",display:"flex",alignItems:"center",gap:8}}><Glyph mood={10} size={22}/>The Dark Side</div>
            <button onClick={readDark} disabled={darkBusy} style={{background:CARD,border:`1px solid ${LINE}`,borderRadius:999,padding:"6px 13px",fontSize:12.5,fontWeight:700,color:INK,opacity:darkBusy?.6:1,cursor:darkBusy?"default":"pointer",display:"flex",alignItems:"center",gap:7}}>{darkBusy?<><Spinner size={13}/>Finding…</>:"Refresh"}</button>
          </div>
          <div style={{background:"linear-gradient(135deg, #EAEEF4 0%, #FAFBFD 100%)",border:"1px solid #D3DBE6",borderRadius:18,padding:18,boxShadow:"0 2px 12px rgba(94,126,168,.12)"}}>
            {dark ? (
              <div style={{display:"flex",gap:16,alignItems:"flex-start"}}>
                <div style={{flexShrink:0}}><Glyph mood={dark.mood} size={52}/></div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:11,fontWeight:800,letterSpacing:"0.1em",color:"#5E7196",textTransform:"uppercase",marginBottom:6}}>Heaviest story today</div>
                  <div style={{fontFamily:F.display,fontWeight:700,fontSize:18,lineHeight:1.25}}>{dark.item.url?<a href={dark.item.url} target="_blank" rel="noreferrer">{dark.item.title}</a>:dark.item.title}</div>
                  {dark.item.summary&&<div style={{fontSize:13.5,color:INK2,marginTop:6,lineHeight:1.45}}>{dark.item.summary}</div>}
                  <div style={{fontSize:12,color:"#9AA3AE",marginTop:8,fontWeight:600}}>{dark.item.source||""}{dark.t?` · ${ago(dark.t)}`:""}</div>
                  <div style={{display:"flex",alignItems:"center",gap:10,marginTop:8,flexWrap:"wrap"}}>
                    <ArticleReact data={votes[artId(dark.item)]} mine={myVotes[artId(dark.item)]} onVote={(dir)=>handleVote(artId(dark.item),dir,{title:dark.item.title,source:dark.item.source,url:dark.item.url})}/>
                    <CommentButton count={commentCounts[artId(dark.item)]} onClick={()=>setCommentsFor({id:artId(dark.item),label:dark.item.title.slice(0,60)})}/>
                  </div>
                </div>
                <div style={{fontFamily:F.display,fontWeight:800,fontSize:40,color:moodColor(dark.mood),lineHeight:1,flexShrink:0}}>{dark.mood}</div>
              </div>
            ) : (
              <div style={{display:"flex",alignItems:"center",gap:12,fontSize:14,color:INK2}}>{darkBusy?<><Spinner size={18}/>Scanning for the day’s heaviest story…</>:"Tap Refresh (or “Read today’s sky”) to surface the most sobering story in the news right now."}</div>
            )}
          </div>
        </section>

        {/* SEARCH / ASK */}
        <section style={{marginTop:18}}>
          <div style={{display:"flex",alignItems:"center",gap:10,background:CARD,border:`1px solid ${LINE}`,borderRadius:16,padding:"10px 12px 10px 16px",boxShadow:"0 2px 10px rgba(27,35,48,.04)"}}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={INK2} strokeWidth="2"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.5" y2="16.5"/></svg>
            <input value={q} onChange={e=>setQ(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")submitSearch();}} placeholder={"Look up a subject — or ask “what has the worst mood right now?”"}/>
            <button onClick={submitSearch} disabled={outBusy||!q.trim()} style={{...primary(outBusy||!q.trim()),minWidth:54,display:"flex",justifyContent:"center"}}>{outBusy?<Spinner size={15} color="#fff"/>:"Go"}</button>
          </div>
          {recent.length>0 && <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:10}}>
            {recent.map((r,i)=>{const isQ=looksLikeQuestion(r.subject);return (
              <span key={i} style={{display:"inline-flex",alignItems:"center",background:CARD,border:`1px solid ${LINE}`,borderRadius:999,paddingRight:3,maxWidth:340}}>
                <button onClick={()=>{setQ(r.subject);isQ?askQuestion(r.subject):runSearch(r.subject);}} style={{display:"flex",alignItems:"center",gap:7,background:"transparent",borderRadius:999,padding:"5px 4px 5px 11px",fontSize:12,color:INK,fontWeight:600,minWidth:0}}>
                  {isQ?<span style={{flexShrink:0,width:14,height:14,borderRadius:"50%",background:"#E7ECF2",color:INK2,fontSize:10,fontWeight:800,display:"flex",alignItems:"center",justifyContent:"center"}}>?</span>:<span style={{flexShrink:0,width:8,height:8,borderRadius:"50%",background:moodColor(r.mood)}}/>}
                  <span style={{whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{r.subject}</span>{!isQ&&<span style={{color:INK2,fontWeight:700,flexShrink:0}}>{r.mood??"—"}</span>}
                </button>
                <button onClick={()=>removeRecent(i)} title="Remove" style={{background:"transparent",color:"#AEB6C0",fontSize:12,fontWeight:700,padding:"5px 7px",lineHeight:1}}>×</button>
              </span>);})}
          </div>}

          {outBusy && !answer && !searchResult && (
            <div style={{marginTop:12,display:"flex",alignItems:"center",gap:12,background:CARD,border:`1px solid ${LINE}`,borderRadius:18,padding:18,boxShadow:"0 6px 18px rgba(27,35,48,.06)"}}>
              <Spinner size={22}/><div style={{fontSize:14,color:INK2,fontWeight:600}}>{questionBusy?"Thinking it through…":"Reading the latest and gauging the mood…"}</div>
            </div>
          )}

          {answer && (
            <div style={{marginTop:12,background:CARD,border:`1px solid ${LINE}`,borderRadius:18,padding:18,boxShadow:"0 6px 18px rgba(27,35,48,.06)"}}>
              <div style={{fontSize:11,fontWeight:800,letterSpacing:"0.1em",color:INK2,textTransform:"uppercase",marginBottom:8}}>Answer</div>
              <div style={{fontSize:16,lineHeight:1.5,fontWeight:500}}>{answer.answer}</div>
              <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap",marginTop:12}}>
                {answer.mood!=null&&<div style={{display:"flex",alignItems:"center",gap:8,background:PAPER,borderRadius:999,padding:"4px 10px"}}><Glyph mood={answer.mood} size={22}/><span style={{fontFamily:F.display,fontWeight:800,color:moodColor(answer.mood)}}>{answer.mood}</span></div>}
                {answer.openId&&<button onClick={()=>openById(answer.openId)} style={{...primary(false),padding:"7px 13px"}}>Open →</button>}
                {answer.subject&&!answer.local&&<button onClick={()=>{setQ(answer.subject);runSearch(answer.subject);}} style={{...primary(false),padding:"7px 13px"}}>See {answer.subject} →</button>}
                {answer.raw&&!strongQuestion(answer.raw)&&<button onClick={()=>{setQ(answer.raw);runSearch(answer.raw);}} style={{background:"transparent",color:INK2,fontSize:12.5,fontWeight:600,textDecoration:"underline",padding:0}}>Look up “{answer.raw}” as a subject</button>}
              </div>
            </div>
          )}

          {searchResult && (
            <div style={{marginTop:12,background:CARD,border:`1px solid ${LINE}`,borderRadius:18,padding:18,boxShadow:"0 6px 18px rgba(27,35,48,.06)"}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}>
                <div style={{display:"flex",alignItems:"center",gap:14}}><Glyph mood={searchResult.mood} size={52}/>
                  <div><div style={{fontFamily:F.display,fontWeight:700,fontSize:20,textTransform:"capitalize"}}>{searchResult.subject}</div>
                  <div style={{fontSize:13,color:INK2,fontWeight:600}}>{searchResult.error?"Couldn’t get a read — try rephrasing.":moodWord(searchResult.mood)}</div></div></div>
                <div style={{display:"flex",alignItems:"center",gap:14}}>
                  {!searchResult.error&&<button onClick={()=>isSavedSubj(searchResult.subject)?openEntity("sub",{id:slug(searchResult.subject),query:searchResult.subject}):saveSubject(searchResult.subject)} style={{background:isSavedSubj(searchResult.subject)?"#FFF6E2":CARD,border:`1px solid ${isSavedSubj(searchResult.subject)?"#E9C877":LINE}`,borderRadius:999,padding:"7px 13px",fontSize:13,fontWeight:700,color:INK}}>{isSavedSubj(searchResult.subject)?"★ Saved · view":"☆ Save & track"}</button>}
                  <div style={{fontFamily:F.display,fontWeight:800,fontSize:44,color:moodColor(searchResult.mood),lineHeight:1}}>{searchResult.mood??"——"}</div>
                </div>
              </div>
              {searchResult.items?.length>0 && <ul style={{listStyle:"none",margin:"14px 0 0",padding:0,display:"grid",gap:9}}>{searchResult.items.map((it,i)=><Headline key={i} it={it}/>)}</ul>}
            </div>
          )}
        </section>

        {/* FOLLOWING */}
        {saved.length>0 && (
          <section style={{marginTop:22}}>
            <div style={{fontFamily:F.display,fontWeight:700,fontSize:15,color:INK2,letterSpacing:"0.02em",marginBottom:12}}>Following · {saved.length}{editMode?" · drag with ↑ ↓":""}</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))",gap:14}}>
              {saved.map((s,idx)=>{const d=results[s.id];const m=d?.mood;const series=(d?.series||[]).map(p=>p.mood);const loading=loadingIds.includes(s.id);
                return (<div key={s.id} className={loading?"cat busy-card":"cat"} style={{position:"relative",background:CARD,border:`1px solid ${LINE}`,borderRadius:18,padding:16,boxShadow:"0 2px 10px rgba(27,35,48,.04)"}}>
                  {editMode ? (
                    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                      <div style={{display:"flex",gap:6}}>
                        <button onClick={()=>moveSaved(s.id,-1)} disabled={idx===0} style={ctrlBtn(idx===0)}>↑</button>
                        <button onClick={()=>moveSaved(s.id,1)} disabled={idx===saved.length-1} style={ctrlBtn(idx===saved.length-1)}>↓</button>
                      </div>
                      <button onClick={()=>unsave(s.id)} style={{...ctrlBtn(false),color:"#B4453A"}}>✕ Remove</button>
                    </div>
                  ) : (<>
                    <button onClick={()=>refreshOne(s)} title="Refresh this" disabled={busy} style={{position:"absolute",top:10,right:36,background:"transparent",color:"#AEB6C0",fontSize:14,padding:4}}><span className={loading?"spin":undefined} style={{display:"inline-block"}}>↻</span></button>
                    <button onClick={()=>unsave(s.id)} title="Unfollow" style={{position:"absolute",top:10,right:10,background:"transparent",color:"#B6BDC6",fontSize:16,lineHeight:1,padding:4}}>×</button>
                  </>)}
                  <button onClick={()=>!editMode&&openEntity("sub",s)} style={{textAlign:"left",background:"transparent",width:"100%",padding:0,marginTop:editMode?12:0,cursor:editMode?"default":"pointer"}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",paddingRight:editMode?0:18}}>
                      <Glyph mood={loading?null:m} size={40}/><div style={{fontFamily:F.display,fontWeight:800,fontSize:30,color:moodColor(m),lineHeight:1,minHeight:30,display:"flex",alignItems:"center"}}>{loading?<Spinner size={24}/>:(m??"——")}</div></div>
                    <div style={{fontFamily:F.display,fontWeight:700,fontSize:15,marginTop:10,textTransform:"capitalize",lineHeight:1.15}}>{s.subject}</div>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",marginTop:6,minHeight:18}}>
                      <div style={{fontSize:12,color:INK2,fontWeight:600,display:"flex",alignItems:"center",gap:6}}>{loading?<><Spinner size={11}/>reading…</>:moodWord(m)}</div><Spark series={series} color={moodColor(m)}/></div>
                    {!editMode&&<div style={{fontSize:11.5,color:"#9AA3AE",marginTop:8,fontWeight:600}}>{d?.t?`updated ${ago(d.t)} · `:""}Tap for graph →</div>}
                  </button>
                  {!editMode&&m!=null&&<CommentButton compact count={commentCounts[s.id]} onClick={()=>setCommentsFor({id:s.id,label:s.subject})}/>}
                </div>);})}
            </div>
          </section>
        )}

        {/* SURPRISE */}
        <div style={{marginTop:18,display:"flex",alignItems:"center",gap:12,background:CARD,border:`1px solid ${LINE}`,borderRadius:14,padding:"12px 16px",boxShadow:"0 2px 10px rgba(27,35,48,.04)"}}>
          <div style={{fontSize:11,fontWeight:800,letterSpacing:"0.1em",color:INK2,textTransform:"uppercase",whiteSpace:"nowrap"}}>Today’s mover</div>
          {mover ? <div style={{fontSize:15,fontWeight:600}}>{mover.label} {mover.d>0?"is brightening":"is darkening"} <span style={{color:moodColor(mover.d>0?75:25),fontWeight:800}}>{mover.d>0?`▲ +${mover.d}`:`▼ ${mover.d}`}</span> since your last reading.</div>
            : <div style={{fontSize:14,color:INK2}}>Take a couple of readings and the biggest shift in mood shows up here.</div>}
        </div>

        {/* CATEGORY GRID */}
        <div style={{marginTop:22,display:"flex",alignItems:"center",justifyContent:"space-between",gap:10}}>
          <div style={{fontFamily:F.display,fontWeight:700,fontSize:15,color:INK2,letterSpacing:"0.02em"}}>Forecast by topic</div>
          <button onClick={()=>setEditMode(v=>!v)} style={{background:editMode?ACCENT:CARD,color:editMode?"#fff":INK,border:`1px solid ${editMode?ACCENT:LINE}`,borderRadius:999,padding:"6px 13px",fontSize:12.5,fontWeight:700}}>{editMode?"Done":"Customize"}</button>
        </div>
        {editMode&&<div style={{marginTop:8,fontSize:12.5,color:INK2,background:"#EEF4FF",border:`1px solid #D6E4FB`,borderRadius:12,padding:"9px 13px"}}>Reorder with ↑ ↓, hide with ✕. Hidden topics still count toward the headline mood and can be restored in Settings.</div>}
        <section style={{marginTop:12,display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(232px,1fr))",gap:14}}>
          {visibleCats.map((c,idx)=>{const d=results[c.id];const loading=loadingIds.includes(c.id);const m=d?.mood;const has=m!=null;const series=(d?.series||[]).map(p=>p.mood);
            return (<div key={c.id} className={loading?"cat busy-card":"cat"} style={{position:"relative",background:CARD,border:`1px solid ${LINE}`,borderRadius:18,padding:16,boxShadow:"0 2px 10px rgba(27,35,48,.04)"}}>
              {editMode ? (<div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
                <div style={{display:"flex",gap:6}}>
                  <button onClick={()=>moveCat(c.id,-1)} disabled={idx===0} style={ctrlBtn(idx===0)}>↑</button>
                  <button onClick={()=>moveCat(c.id,1)} disabled={idx===visibleCats.length-1} style={ctrlBtn(idx===visibleCats.length-1)}>↓</button>
                </div>
                <button onClick={()=>hideCat(c.id)} style={{...ctrlBtn(false),color:"#B4453A"}}>✕ Hide</button>
              </div>) : has && (
                <button onClick={()=>refreshOne(c)} title="Refresh this topic" disabled={busy} style={{position:"absolute",top:10,right:10,background:"transparent",color:"#AEB6C0",fontSize:15,padding:4,zIndex:1}}><span className={loading?"spin":undefined} style={{display:"inline-block"}}>↻</span></button>
              )}
              <button onClick={()=>{if(editMode)return; has?openEntity("cat",c):refreshOne(c);}} style={{textAlign:"left",background:"transparent",width:"100%",padding:0,cursor:editMode?"default":"pointer"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",paddingRight:(!editMode&&has)?18:0}}>
                  <Glyph mood={loading?null:m} size={44}/><div style={{fontFamily:F.display,fontWeight:800,fontSize:34,color:moodColor(m),lineHeight:1,minHeight:34,display:"flex",alignItems:"center"}}>{loading?<Spinner size={26}/>:(m??"——")}</div></div>
                <div style={{fontFamily:F.display,fontWeight:700,fontSize:16,marginTop:10,lineHeight:1.15}}>{c.label}</div>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",marginTop:6,minHeight:20}}>
                  <div style={{fontSize:12.5,color:INK2,fontWeight:600,display:"flex",alignItems:"center",gap:6}}>{loading?<><Spinner size={12}/>reading…</>:moodWord(m)}</div><Spark series={series} color={moodColor(m)}/></div>
                {!editMode&&has&&<div style={{fontSize:11.5,color:"#9AA3AE",marginTop:8,fontWeight:600}}>updated {ago(d?.t)} · Tap for graph & why →</div>}
              </button>
              {!editMode&&!has&&!loading&&<button onClick={()=>refreshOne(c)} disabled={busy} style={{width:"100%",marginTop:12,background:ACCENT,color:"#fff",borderRadius:10,padding:"9px 0",fontSize:13,fontWeight:700,opacity:busy?.5:1,cursor:busy?"not-allowed":"pointer"}}>Get mood</button>}
              {!editMode&&has&&<CommentButton compact count={commentCounts[c.id]} onClick={()=>setCommentsFor({id:c.id,label:c.label})}/>}
            </div>);})}
        </section>

        {/* MOOD MAP */}
        <section style={{marginTop:24,background:CARD,border:`1px solid ${LINE}`,borderRadius:18,padding:"16px 16px 14px",boxShadow:"0 2px 10px rgba(27,35,48,.04)"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:10,marginBottom:4}}>
            <div>
              <div style={{fontFamily:F.display,fontWeight:800,fontSize:18,display:"flex",alignItems:"center",gap:8}}>🗺️ Mood Map</div>
              <div style={{fontSize:12.5,color:INK2,fontWeight:600,marginTop:2}}>How the world feels, place by place. Tap any country to read its news.{worldCount>0?` · ${worldCount} read`:""}</div>
            </div>
            <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
              {worldProgress ? (
                <button onClick={()=>{stopWorldRef.current=true;}} style={{background:CARD,border:`1px solid ${LINE}`,color:INK,borderRadius:12,padding:"8px 14px",fontSize:13,fontWeight:700,display:"flex",alignItems:"center",gap:8,cursor:"pointer"}}>
                  <Spinner size={14} color={ACCENT}/>Reading {worldProgress.done}/{worldProgress.total} · Stop
                </button>
              ) : (<>
                <button onClick={readBigCountries} disabled={worldAllBusy} style={{...primary(worldAllBusy),padding:"8px 14px",display:"flex",alignItems:"center",gap:8}}>{worldAllBusy?<><Spinner size={14} color="#fff"/>Reading<Dots color="#fff"/></>:"Read major countries"}</button>
                <ConfirmButton label="Read all countries" onConfirm={readAllCountries} style={{background:CARD,border:`1px solid ${LINE}`,color:INK,borderRadius:12,padding:"8px 14px",fontSize:13,fontWeight:700,cursor:"pointer"}}/>
              </>)}
            </div>
          </div>
          <div style={{marginTop:12}}>
            <MoodMap moods={worldMoods} busy={worldBusy} onPick={onPickCountry}/>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:10,marginTop:12,flexWrap:"wrap"}}>
            <span style={{fontSize:11.5,color:INK2,fontWeight:700}}>Stormy</span>
            <div style={{flex:1,minWidth:120,height:9,borderRadius:999,background:`linear-gradient(90deg, ${moodColor(8)}, ${moodColor(30)}, ${moodColor(50)}, ${moodColor(70)}, ${moodColor(92)})`}}/>
            <span style={{fontSize:11.5,color:INK2,fontWeight:700}}>Radiant</span>
            <span style={{fontSize:11,color:"#9AA3AE",marginLeft:6}}>Grey = not read yet</span>
          </div>
          {worldSel && <div style={{marginTop:14,border:`1px solid ${LINE}`,borderRadius:14,overflow:"hidden"}}>
            <div style={{background:`linear-gradient(135deg, ${rgb(scl(moodRGB(worldSel.mood??50),.55))}, ${moodColor(worldSel.mood??50)})`,color:"#fff",padding:"14px 16px",display:"flex",alignItems:"center",justifyContent:"space-between",gap:12}}>
              <div style={{display:"flex",alignItems:"center",gap:12}}><Glyph mood={worldSel.mood} size={42}/>
                <div><div style={{fontFamily:F.display,fontWeight:800,fontSize:20,lineHeight:1.1}}>{worldSel.label}</div>
                  <div style={{fontWeight:600,opacity:.95,fontSize:13,marginTop:2}}>{worldSel.loading?"Reading the latest…":worldSel.error?"Couldn’t read this one":`${moodWord(worldSel.mood)} · ${worldSel.mood??"——"}/100${worldMoods[worldSel.code]?.t?` · updated ${ago(worldMoods[worldSel.code].t)}`:""}`}</div></div></div>
              <div style={{display:"flex",gap:8}}>
                <button onClick={()=>onPickCountry(worldSel.code,worldSel.label)} disabled={worldBusy.includes(worldSel.code)} style={{...glassBtn,padding:"6px 12px",fontSize:13}}>↻ Refresh</button>
                <button onClick={()=>setWorldSel(null)} style={{...glassBtn,padding:"6px 12px",fontSize:13}}>Close</button>
              </div>
            </div>
            <div style={{padding:"14px 16px",background:PAPER}}>
              {worldSel.loading ? <div style={{display:"flex",alignItems:"center",gap:10,color:INK,fontWeight:600,fontSize:13.5,padding:"6px 0"}}><Spinner size={18} color={ACCENT}/>Searching {worldSel.label}’s headlines and gauging the mood<Dots/></div>
               : worldSel.error ? <div style={{color:INK2,fontSize:13.5}}>Couldn’t reach {worldSel.label} right now — tap Refresh to try again.</div>
               : worldSel.items&&worldSel.items.length ? <ul style={{listStyle:"none",margin:0,padding:0,display:"grid",gap:9}}>{worldSel.items.map((it,i)=><Headline key={i} it={it}/>)}</ul>
               : <div style={{color:INK2,fontSize:13.5}}>No headlines surfaced for {worldSel.label}.</div>}
            </div>
          </div>}
        </section>

        {/* OVERALL TREND */}
        <section style={{marginTop:24,background:CARD,border:`1px solid ${LINE}`,borderRadius:18,padding:"16px 14px 8px",boxShadow:"0 2px 10px rgba(27,35,48,.04)"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8,paddingLeft:6,marginBottom:10}}>
            <div style={{fontFamily:F.display,fontWeight:700,fontSize:17}}>Public mood over time</div>
            <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
              {RANGES.map(([lbl])=>(
                <button key={lbl} onClick={()=>setRange(lbl)} style={{background:range===lbl?ACCENT:CARD,color:range===lbl?"#fff":INK2,border:`1px solid ${range===lbl?ACCENT:LINE}`,borderRadius:8,padding:"4px 8px",fontSize:11.5,fontWeight:700,cursor:"pointer"}}>{lbl}</button>
              ))}
            </div>
          </div>
          {chartData.length<2 ? <div style={{padding:"34px 12px",textAlign:"center",color:INK2,fontSize:13}}>Not enough data in this range yet. Take a few readings, or pick a longer span to see the historical arc.</div>
          : <ResponsiveContainer width="100%" height={230}>
              <LineChart data={chartData} margin={{top:6,right:14,bottom:4,left:-20}} onClick={onChartClick} style={{cursor:"pointer"}}>
                <defs><linearGradient id="mg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#F4A93B"/><stop offset="100%" stopColor="#46577A"/></linearGradient></defs>
                <CartesianGrid stroke={LINE} vertical={false}/>
                <XAxis dataKey="t" type="number" scale="time" domain={["dataMin","dataMax"]} tickFormatter={axisFmt} stroke={LINE} tickLine={false} minTickGap={44}/>
                <YAxis domain={[0,100]} ticks={[0,25,50,75,100]} stroke={LINE} tickLine={false}/>
                {seedEnd>seedStart && <ReferenceArea x1={seedStart} x2={seedEnd} fill={INK} fillOpacity={0.05} ifOverflow="extendDomain" label={{value:"estimated",position:"insideTopLeft",fontSize:10,fill:INK2}}/>}
                <ReferenceLine y={50} stroke={INK2} strokeDasharray="3 3"/>
                <Tooltip content={(props)=><MoodTip {...props} labelFmt={labelFmt}/>}/>
                <Line type="monotone" dataKey="overall" name="Public mood" stroke="url(#mg)" strokeWidth={range==="250Y"||range==="100Y"?2:3} dot={false} isAnimationActive={!reduced}/>
              </LineChart>
            </ResponsiveContainer>}
          {yearNote && <div style={{margin:"12px 6px 4px",background:`linear-gradient(135deg, ${rgb(scl(moodRGB(yearNote.mood),.86))}, #FFFFFF)`,border:`1px solid ${LINE}`,borderRadius:14,padding:"14px 16px"}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10}}>
              <div style={{display:"flex",alignItems:"center",gap:10}}><Glyph mood={yearNote.mood} size={34}/>
                <div><div style={{fontFamily:F.display,fontWeight:800,fontSize:17}}>{yearNote.label}</div>
                  <div style={{fontSize:12.5,color:INK2,fontWeight:600}}><b style={{color:moodColor(yearNote.mood),fontWeight:800}}>{yearNote.mood}</b> · {moodWord(yearNote.mood)} · {yearNote.live?"real reading":"estimate"}</div></div></div>
              <button onClick={()=>setYearNote(null)} style={{background:"transparent",fontSize:18,color:INK2,lineHeight:1}}>×</button>
            </div>
            {yearNote.ev && <div style={{fontSize:12.5,fontWeight:700,color:INK,marginTop:10}}>{yearNote.ev}</div>}
            <div style={{fontSize:13.5,color:INK,marginTop:8,lineHeight:1.5}}>{yearNote.loading?<span style={{display:"inline-flex",alignItems:"center",gap:8,color:INK2}}><Spinner size={15}/>Looking back at {yearNote.label}…</span>:yearNote.text}</div>
          </div>}
          <div style={{fontSize:11,color:"#9AA3AE",padding:"6px 6px 0",lineHeight:1.5}}>The shaded stretch is a <b style={{fontWeight:700}}>historical estimate</b> of U.S. public mood, not a measurement — reconstructed from documented conditions, and from 1952 the U. Michigan Consumer Sentiment Index and (from 1979) Gallup. <b style={{fontWeight:700}}>Tap any point</b> on the line to learn why. Your live readings add real data from today.</div>
        </section>

        <div style={{marginTop:16,fontSize:11,color:"#9AA3AE",textAlign:"center",maxWidth:560,marginLeft:"auto",marginRight:"auto",lineHeight:1.5}}>A playful read on the mood of the news, not a precise measurement. Scores are AI estimates of recent headlines, searched live.</div>
      </div>

      {/* DETAIL DRAWER */}
      {detail && (()=>{
        const isCat=detail.kind==="cat"; const ent=isCat?CATEGORIES.find(c=>c.id===detail.id):saved.find(s=>s.id===detail.id);
        if(!ent)return null; const d=results[detail.id]; const label=isCat?ent.label:ent.subject; const series=d?.series||[];
        return (
        <div onClick={()=>setDetail(null)} style={{position:"fixed",inset:0,background:"rgba(20,26,36,.45)",backdropFilter:"blur(3px)",display:"flex",justifyContent:"flex-end",zIndex:50}}>
          <div onClick={e=>e.stopPropagation()} style={{width:"min(560px,100%)",background:PAPER,height:"100%",overflowY:"auto",boxShadow:"-20px 0 50px rgba(0,0,0,.25)"}}>
            <div style={{background:`linear-gradient(160deg, ${rgb(scl(moodRGB(d?.mood??50),.5))}, ${moodColor(d?.mood??50)})`,color:"#fff",padding:"22px 22px 26px"}}>
              <div style={{display:"flex",justifyContent:"space-between"}}>
                <button onClick={()=>setDetail(null)} style={{...glassBtn,padding:"5px 12px",fontSize:13}}>← Close</button>
                <div style={{display:"flex",gap:8}}>
                  <button onClick={()=>refreshOne(ent)} disabled={busy} style={{...glassBtn,padding:"5px 12px",fontSize:13}}>↻ Refresh</button>
                  {!isCat && <button onClick={()=>unsave(ent.id)} style={{...glassBtn,padding:"5px 12px",fontSize:13}}>Unfollow</button>}
                </div>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:16,marginTop:16}}>
                <Glyph mood={d?.mood} size={72}/>
                <div><div style={{fontFamily:F.display,fontWeight:800,fontSize:26,lineHeight:1.05,textTransform:isCat?"none":"capitalize"}}>{label}</div>
                <div style={{fontWeight:600,opacity:.92,marginTop:2}}>{moodWord(d?.mood)} · {d?.mood??"——"}/100</div></div>
              </div>
            </div>
            <div style={{padding:"20px 22px 40px"}}>
              <div style={{fontFamily:F.display,fontWeight:700,fontSize:15,color:INK2,marginBottom:10}}>Trend over time</div>
              <EntityGraph series={series}/>
              {isCat ? (<>
                <div style={{fontFamily:F.display,fontWeight:700,fontSize:15,color:INK2,margin:"22px 0 10px"}}>What’s driving it</div>
                {detailLoading && !d?.subs && <div style={{color:INK,fontSize:13.5,fontWeight:600,padding:"11px 14px",marginBottom:10,display:"flex",alignItems:"center",gap:10,background:"#EEF4FF",border:`1px solid #D6E4FB`,borderRadius:12}}><Spinner size={18} color={ACCENT}/>Reading {ent.subs.length} subtopics<Dots/></div>}
                <div style={{display:"grid",gap:10}}>
                  {ent.subs.map(s=>{const sd=d?.subs?.[s.id];const subLoading=!sd&&detailLoading;return (
                    <div key={s.id} className={subLoading?"busy-card":undefined} style={{background:CARD,border:`1px solid ${subLoading?"#CFE0FA":LINE}`,borderRadius:14,padding:"12px 14px"}}>
                      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10}}>
                        <div style={{display:"flex",alignItems:"center",gap:10}}>{subLoading?<Spinner size={26} color={ACCENT}/>:<Glyph mood={sd?.mood} size={30}/>}<div style={{fontWeight:700,fontSize:14}}>{s.label}</div></div>
                        {subLoading?<div style={{display:"flex",alignItems:"center",gap:6,fontSize:12.5,fontWeight:700,color:ACCENT}}>Reading<Dots color={ACCENT}/></div>:<div style={{fontFamily:F.display,fontWeight:800,fontSize:22,color:moodColor(sd?.mood)}}>{sd?.mood??"——"}</div>}</div>
                      {sd?.items?.length>0 && <ul style={{listStyle:"none",margin:"10px 0 0",padding:0,display:"grid",gap:8}}>{sd.items.map((it,i)=><Headline key={i} it={it} small/>)}</ul>}
                    </div>);})}
                </div>
              </>) : (<>
                <div style={{fontFamily:F.display,fontWeight:700,fontSize:15,color:INK2,margin:"22px 0 10px"}}>Recent headlines</div>
                {detailLoading && !d?.items?.length && <div style={{color:INK,fontSize:13.5,fontWeight:600,padding:"11px 14px",display:"flex",alignItems:"center",gap:10,background:"#EEF4FF",border:`1px solid #D6E4FB`,borderRadius:12}}><Spinner size={18} color={ACCENT}/>Reading the latest headlines<Dots/></div>}
                {d?.items?.length>0 && <ul style={{listStyle:"none",margin:0,padding:14,display:"grid",gap:9,background:CARD,border:`1px solid ${LINE}`,borderRadius:14}}>{d.items.map((it,i)=><Headline key={i} it={it}/>)}</ul>}
              </>)}
            </div>
          </div>
        </div>);
      })()}

      {/* SETTINGS */}
      {showSettings && (
        <div onClick={()=>setShowSettings(false)} style={{position:"fixed",inset:0,background:"rgba(20,26,36,.5)",display:"flex",alignItems:"center",justifyContent:"center",padding:20,zIndex:60}}>
          <div onClick={e=>e.stopPropagation()} style={{width:"min(440px,100%)",maxHeight:"86vh",overflowY:"auto",background:PAPER,borderRadius:20,boxShadow:"0 24px 60px rgba(0,0,0,.35)"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"18px 20px",borderBottom:`1px solid ${LINE}`}}>
              <div style={{fontFamily:F.display,fontWeight:800,fontSize:20}}>Settings</div>
              <button onClick={()=>setShowSettings(false)} style={{background:"transparent",fontSize:18,color:INK2}}>×</button>
            </div>
            <div style={{padding:"16px 20px 22px",display:"grid",gap:18}}>
              <Row title="Reading depth" hint="Headlines sampled per topic. More = steadier read, slower refresh.">
                <input className="num" type="number" min="2" max="6" value={perCat} onChange={e=>setPerCat(Math.max(2,Math.min(6,+e.target.value||4)))}/>
              </Row>
              <Row title="Refresh includes follows" hint="Update your followed subjects during the big Refresh.">
                <input type="checkbox" checked={includeFollows} onChange={e=>setIncludeFollows(e.target.checked)} style={{accentColor:INK,width:18,height:18}}/>
              </Row>
              <Row title="Auto-refresh while open" hint="Re-read on a timer when the app is open.">
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <input type="checkbox" checked={auto} onChange={e=>setAuto(e.target.checked)} style={{accentColor:INK,width:18,height:18}}/>
                  <input className="num" type="number" min="5" max="240" value={interval} onChange={e=>setIntervalMin(Math.max(5,Math.min(240,+e.target.value||60)))}/><span style={{fontSize:12,color:INK2}}>min</span>
                </div>
              </Row>
              <div>
                <div style={{fontWeight:700,fontSize:14,marginBottom:6}}>Hidden topics</div>
                {hiddenCats.length===0 ? <div style={{fontSize:13,color:INK2}}>None hidden. Use Customize on the dashboard to hide topics.</div>
                  : <div style={{display:"grid",gap:6}}>{hiddenCats.map(id=>{const c=CATEGORIES.find(x=>x.id===id);if(!c)return null;return (
                    <div key={id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",background:CARD,border:`1px solid ${LINE}`,borderRadius:10,padding:"8px 12px"}}>
                      <span style={{fontSize:13.5,fontWeight:600}}>{c.label}</span>
                      <button onClick={()=>restoreCat(id)} style={{...primary(false),padding:"5px 12px",fontSize:12.5}}>Restore</button></div>);})}</div>}
              </div>
              <div>
                <div style={{fontWeight:700,fontSize:14,marginBottom:8}}>Data</div>
                <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
                  <ConfirmButton label="Clear trend history" onConfirm={clearHistory} style={{background:CARD,border:`1px solid ${LINE}`,borderRadius:10,padding:"8px 13px",fontSize:13,fontWeight:700,color:INK}}/>
                  <ConfirmButton label="Remove all follows" onConfirm={()=>setSaved([])} style={{background:CARD,border:`1px solid ${LINE}`,borderRadius:10,padding:"8px 13px",fontSize:13,fontWeight:700,color:"#B4453A"}}/>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SHARE */}
      {share && (
        <div onClick={()=>setShare(false)} style={{position:"fixed",inset:0,background:"rgba(20,26,36,.55)",display:"flex",alignItems:"center",justifyContent:"center",padding:20,zIndex:70}}>
          <div onClick={e=>e.stopPropagation()} style={{width:"min(420px,100%)"}}>
            <div style={{borderRadius:24,overflow:"hidden",background:`linear-gradient(160deg, ${heroTop}, ${heroMid})`,color:"#fff",padding:28,textAlign:"center",boxShadow:"0 24px 60px rgba(0,0,0,.4)"}}>
              <div style={{fontFamily:F.display,fontWeight:800,fontSize:18,opacity:.9}}>MoodCast</div>
              <div style={{display:"flex",justifyContent:"center",margin:"10px 0"}}><Glyph mood={overall} size={92}/></div>
              <div style={{fontFamily:F.display,fontWeight:800,fontSize:88,lineHeight:.9,letterSpacing:"-0.04em"}}>{overall??"——"}</div>
              <div style={{fontFamily:F.display,fontWeight:700,fontSize:24,marginTop:2}}>{moodWord(overall)}</div>
              {delta!=null&&<div style={{fontWeight:600,opacity:.92,marginTop:4}}>{delta>0?`▲ up ${delta}`:delta<0?`▼ down ${Math.abs(delta)}`:"steady"} since last</div>}
              {(brightest||heaviest)&&<div style={{display:"flex",gap:8,justifyContent:"center",flexWrap:"wrap",marginTop:14}}>
                {brightest&&<span style={shareMini}><Glyph mood={brightest.m} size={16}/>{brightest.c.label} {brightest.m}</span>}
                {heaviest&&(!brightest||heaviest.c.id!==brightest.c.id)&&<span style={shareMini}><Glyph mood={heaviest.m} size={16}/>{heaviest.c.label} {heaviest.m}</span>}
              </div>}
              <div style={{fontSize:12,opacity:.85,marginTop:12}}>{today} · public mood</div>
            </div>
            <div style={{display:"flex",gap:10,marginTop:14}}>
              <button onClick={copy} style={{...primary(false),flex:1,background:"#fff",color:INK,border:`1px solid ${LINE}`}}>{copied?"Copied ✓":"Copy summary"}</button>
              <button onClick={()=>setShare(false)} style={{...primary(false),flex:1}}>Done</button>
            </div>
            <div style={{textAlign:"center",fontSize:12,color:"#fff",opacity:.85,marginTop:10}}>Screenshot the card to share it anywhere.</div>
          </div>
        </div>
      )}

      {/* TODAY'S CHATTER */}
      {commentsFor && <CommentsModal id={commentsFor.id} label={commentsFor.label} onClose={()=>setCommentsFor(null)} onCount={bumpCount}/>}

      {/* BRIGHTEST / HEAVIEST ARTICLES */}
      {articlesModal && <div onClick={()=>setArticlesModal(null)} style={{position:"fixed",inset:0,background:"rgba(20,26,36,.5)",backdropFilter:"blur(3px)",display:"flex",alignItems:"center",justifyContent:"center",padding:20,zIndex:75}}>
        <div onClick={e=>e.stopPropagation()} style={{width:"min(560px,100%)",maxHeight:"82vh",overflowY:"auto",background:PAPER,borderRadius:20,boxShadow:"0 24px 60px rgba(0,0,0,.35)"}}>
          <div style={{background:`linear-gradient(135deg, ${rgb(scl(moodRGB(articlesModal.mood??50),.55))}, ${moodColor(articlesModal.mood??50)})`,color:"#fff",padding:"16px 20px",display:"flex",alignItems:"center",justifyContent:"space-between",gap:12}}>
            <div style={{display:"flex",alignItems:"center",gap:12}}><Glyph mood={articlesModal.mood} size={42}/>
              <div><div style={{fontFamily:F.display,fontWeight:800,fontSize:20,lineHeight:1.1}}>{articlesModal.label}</div>
                <div style={{fontSize:13,fontWeight:600,opacity:.95,marginTop:2}}>{moodWord(articlesModal.mood)} · {articlesModal.mood}/100 · what’s behind the score</div></div></div>
            <button onClick={()=>setArticlesModal(null)} style={{...glassBtn,padding:"6px 12px",fontSize:13}}>Close</button>
          </div>
          <div style={{padding:"16px 20px 22px"}}>
            {articlesModal.items&&articlesModal.items.length
              ? <ul style={{listStyle:"none",margin:0,padding:0,display:"grid",gap:9}}>{articlesModal.items.map((it,i)=><Headline key={i} it={it}/>)}</ul>
              : <div style={{color:INK2,fontSize:13.5,lineHeight:1.5}}>No articles loaded for {articlesModal.label} yet. Tap it under “Forecast by topic” to read its headlines.</div>}
          </div>
        </div>
      </div>}

      {/* PASSCODE GATE */}
      {gate && (
        <div style={{position:"fixed",inset:0,background:"rgba(20,26,36,.6)",backdropFilter:"blur(3px)",display:"flex",alignItems:"center",justifyContent:"center",padding:20,zIndex:80}}>
          <div style={{width:"min(380px,100%)",background:PAPER,borderRadius:20,padding:24,boxShadow:"0 24px 60px rgba(0,0,0,.4)"}}>
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}><Glyph mood={overall} size={30}/><div style={{fontFamily:F.display,fontWeight:800,fontSize:20}}>MoodCast</div></div>
            <div style={{fontSize:14,color:INK2,lineHeight:1.5,marginBottom:14}}>This forecast is passcode-protected. Enter the passcode to take readings.</div>
            <input autoFocus type="password" value={passInput} onChange={e=>setPassInput(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")submitPass();}} placeholder="Passcode" style={{width:"100%",border:`1px solid ${LINE}`,borderRadius:10,padding:"10px 12px",fontSize:15,background:"#fff",color:INK}}/>
            <button onClick={submitPass} style={{...primary(!passInput.trim()),width:"100%",marginTop:12,display:"flex",justifyContent:"center"}}>Enter</button>
          </div>
        </div>
      )}
    </div>
  );

  function Row({ title, hint, children }){
    return (<div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:14}}>
      <div style={{flex:1}}><div style={{fontWeight:700,fontSize:14}}>{title}</div><div style={{fontSize:12,color:INK2,marginTop:2,lineHeight:1.4}}>{hint}</div></div>
      <div style={{flexShrink:0,paddingTop:2}}>{children}</div></div>);
  }
  function Headline({ it, small }){
    const aid=artId(it);
    return (<li style={{borderTop:`1px solid ${LINE}`,paddingTop:8,display:"flex",justifyContent:"space-between",gap:10}}>
      <div style={{minWidth:0}}><div style={{fontSize:small?12.5:13.5,lineHeight:1.35,fontWeight:500}}>{it.url?<a href={it.url} target="_blank" rel="noreferrer">{it.title}</a>:it.title}</div>
        {it.source&&<div style={{fontSize:11,color:"#9AA3AE",fontWeight:600,marginTop:3}}>{it.source}</div>}
        <div style={{display:"flex",alignItems:"center",gap:10,marginTop:7,flexWrap:"wrap"}}>
          <ArticleReact data={votes[aid]} mine={myVotes[aid]} onVote={(dir)=>handleVote(aid,dir,{title:it.title,source:it.source,url:it.url})}/>
          <button onClick={()=>setCommentsFor({id:aid,label:it.title.slice(0,60)})} style={{display:"inline-flex",alignItems:"center",gap:4,background:"transparent",border:"none",padding:0,cursor:"pointer",color:commentCounts[aid]?INK:INK2,fontSize:11.5,fontWeight:700}}>💬 {commentCounts[aid]||"Comment"}</button>
        </div></div>
      <div style={{fontFamily:F.display,fontWeight:800,fontSize:15,color:moodColor(toMood(it.score)),flexShrink:0}}>{toMood(it.score)}</div></li>);
  }
  function primary(disabled){ return {background:ACCENT,color:"#fff",borderRadius:12,padding:"10px 16px",fontSize:14,fontWeight:700,opacity:disabled?.5:1,cursor:disabled?"not-allowed":"pointer"}; }
}
function ctrlBtn(disabled){ return {background:CARD,border:`1px solid ${LINE}`,borderRadius:8,padding:"4px 9px",fontSize:13,fontWeight:700,color:INK,opacity:disabled?.4:1,cursor:disabled?"default":"pointer"}; }
const glassBtn={background:"rgba(255,255,255,.18)",color:"#fff",border:"1px solid rgba(255,255,255,.35)",borderRadius:12,padding:"9px 16px",fontSize:14,fontWeight:700,backdropFilter:"blur(4px)"};
const heroChip={display:"inline-flex",alignItems:"center",gap:7,background:"rgba(255,255,255,.16)",border:"1px solid rgba(255,255,255,.28)",borderRadius:999,padding:"4px 12px 4px 6px",fontSize:12.5,fontWeight:500,backdropFilter:"blur(3px)"};
const shareMini={display:"inline-flex",alignItems:"center",gap:6,background:"rgba(255,255,255,.16)",borderRadius:999,padding:"4px 11px 4px 6px",fontSize:12,fontWeight:600};
