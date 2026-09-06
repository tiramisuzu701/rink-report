/* Rink Report — app.js
   Render/compute logic, event handlers, and app bootstrap.
   Talks to Supabase through window.DB / window.loadState (js/db.js). */
"use strict";

var STATE = null;
var SESSION = null;
var SAVING = false;
var READONLY = true;

/* ---------- tiny utils ---------- */
function $(sel, root){ return (root||document).querySelector(sel); }
function $all(sel, root){ return Array.prototype.slice.call((root||document).querySelectorAll(sel)); }
function uid(prefix){ return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2,8); }
function newId(){
  if(window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c){
    var r = Math.random()*16|0, v = c==='x' ? r : (r&0x3|0x8);
    return v.toString(16);
  });
}
function clone(x){ return JSON.parse(JSON.stringify(x)); }
function esc(s){
  s = (s===undefined||s===null) ? '' : String(s);
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function fmtDate(iso, opts){
  if(!iso) return '';
  var d = new Date(iso + (iso.length<=10 ? 'T12:00:00' : ''));
  if(isNaN(d.getTime())) return iso;
  var o = opts || {month:'short', day:'numeric'};
  return d.toLocaleDateString('en-US', o);
}
function fmtDateFull(iso){ return fmtDate(iso, {weekday:'short', month:'short', day:'numeric', year:'numeric'}); }
function todayISO(){
  var d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}
function nowISO(){ return new Date().toISOString(); }
function pct(n){ return (n*100).toFixed(1) + '%'; }
function initials(name){
  var parts = (name||'').trim().split(/\s+/).filter(Boolean);
  if(parts.length===0) return '?';
  if(parts.length===1) return parts[0].slice(0,2).toUpperCase();
  return (parts[0][0]+parts[parts.length-1][0]).toUpperCase();
}
function textColorFor(hex){
  if(!hex) return '#fff';
  var h = hex.replace('#','');
  if(h.length===3) h = h.split('').map(function(c){return c+c;}).join('');
  var r=parseInt(h.slice(0,2),16), g=parseInt(h.slice(2,4),16), b=parseInt(h.slice(4,6),16);
  var lum = (0.299*r+0.587*g+0.114*b)/255;
  return lum > 0.62 ? '#10151C' : '#ffffff';
}

/* ---------- lookups ---------- */
function getCurrentSeason(){ return STATE.seasons.filter(function(s){return s.isCurrent;})[0] || STATE.seasons[STATE.seasons.length-1]; }
function seasonById(id){ return STATE.seasons.filter(function(s){return s.id===id;})[0]; }
function teamById(id){ return STATE.teams.filter(function(t){return t.id===id;})[0]; }
function playerById(id){ return STATE.players.filter(function(p){return p.id===id;})[0]; }
function activeTeams(){ return STATE.teams.filter(function(t){return t.active!==false;}); }
function teamPlayers(teamId, includeInactive){ return STATE.players.filter(function(p){return p.teamId===teamId && (includeInactive || p.active!==false);}); }
function gameById(id){ return STATE.games.filter(function(g){return g.id===id;})[0]; }
function divisionById(id){ return (STATE.divisions||[]).filter(function(d){return d.id===id;})[0]; }
function sortedDivisions(){ return (STATE.divisions||[]).slice().sort(function(a,b){return a.name.localeCompare(b.name);}); }

/* ---------- compute: standings ---------- */
function computeStandings(seasonId){
  var season = seasonById(seasonId);
  if(!season) return [];
  var rows = activeTeams().map(function(t){
    return {team:t, gp:0,w:0,l:0,otl:0,pts:0,gf:0,ga:0, hw:0,hl:0,hotl:0,hgp:0, aw:0,al:0,aotl:0,agp:0};
  });
  var byId = {}; rows.forEach(function(r){ byId[r.team.id] = r; });
  var games = STATE.games.filter(function(g){ return g.seasonId===seasonId && g.status==='final' && !g.isPlayoff; });
  games.forEach(function(g){
    var home = byId[g.homeTeamId], away = byId[g.awayTeamId];
    if(!home || !away) return;
    home.gp++; away.gp++; home.hgp++; away.agp++;
    home.gf += g.homeScore; home.ga += g.awayScore;
    away.gf += g.awayScore; away.ga += g.homeScore;
    if(g.homeScore > g.awayScore){
      home.w++; home.hw++; home.pts += season.pointsWin;
      if(g.result==='REG'){ away.l++; away.al++; away.pts += season.pointsLoss; }
      else { away.otl++; away.aotl++; away.pts += season.pointsOTL; }
    } else {
      away.w++; away.aw++; away.pts += season.pointsWin;
      if(g.result==='REG'){ home.l++; home.hl++; home.pts += season.pointsLoss; }
      else { home.otl++; home.hotl++; home.pts += season.pointsOTL; }
    }
  });
  rows.forEach(function(r){
    r.diff = r.gf - r.ga;
    r.ptsPct = r.gp>0 ? r.pts/(r.gp*season.pointsWin) : 0;
  });
  rows.sort(function(a,b){
    return b.pts-a.pts || b.ptsPct-a.ptsPct || b.diff-a.diff || b.gf-a.gf || a.team.name.localeCompare(b.team.name);
  });
  return rows;
}

/* ---------- compute: player stat totals ---------- */
function computePlayerStats(seasonId, opts){
  opts = opts || {};
  var finalIds = {};
  STATE.games.forEach(function(g){
    if(g.status!=='final') return;
    if(seasonId!=='all' && g.seasonId!==seasonId) return;
    if(!opts.includePlayoffs && g.isPlayoff) return;
    finalIds[g.id] = g;
  });
  var map = {};
  STATE.players.forEach(function(p){ map[p.id] = {player:p, gp:0, goals:0, assists:0, points:0, ga:0, goalieGp:0, gaa:0}; });
  STATE.gamePlayerStats.forEach(function(gs){
    if(!finalIds[gs.gameId]) return;
    var row = map[gs.playerId]; if(!row) return;
    if(gs.isGoalie){
      row.goalieGp++;
      row.ga += (gs.goalsAgainst||0);
    } else {
      row.gp++;
      row.goals += (gs.goals||0);
      row.assists += (gs.assists||0);
    }
    row.points = row.goals + row.assists;
    row.gaa = row.goalieGp>0 ? row.ga/row.goalieGp : 0;
  });
  return map;
}

/* ---------- compute: performing player (last up to 5 games, current season) ---------- */
function computePerformingPlayer(){
  var season = getCurrentSeason();
  var finalGames = STATE.games.filter(function(g){ return g.seasonId===season.id && g.status==='final' && !g.isPlayoff; })
    .sort(function(a,b){ return new Date(b.date)-new Date(a.date); });
  var order = {}; finalGames.forEach(function(g,i){ order[g.id]=i; });
  var byPlayer = {};
  STATE.gamePlayerStats.forEach(function(gs){
    if(gs.isGoalie) return;
    if(!(gs.gameId in order)) return;
    if(!byPlayer[gs.playerId]) byPlayer[gs.playerId] = [];
    byPlayer[gs.playerId].push({idx:order[gs.gameId], goals:gs.goals||0, assists:gs.assists||0});
  });
  var best = null;
  Object.keys(byPlayer).forEach(function(pid){
    var player = playerById(pid);
    if(!player || player.active===false) return;
    var entries = byPlayer[pid].sort(function(a,b){return a.idx-b.idx;}).slice(0,5);
    if(entries.length===0) return;
    var goals=0, assists=0;
    entries.forEach(function(e){ goals+=e.goals; assists+=e.assists; });
    var points = goals+assists, ppg = points/entries.length;
    var cand = {player:player, team:teamById(player.teamId), games:entries.length, goals:goals, assists:assists, points:points, ppg:ppg};
    if(!best || points>best.points || (points===best.points && ppg>best.ppg) || (points===best.points && ppg===best.ppg && goals>best.goals)){
      best = cand;
    }
  });
  return best;
}

/* ---------- compute: records ---------- */
function computeRecords(scope){ // scope = seasonId or 'all'
  var games = STATE.games.filter(function(g){ return g.status==='final' && (scope==='all' || g.seasonId===scope); });
  var gset = {}; games.forEach(function(g){ gset[g.id]=g; });
  var bestGoals=null, bestAssists=null, bestPoints=null;
  var totals = {};
  STATE.gamePlayerStats.forEach(function(gs){
    var g = gset[gs.gameId]; if(!g || gs.isGoalie) return;
    var player = playerById(gs.playerId); if(!player) return;
    var goals = gs.goals||0, assists = gs.assists||0, pts = goals+assists;
    if(!bestGoals || goals>bestGoals.goals) bestGoals = {player:player, goals:goals, game:g};
    if(!bestAssists || assists>bestAssists.assists) bestAssists = {player:player, assists:assists, game:g};
    if(!bestPoints || pts>bestPoints.points) bestPoints = {player:player, points:pts, goals:goals, assists:assists, game:g};
    if(!totals[gs.playerId]) totals[gs.playerId] = {player:player, goals:0, assists:0, points:0, gp:0};
    totals[gs.playerId].goals += goals;
    totals[gs.playerId].assists += assists;
    totals[gs.playerId].points += pts;
    totals[gs.playerId].gp++;
  });
  var leaders = Object.keys(totals).map(function(k){return totals[k];})
    .sort(function(a,b){ return b.points-a.points || b.goals-a.goals; }).slice(0,10);
  var bestGoalieGame=null;
  STATE.gamePlayerStats.forEach(function(gs){
    var g = gset[gs.gameId]; if(!g || !gs.isGoalie) return;
    var player = playerById(gs.playerId); if(!player) return;
    if(bestGoalieGame===null || gs.goalsAgainst < bestGoalieGame.ga){
      bestGoalieGame = {player:player, ga:gs.goalsAgainst||0, game:g};
    }
  });
  var biggestMargin=null, mostTeamGoals=null;
  games.forEach(function(g){
    var margin = Math.abs(g.homeScore-g.awayScore);
    var winner = g.homeScore>g.awayScore ? teamById(g.homeTeamId) : teamById(g.awayTeamId);
    var loser = g.homeScore>g.awayScore ? teamById(g.awayTeamId) : teamById(g.homeTeamId);
    if(!biggestMargin || margin>biggestMargin.margin) biggestMargin = {margin:margin, winner:winner, loser:loser, game:g};
    [[g.homeTeamId,g.homeScore],[g.awayTeamId,g.awayScore]].forEach(function(pair){
      var t = teamById(pair[0]);
      if(!t) return;
      if(!mostTeamGoals || pair[1]>mostTeamGoals.goals) mostTeamGoals = {team:t, goals:pair[1], game:g};
    });
  });
  var chron = games.slice().sort(function(a,b){ return new Date(a.date)-new Date(b.date); });
  var streaks = {};
  chron.forEach(function(g){
    var homeWin = g.homeScore>g.awayScore;
    [ [g.homeTeamId, homeWin], [g.awayTeamId, !homeWin] ].forEach(function(pair){
      var tid=pair[0], won=pair[1];
      if(!streaks[tid]) streaks[tid] = {cur:0, max:0};
      if(won){ streaks[tid].cur++; streaks[tid].max = Math.max(streaks[tid].max, streaks[tid].cur); }
      else streaks[tid].cur = 0;
    });
  });
  var longestStreak = null;
  Object.keys(streaks).forEach(function(tid){
    if(!longestStreak || streaks[tid].max>longestStreak.streak) longestStreak = {team:teamById(tid), streak:streaks[tid].max};
  });
  return {bestGoals:bestGoals, bestAssists:bestAssists, bestPoints:bestPoints, bestGoalieGame:bestGoalieGame,
    leaders:leaders, biggestMargin:biggestMargin, mostTeamGoals:mostTeamGoals, longestStreak:longestStreak};
}

/* ---------- compute: team record (W-L-OTL, home/away) from standings row ---------- */
function findStandingsRow(seasonId, teamId){
  var rows = computeStandings(seasonId);
  for(var i=0;i<rows.length;i++) if(rows[i].team.id===teamId) return rows[i];
  return null;
}

/* ---------- playoffs ---------- */
function playoffsForSeason(seasonId){ return STATE.playoffs.filter(function(p){return p.seasonId===seasonId;})[0]; }
function seriesById(sid){
  var bracket = STATE.playoffs.filter(function(p){ return p.series.some(function(s){return s.id===sid;}); })[0];
  if(!bracket) return null;
  return bracket.series.filter(function(s){return s.id===sid;})[0];
}
function generateBracket(seasonId, seedCount, bestOf){
  var standings = computeStandings(seasonId).slice(0, seedCount);
  var seeds = standings.map(function(r,i){ return {seed:i+1, teamId:r.team.id}; });
  var rounds = Math.log2(seedCount);
  var allSeries = [];
  var round1 = [];
  for(var i=0;i<seedCount/2;i++){
    var a = seeds[i], b = seeds[seedCount-1-i];
    round1.push({id:newId(), round:1, matchNumber:i+1, seedA:a.seed, seedB:b.seed,
      teamAId:a.teamId, teamBId:b.teamId, bestOf:bestOf, winsA:0, winsB:0, winnerId:null,
      status:'pending', nextSeriesId:null, nextSeriesSlot:null});
  }
  allSeries = allSeries.concat(round1);
  var prev = round1;
  for(var r=2;r<=rounds;r++){
    var roundSeries = [];
    for(var j=0;j<prev.length/2;j++){
      var s = {id:newId(), round:r, matchNumber:j+1, seedA:null, seedB:null,
        teamAId:null, teamBId:null, bestOf:bestOf, winsA:0, winsB:0, winnerId:null,
        status:'pending', nextSeriesId:null, nextSeriesSlot:null};
      roundSeries.push(s);
      prev[j*2].nextSeriesId = s.id; prev[j*2].nextSeriesSlot = 'A';
      prev[j*2+1].nextSeriesId = s.id; prev[j*2+1].nextSeriesSlot = 'B';
    }
    allSeries = allSeries.concat(roundSeries);
    prev = roundSeries;
  }
  return {id:newId(), seasonId:seasonId, seedCount:seedCount, bestOf:bestOf, createdAt:nowISO(), champion:null, series:allSeries};
}
function roundName(round, totalRounds){
  var fromEnd = totalRounds - round;
  if(fromEnd===0) return 'Final';
  if(fromEnd===1) return 'Semifinals';
  if(fromEnd===2) return 'Quarterfinals';
  return 'Round ' + round;
}
/* apply a completed game's result to its playoff series (mutates bracket in place) */
function applyGameToSeries(bracket, series, game){
  var homeIsA = game.homeTeamId===series.teamAId;
  var homeWon = game.homeScore > game.awayScore;
  var aWon = homeIsA ? homeWon : !homeWon;
  if(aWon) series.winsA++; else series.winsB++;
  var need = Math.ceil(series.bestOf/2);
  if(series.winsA>=need || series.winsB>=need){
    series.status = 'completed';
    series.winnerId = series.winsA>=need ? series.teamAId : series.teamBId;
    if(series.nextSeriesId){
      var next = bracket.series.filter(function(s){return s.id===series.nextSeriesId;})[0];
      if(next){
        if(series.nextSeriesSlot==='A') next.teamAId = series.winnerId; else next.teamBId = series.winnerId;
      }
    } else {
      bracket.champion = series.winnerId;
    }
  } else {
    series.status = 'in_progress';
  }
}

/* ================= RENDER HELPERS ================= */
function teamBadgeHTML(team, size){
  if(!team) return '<div class="team-badge ' + (size||'') + '" style="background:var(--surface-2);color:var(--ink-faint)">?</div>';
  var color = team.colorPrimary || '#1D5D8C';
  var txt = textColorFor(color);
  return '<div class="team-badge ' + (size||'') + '" style="background:' + esc(color) + ';color:' + txt + '">' + esc(team.abbr || initials(team.name)) + '</div>';
}
function teamLinkHTML(team, opts){
  opts = opts || {};
  if(!team) return '<span class="subtle">TBD</span>';
  return '<a class="team-link" href="#/team/' + team.id + '">' + teamBadgeHTML(team, opts.size) +
    '<span class="team-name">' + esc(opts.short ? (team.shortName||team.name) : team.name) + '</span></a>';
}
function resultChip(status){
  if(status==='final') return '';
  return '<span class="chip scheduled">Scheduled</span>';
}
function gameRowHTML(g, opts){
  opts = opts || {};
  var home = teamById(g.homeTeamId), away = teamById(g.awayTeamId);
  var scoreHTML;
  if(g.status==='final'){
    var homeWin = g.homeScore>g.awayScore;
    scoreHTML = '<span class="score" style="' + (homeWin?'color:var(--ink)':'color:var(--ink-soft)') + '">' + g.homeScore + '</span>' +
      '<span class="vs">&ndash;</span>' +
      '<span class="score" style="' + (!homeWin?'color:var(--ink)':'color:var(--ink-soft)') + '">' + g.awayScore + '</span>' +
      (g.result!=='REG' ? '<span class="chip otl" style="margin-left:6px">' + (g.result==='OT'?'OT':'SO') + '</span>' : '');
  } else {
    scoreHTML = '<span class="chip scheduled">' + fmtDate(g.date) + '</span>';
  }
  return '<div class="list-row">' +
    '<div class="matchup">' + teamLinkHTML(away, {size:'sm', short:true}) + '<span class="vs">@</span>' + teamLinkHTML(home, {size:'sm', short:true}) + '</div>' +
    (opts.showDate!==false ? '<div class="game-date">' + fmtDate(g.date) + '</div>' : '') +
    '<div>' + scoreHTML + '</div>' +
  '</div>';
}
function newsPostHTML(n){
  var typeLabel = n.type==='trade' ? 'Trade' : (n.type==='announcement' ? 'Announcement' : 'News');
  return '<article class="news-post">' +
    '<div class="news-meta"><span class="chip ' + esc(n.type) + '">' + typeLabel + '</span><span>' + fmtDateFull(n.date) + '</span></div>' +
    '<h3>' + esc(n.title) + '</h3>' +
    (n.body ? '<div class="news-body">' + esc(n.body) + '</div>' : '') +
  '</article>';
}
function emptyState(big, small, actionHTML){
  return '<div class="empty"><div class="big">' + esc(big) + '</div><div>' + esc(small) + '</div>' + (actionHTML||'') + '</div>';
}
function pageHead(eyebrow, title){
  return '<div class="page-head"><div><div class="eyebrow">' + esc(eyebrow) + '</div><h1>' + esc(title) + '</h1></div></div><div class="rule"></div>';
}

/* ================= NAV / SHELL ================= */
var ROUTES = [
  {path:'', label:'Home'},
  {path:'standings', label:'Standings'},
  {path:'players', label:'Players'},
  {path:'playoffs', label:'Playoffs'},
  {path:'records', label:'Records'},
  {path:'news', label:'News'},
  {path:'log', label:'Log Game', admin:true},
  {path:'manage', label:'Management', admin:true}
];
function currentRoute(){
  var h = location.hash.replace(/^#\/?/, '');
  return h || '';
}
function navHTML(){
  var route = currentRoute();
  var top = route.split('/')[0];
  return ROUTES.map(function(r){
    if(r.admin && READONLY) return '';
    var active = (top===r.path);
    return '<a class="' + (active?'active ':'') + (r.admin?'admin-link ':'') + '" href="#/' + r.path + '">' + esc(r.label) + '</a>';
  }).join('');
}
function themeIcon(){
  if(effectiveTheme()==='dark'){
    return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"></path></svg>';
  }
  return '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 1020.354 15.354z"></path></svg>';
}
var authPanelOpen = false;
var authMode = 'signin';
var authError = '';
function authFormHTML(){
  return '<div class="card" style="position:absolute;top:44px;right:0;width:280px;z-index:50;padding:16px" data-auth-panel>' +
    '<div class="tabbar" style="margin-bottom:12px">' +
      '<button type="button" class="tab-btn ' + (authMode==='signin'?'active':'') + '" data-authmode="signin">Sign In</button>' +
      '<button type="button" class="tab-btn ' + (authMode==='signup'?'active':'') + '" data-authmode="signup">Sign Up</button>' +
    '</div>' +
    '<form data-form="' + (authMode==='signin'?'signIn':'signUp') + '" class="stack" style="gap:10px">' +
      '<div class="field"><label>Email</label><input type="email" name="email" required autocomplete="username"></div>' +
      '<div class="field"><label>Password</label><input type="password" name="password" required autocomplete="' + (authMode==='signin'?'current-password':'new-password') + '" minlength="6"></div>' +
      (authError ? '<div style="color:var(--loss);font-size:12px">' + esc(authError) + '</div>' : '') +
      '<button class="btn primary sm" type="submit">' + (authMode==='signin'?'Sign in':'Create account') + '</button>' +
    '</form>' +
    (authMode==='signup' ? '<p class="subtle" style="font-size:11px;margin-top:8px">Only allow-listed emails can manage the site — signing up with any other address creates a view-only account.</p>' : '') +
  '</div>';
}
function headerActionsHTML(){
  var themeBtn = '<button class="icon-btn" id="theme-toggle" title="Toggle theme" aria-label="Toggle color theme">' + themeIcon() + '</button>';
  if(SESSION){
    return '<div class="header-actions">' +
      '<span class="chip general" title="Signed in as ' + esc(SESSION.user.email) + '">' + esc(SESSION.user.email) + '</span>' +
      '<button class="btn sm" data-action="sign-out">Sign out</button>' +
      themeBtn +
    '</div>';
  }
  return '<div class="header-actions" style="position:relative">' +
    '<button class="btn sm" data-action="toggle-auth-panel">Admin sign in</button>' +
    themeBtn +
    (authPanelOpen ? authFormHTML() : '') +
  '</div>';
}
function shellHTML(bodyHTML){
  var season = getCurrentSeason();
  return (
  '<header class="site-header"><div class="container">' +
    '<div class="header-top">' +
      '<a class="brand" href="#/">' +
        '<div class="brand-mark">' + esc((STATE.settings.leagueName||'RL').split(/\s+/).map(function(w){return w[0];}).slice(0,2).join('').toUpperCase()) + '</div>' +
        '<div><div class="brand-name">' + esc(STATE.settings.leagueName||'Rink Report') + '</div>' +
        '<span class="brand-tag">' + esc(season ? season.name : '') + (STATE.settings.tagline ? ' &middot; ' + esc(STATE.settings.tagline) : '') + '</span></div>' +
      '</a>' +
      headerActionsHTML() +
    '</div>' +
    '<nav class="tabs">' + navHTML() + '</nav>' +
  '</div></header>' +
  '<main class="container">' + bodyHTML + '</main>' +
  '<footer class="site-footer"><div class="container">' + esc(STATE.settings.leagueName||'Rink Report') + '</div></footer>' +
  '<div class="toast" id="toast"></div>'
  );
}

/* ================= PAGE: HOME ================= */
function renderHome(){
  var season = getCurrentSeason();
  var pp = computePerformingPlayer();
  var standings = computeStandings(season.id).slice(0,5);
  var upcoming = STATE.games.filter(function(g){ return g.seasonId===season.id && g.status==='scheduled'; })
    .sort(function(a,b){ return new Date(a.date)-new Date(b.date); }).slice(0,5);
  var news = STATE.news.slice().sort(function(a,b){ return new Date(b.date)-new Date(a.date); }).slice(0,3);
  var pstats = computePlayerStats(season.id);
  var topScorers = Object.keys(pstats).map(function(k){return pstats[k];})
    .filter(function(r){ return r.gp>0 && r.player.active!==false; })
    .sort(function(a,b){ return b.points-a.points || b.goals-a.goals; }).slice(0,5);

  var spotlight = pp ?
    '<div class="spotlight">' +
      '<div class="spotlight-badge">' + esc(initials(pp.player.name)) + '</div>' +
      '<div>' +
        '<div class="eyebrow">Performing Player &middot; last ' + pp.games + ' game' + (pp.games===1?'':'s') + '</div>' +
        '<h3>' + esc(pp.player.name) + '</h3>' +
        '<div class="subtle">' + (pp.team?esc(pp.team.name):'') + (pp.player.position?' &middot; ' + posLabel(pp.player.position):'') + '</div>' +
        '<div class="stat-row">' +
          '<div class="stat-chip"><span class="v">' + pp.points + '</span><span class="k">Points</span></div>' +
          '<div class="stat-chip"><span class="v">' + pp.goals + '</span><span class="k">Goals</span></div>' +
          '<div class="stat-chip"><span class="v">' + pp.assists + '</span><span class="k">Assists</span></div>' +
          '<div class="stat-chip"><span class="v">' + pp.ppg.toFixed(2) + '</span><span class="k">Pts/Gm</span></div>' +
        '</div>' +
      '</div>' +
    '</div>'
    : emptyState('No performing player yet', 'Log a few games to surface a standout skater here.');

  var standingsSnap = standings.length ?
    '<div class="table-wrap"><table><thead><tr><th></th><th>Team</th><th>GP</th><th>PTS</th><th>DIFF</th></tr></thead><tbody>' +
    standings.map(function(r,i){
      return '<tr class="clickable" onclick="location.hash=\'#/team/' + r.team.id + '\'">' +
        '<td class="rank">' + (i+1) + '</td>' +
        '<td>' + teamLinkHTML(r.team, {size:'sm'}) + '</td>' +
        '<td class="tnum">' + r.gp + '</td>' +
        '<td class="pts"><strong>' + r.pts + '</strong></td>' +
        '<td class="tnum ' + (r.diff>0?'diff-pos':r.diff<0?'diff-neg':'') + '">' + (r.diff>0?'+':'') + r.diff + '</td>' +
      '</tr>';
    }).join('') + '</tbody></table></div>'
    : emptyState('No standings yet', 'Add teams and log games to populate the table.');

  var scorersSnap = topScorers.length ?
    '<div class="table-wrap"><table><thead><tr><th></th><th>Player</th><th>GP</th><th>G</th><th>A</th><th>PTS</th></tr></thead><tbody>' +
    topScorers.map(function(r,i){
      return '<tr class="clickable" onclick="location.hash=\'#/team/' + (r.player.teamId||'') + '\'">' +
        '<td class="rank">' + (i+1) + '</td>' +
        '<td>' + esc(r.player.name) + '</td>' +
        '<td class="tnum">' + r.gp + '</td><td class="tnum">' + r.goals + '</td><td class="tnum">' + r.assists + '</td>' +
        '<td class="pts"><strong>' + r.points + '</strong></td>' +
      '</tr>';
    }).join('') + '</tbody></table></div>'
    : emptyState('No stats yet', 'Player leaders will show up once games are logged.');

  var upcomingHTML = upcoming.length ?
    '<div class="list">' + upcoming.map(function(g){ return gameRowHTML(g); }).join('') + '</div>'
    : emptyState('Nothing on the schedule', 'Add an upcoming match from Log Game → Schedule.');

  var newsHTML = news.length ?
    '<div class="list">' + news.map(function(n){ return newsPostHTML(n); }).join('') + '</div>'
    : emptyState('No news yet', 'Posts you publish will show up here.');

  return (
    '<div class="stack">' +
      '<div class="card">' + spotlight + '</div>' +
      '<div class="grid-2">' +
        '<div class="stack">' +
          '<div class="card"><div class="card-head"><h2>Standings</h2><a class="link-more" href="#/standings">Full table &rarr;</a></div>' + standingsSnap + '</div>' +
          '<div class="card"><div class="card-head"><h2>Points Leaders</h2><a class="link-more" href="#/players">All players &rarr;</a></div>' + scorersSnap + '</div>' +
        '</div>' +
        '<div class="stack">' +
          '<div class="card"><div class="card-head"><h2>Upcoming Matches</h2></div>' + upcomingHTML + '</div>' +
          '<div class="card"><div class="card-head"><h2>Recent News</h2><a class="link-more" href="#/news">All news &rarr;</a></div>' + newsHTML + '</div>' +
        '</div>' +
      '</div>' +
    '</div>'
  );
}
function posLabel(p){ return p==='G'?'Goalie':(p==='D'?'Defense':'Forward'); }

/* ================= PAGE: STANDINGS ================= */
var standingsView = 'league'; // 'league' | 'division'
function standingsRowHTML(r, rank){
  return '<tr class="clickable" onclick="location.hash=\'#/team/' + r.team.id + '\'">' +
    '<td class="rank">' + rank + '</td>' +
    '<td>' + teamLinkHTML(r.team) + '</td>' +
    '<td class="tnum">' + r.gp + '</td>' +
    '<td class="tnum">' + r.w + '</td>' +
    '<td class="tnum">' + r.l + '</td>' +
    '<td class="tnum">' + r.otl + '</td>' +
    '<td class="pts"><strong>' + r.pts + '</strong></td>' +
    '<td class="tnum">' + pct(r.ptsPct) + '</td>' +
    '<td class="tnum">' + r.gf + '</td>' +
    '<td class="tnum">' + r.ga + '</td>' +
    '<td class="tnum ' + (r.diff>0?'diff-pos':r.diff<0?'diff-neg':'') + '">' + (r.diff>0?'+':'') + r.diff + '</td>' +
    '<td class="tnum">' + r.hw + '-' + r.hl + '-' + r.hotl + '</td>' +
    '<td class="tnum">' + r.aw + '-' + r.al + '-' + r.aotl + '</td>' +
  '</tr>';
}
function cutoffRowHTML(cutoff, total){
  return '<tr class="cutoff-row"><td colspan="13"><span>Playoff Cutoff &middot; top ' + cutoff + ' of ' + total + ' advance</span></td></tr>';
}
function standingsTableHTML(rows, cutoff){
  var body = rows.map(function(r,i){
    var html = standingsRowHTML(r, i+1);
    if(cutoff && cutoff>0 && cutoff<rows.length && (i+1)===cutoff) html += cutoffRowHTML(cutoff, rows.length);
    return html;
  }).join('');
  return '<div class="table-wrap"><table><thead><tr>' +
    '<th></th><th>Team</th><th>GP</th><th>W</th><th>L</th><th>OTL</th><th>PTS</th><th>PTS%</th><th>GF</th><th>GA</th><th>DIFF</th><th>Home</th><th>Away</th>' +
    '</tr></thead><tbody>' + body + '</tbody></table></div>';
}
function renderStandings(){
  var season = getCurrentSeason();
  var rows = computeStandings(season.id);
  if(!rows.length){
    return pageHead('Season Standings', season.name) + '<div class="card">' + emptyState('No teams yet', 'Add teams from the Management tab to get started.') + '</div>';
  }
  var divisions = sortedDivisions();
  var viewToggle = divisions.length ? (
    '<div class="tabbar">' +
      '<button class="tab-btn ' + (standingsView==='league'?'active':'') + '" data-standingsview="league">Full League</button>' +
      '<button class="tab-btn ' + (standingsView==='division'?'active':'') + '" data-standingsview="division">Divisional</button>' +
    '</div>'
  ) : '';
  var body;
  if(divisions.length && standingsView==='division'){
    var groups = divisions.map(function(d){
      var dRows = rows.filter(function(r){ return r.team.divisionId===d.id; });
      if(!dRows.length) return '';
      return '<div class="card" style="margin-bottom:16px"><div class="card-head"><h2>' + esc(d.name) + '</h2></div>' +
        standingsTableHTML(dRows, d.playoffCutoff) + '</div>';
    }).join('');
    var unassigned = rows.filter(function(r){ return !r.team.divisionId; });
    var unassignedHTML = unassigned.length ?
      '<div class="card" style="margin-bottom:16px"><div class="card-head"><h2>Unassigned</h2></div>' + standingsTableHTML(unassigned, null) + '</div>' : '';
    body = groups + unassignedHTML;
  } else {
    body = '<div class="card">' + standingsTableHTML(rows, null) + '</div>';
  }
  return pageHead('Season Standings', season.name) + viewToggle + body +
    '<p class="subtle" style="margin-top:12px;font-size:12.5px">PTS% = points earned &divide; points possible. Click a team to open its page.</p>';
}

/* ================= PAGE: TEAM ================= */
function renderTeam(teamId){
  var team = teamById(teamId);
  if(!team) return pageHead('Team', 'Not found') + '<div class="card">' + emptyState('Team not found', 'It may have been removed.') + '</div>';
  var season = getCurrentSeason();
  var row = findStandingsRow(season.id, teamId);
  var roster = teamPlayers(teamId).sort(function(a,b){ return (a.position==='G'?1:0)-(b.position==='G'?1:0) || a.name.localeCompare(b.name); });
  var pstats = computePlayerStats(season.id);
  var games = STATE.games.filter(function(g){ return g.seasonId===season.id && !g.isPlayoff && (g.homeTeamId===teamId || g.awayTeamId===teamId); })
    .sort(function(a,b){ return new Date(b.date)-new Date(a.date); });
  var results = games.filter(function(g){return g.status==='final';});
  var upcoming = games.filter(function(g){return g.status==='scheduled';}).sort(function(a,b){return new Date(a.date)-new Date(b.date);});

  var kpis = row ? (
    '<div class="kpi-row">' +
      '<div class="kpi"><div class="v">' + row.pts + '</div><div class="k">Points</div></div>' +
      '<div class="kpi"><div class="v">' + row.w + '-' + row.l + '-' + row.otl + '</div><div class="k">Record</div></div>' +
      '<div class="kpi"><div class="v">' + pct(row.ptsPct) + '</div><div class="k">PTS%</div></div>' +
      '<div class="kpi"><div class="v ' + (row.diff>0?'diff-pos':row.diff<0?'diff-neg':'') + '">' + (row.diff>0?'+':'') + row.diff + '</div><div class="k">Goal Diff</div></div>' +
    '</div>'
  ) : '';

  var rosterHTML = roster.length ? '<div class="roster-grid">' + roster.map(function(p){
    var s = pstats[p.id] || {gp:0,goals:0,assists:0,points:0,ga:0,goalieGp:0,gaa:0};
    var statsHTML = p.position==='G'
      ? '<div class="pstats"><div><div class="v">' + s.goalieGp + '</div><div class="k">GP</div></div><div><div class="v">' + s.ga + '</div><div class="k">GA</div></div><div><div class="v">' + s.gaa.toFixed(2) + '</div><div class="k">GAA</div></div></div>'
      : '<div class="pstats"><div><div class="v">' + s.gp + '</div><div class="k">GP</div></div><div><div class="v">' + s.goals + '</div><div class="k">G</div></div><div><div class="v">' + s.assists + '</div><div class="k">A</div></div><div><div class="v">' + s.points + '</div><div class="k">PTS</div></div></div>';
    return '<div class="player-card"><div class="pname">' + esc(p.name) + (p.jersey?' <span class="subtle tnum">#' + esc(p.jersey) + '</span>':'') + '</div>' +
      '<div class="pmeta">' + posLabel(p.position) + (p.active===false?' &middot; Inactive':'') + '</div>' + statsHTML + '</div>';
  }).join('') + '</div>' : emptyState('No players yet', 'Add players to this team from Management.');

  var resultsHTML = results.length ? '<div class="list">' + results.map(function(g){ return gameRowHTML(g); }).join('') + '</div>' : emptyState('No games played yet', '');
  var upcomingHTML = upcoming.length ? '<div class="list">' + upcoming.map(function(g){ return gameRowHTML(g); }).join('') + '</div>' : '';

  var teamDivision = team.divisionId ? divisionById(team.divisionId) : null;
  return (
    '<div class="page-head">' +
      '<div style="display:flex;align-items:center;gap:14px">' + teamBadgeHTML(team,'lg') +
        '<div><div class="eyebrow">Team' + (teamDivision?' &middot; ' + esc(teamDivision.name):'') + '</div><h1>' + esc(team.name) + '</h1></div></div>' +
    '</div><div class="rule"></div>' +
    kpis +
    '<div class="grid-2">' +
      '<div class="stack">' +
        '<div class="card"><div class="card-head"><h2>Roster</h2></div><div class="card-pad">' + rosterHTML + '</div></div>' +
      '</div>' +
      '<div class="stack">' +
        (upcoming.length ? '<div class="card"><div class="card-head"><h2>Upcoming</h2></div>' + upcomingHTML + '</div>' : '') +
        '<div class="card"><div class="card-head"><h2>Results</h2></div>' + resultsHTML + '</div>' +
      '</div>' +
    '</div>'
  );
}

/* ================= PAGE: PLAYERS ================= */
function renderPlayers(){
  var season = getCurrentSeason();
  var pstats = computePlayerStats(season.id);
  var teams = activeTeams().slice().sort(function(a,b){return a.name.localeCompare(b.name);});
  if(!teams.length) return pageHead('Rosters & Stats', 'Players') + '<div class="card">' + emptyState('No teams yet', 'Add teams and players from Management.') + '</div>';
  var body = teams.map(function(t){
    var roster = teamPlayers(t.id).slice().sort(function(a,b){
      var sa = pstats[a.id]||{points:0}, sb = pstats[b.id]||{points:0};
      return (sb.points||0)-(sa.points||0) || a.name.localeCompare(b.name);
    });
    var rowsHTML = roster.length ? roster.map(function(p){
      var s = pstats[p.id] || {gp:0,goals:0,assists:0,points:0,ga:0,goalieGp:0,gaa:0};
      if(p.position==='G'){
        return '<tr class="clickable" onclick="location.hash=\'#/team/' + t.id + '\'"><td>' + esc(p.name) + '</td><td>Goalie</td>' +
          '<td class="tnum">' + s.goalieGp + '</td><td class="tnum">&mdash;</td><td class="tnum">&mdash;</td><td class="tnum">&mdash;</td><td class="tnum">' + s.ga + '</td><td class="tnum">' + s.gaa.toFixed(2) + '</td></tr>';
      }
      return '<tr class="clickable" onclick="location.hash=\'#/team/' + t.id + '\'"><td>' + esc(p.name) + '</td><td>' + posLabel(p.position) + '</td>' +
        '<td class="tnum">' + s.gp + '</td><td class="tnum">' + s.goals + '</td><td class="tnum">' + s.assists + '</td><td class="pts"><strong>' + s.points + '</strong></td><td class="tnum">&mdash;</td><td class="tnum">&mdash;</td></tr>';
    }).join('') : '<tr><td colspan="8" class="subtle" style="text-align:left">No players on this roster yet.</td></tr>';
    return '<div class="card" style="margin-bottom:16px">' +
      '<div class="card-head"><h2 style="display:flex;align-items:center;gap:8px">' + teamBadgeHTML(t,'sm') + esc(t.name) + '</h2></div>' +
      '<div class="table-wrap"><table><thead><tr><th>Player</th><th>Pos</th><th>GP</th><th>G</th><th>A</th><th>PTS</th><th>GA</th><th>GAA</th></tr></thead><tbody>' + rowsHTML + '</tbody></table></div>' +
    '</div>';
  }).join('');
  return pageHead('Rosters & Stats', 'Players') + body;
}

/* ================= PAGE: PLAYOFFS ================= */
function renderPlayoffs(){
  var season = getCurrentSeason();
  var bracket = playoffsForSeason(season.id);
  var head = pageHead('Postseason', 'Playoffs');
  if(!bracket){
    var eligible = activeTeams().length;
    var genForm = !READONLY ? (
      '<form data-form="genBracket" class="card-pad" style="max-width:460px">' +
        '<div class="field-row">' +
          '<div class="field"><label for="pf-seeds">Playoff teams</label><select id="pf-seeds" name="seeds">' +
            [2,4,8,16].filter(function(n){return n<=eligible;}).map(function(n){return '<option value="' + n + '">' + n + ' teams</option>';}).join('') +
          '</select></div>' +
          '<div class="field"><label for="pf-bestof">Series length</label><select id="pf-bestof" name="bestOf">' +
            '<option value="1">Single game</option><option value="3">Best of 3</option><option value="5" selected>Best of 5</option><option value="7">Best of 7</option>' +
          '</select></div>' +
        '</div>' +
        '<div class="form-actions"><button class="btn primary" type="submit">Generate bracket from standings</button></div>' +
      '</form>'
    ) : '';
    var msg = eligible<2 ? 'Add at least two teams before generating a bracket.' : 'Seed the bracket from the current regular-season standings whenever you\'re ready.';
    return head + '<div class="card">' + emptyState('Playoffs haven\'t started', msg) + genForm + '</div>';
  }
  var totalRounds = Math.log2(bracket.seedCount);
  var rounds = [];
  for(var r=1;r<=totalRounds;r++) rounds.push(bracket.series.filter(function(s){return s.round===r;}));
  var champ = bracket.champion ? teamById(bracket.champion) : null;
  var bracketHTML = '<div class="bracket">' + rounds.map(function(list, idx){
    return '<div class="bracket-round"><h4>' + esc(roundName(idx+1, totalRounds)) + '</h4>' +
      list.map(function(s){ return seriesCardHTML(s, bracket); }).join('') +
    '</div>';
  }).join('') + '</div>';
  var champHTML = champ ? '<div class="banner" style="background:var(--gold-soft);color:var(--gold)">&#127942; ' + esc(champ.name) + ' win the ' + esc(season.name) + ' championship!</div>' : '';
  var resetHTML = !READONLY ? '<div class="form-actions" style="padding:0 18px 18px"><button class="btn danger sm" data-action="reset-bracket">Reset bracket</button></div>' : '';
  return head + champHTML + '<div class="card"><div class="card-head"><h2>' + esc(bracket.seedCount) + '-Team Bracket &middot; Best of ' + bracket.bestOf + '</h2></div><div class="card-pad">' + bracketHTML + '</div>' + resetHTML + '</div>';
}
function seriesCardHTML(s, bracket){
  var a = s.teamAId ? teamById(s.teamAId) : null;
  var b = s.teamBId ? teamById(s.teamBId) : null;
  function side(team, seed, wins, isWinner){
    if(!team) return '<div class="series-side"><span class="subtle">TBD</span></div>';
    return '<div class="series-side ' + (isWinner?'winner':'') + '">' +
      '<span style="display:flex;align-items:center;gap:7px">' + (seed?'<span class="subtle tnum" style="font-size:11px">' + seed + '</span>':'') + teamLinkHTML(team,{size:'sm',short:true}) + '</span>' +
      '<span class="sw tnum">' + wins + '</span>' +
    '</div>';
  }
  return '<div class="series-card">' +
    side(a, s.seedA, s.winsA, s.winnerId===s.teamAId) +
    side(b, s.seedB, s.winsB, s.winnerId===s.teamBId) +
  '</div>';
}

/* ================= PAGE: RECORDS ================= */
function renderRecords(){
  var season = getCurrentSeason();
  return pageHead('League History', 'Records') +
    '<div class="tabbar">' +
      '<button class="tab-btn active" data-tab="season">This Season</button>' +
      '<button class="tab-btn" data-tab="all">All-Time</button>' +
    '</div>' +
    '<div id="records-body">' + recordsBodyHTML(season.id) + '</div>';
}
function recordsBodyHTML(scope){
  var rec = computeRecords(scope);
  function rc(kicker, value, who, sub){
    if(!value && value!==0) return '';
    return '<div class="record-card"><div class="rv">' + value + '</div><div><div class="rk">' + esc(kicker) + '</div><div class="rwho">' + esc(who) + '</div>' + (sub?'<div class="subtle" style="font-size:11.5px">' + esc(sub) + '</div>':'') + '</div></div>';
  }
  var cards = [];
  if(rec.bestPoints) cards.push(rc('Most Points, Game', rec.bestPoints.points, rec.bestPoints.player.name, rec.bestPoints.goals+'G ' + rec.bestPoints.assists+'A &middot; ' + fmtDate(rec.bestPoints.game.date)));
  if(rec.bestGoals) cards.push(rc('Most Goals, Game', rec.bestGoals.goals, rec.bestGoals.player.name, fmtDate(rec.bestGoals.game.date)));
  if(rec.bestAssists) cards.push(rc('Most Assists, Game', rec.bestAssists.assists, rec.bestAssists.player.name, fmtDate(rec.bestAssists.game.date)));
  if(rec.mostTeamGoals) cards.push(rc('Most Goals, Team Game', rec.mostTeamGoals.goals, rec.mostTeamGoals.team.name, fmtDate(rec.mostTeamGoals.game.date)));
  if(rec.biggestMargin) cards.push(rc('Largest Margin', rec.biggestMargin.margin, rec.biggestMargin.winner.name + ' over ' + rec.biggestMargin.loser.name, fmtDate(rec.biggestMargin.game.date)));
  if(rec.longestStreak && rec.longestStreak.streak>0) cards.push(rc('Longest Win Streak', rec.longestStreak.streak, rec.longestStreak.team.name, 'games'));
  if(rec.bestGoalieGame) cards.push(rc('Best Goaltending, Game', rec.bestGoalieGame.ga, rec.bestGoalieGame.player.name, rec.bestGoalieGame.ga + ' goals against &middot; ' + fmtDate(rec.bestGoalieGame.game.date)));
  var cardsHTML = cards.length ? '<div class="record-grid">' + cards.join('') + '</div>' : emptyState('No records yet', 'Log some games to start building league history.');

  var leadersHTML = rec.leaders.length ?
    '<div class="table-wrap"><table><thead><tr><th></th><th>Player</th><th>GP</th><th>G</th><th>A</th><th>PTS</th></tr></thead><tbody>' +
    rec.leaders.map(function(r,i){ return '<tr><td class="rank">' + (i+1) + '</td><td>' + esc(r.player.name) + '</td><td class="tnum">' + r.gp + '</td><td class="tnum">' + r.goals + '</td><td class="tnum">' + r.assists + '</td><td class="pts"><strong>' + r.points + '</strong></td></tr>'; }).join('') +
    '</tbody></table></div>' : '';

  return '<div class="stack">' +
    '<div>' + cardsHTML + '</div>' +
    (leadersHTML ? '<div class="card"><div class="card-head"><h2>Scoring Leaders</h2></div>' + leadersHTML + '</div>' : '') +
  '</div>';
}

/* ================= PAGE: NEWS ================= */
function renderNews(){
  var season = getCurrentSeason();
  var news = STATE.news.slice().sort(function(a,b){ return new Date(b.date)-new Date(a.date); });
  var composer = !READONLY ? (
    '<div class="card" style="margin-bottom:16px"><div class="card-head"><h2>Post News</h2></div>' +
    '<form data-form="postNews" class="card-pad stack">' +
      '<div class="field-row">' +
        '<div class="field"><label for="news-type">Type</label><select id="news-type" name="type"><option value="announcement">Announcement</option><option value="general">General</option></select></div>' +
        '<div class="field"><label for="news-date">Date</label><input type="date" id="news-date" name="date" value="' + todayISO() + '" required></div>' +
      '</div>' +
      '<div class="field"><label for="news-title">Title</label><input type="text" id="news-title" name="title" required maxlength="120" placeholder="e.g. Trade deadline set for Nov 1"></div>' +
      '<div class="field"><label for="news-body">Body</label><textarea id="news-body" name="body" placeholder="Details for the post&hellip;"></textarea></div>' +
      '<div class="form-actions"><button class="btn primary" type="submit">Publish post</button></div>' +
    '</form></div>'
  ) : '';
  var listHTML = news.length ? '<div class="card">' + news.map(function(n){
    var adminBar = !READONLY ? '<div class="form-actions" style="padding:0 18px 12px;margin-top:-8px"><button class="btn sm danger" data-action="delete-news" data-id="' + n.id + '">Delete</button></div>' : '';
    return newsPostHTML(n) + adminBar;
  }).join('') + '</div>' : '<div class="card">' + emptyState('No news yet', 'Posts you publish will show up here.') + '</div>';
  return pageHead('League Wire', 'News') + composer + listHTML;
}

/* ================= PAGE: LOG GAME ================= */
var lgDraft = {mode:'regular', homeTeamId:'', awayTeamId:'', seriesId:'', seriesHomeId:'', date: todayISO(), resultType:'REG'};
function statEntryRow(player){
  var isG = player.position==='G';
  return '<div class="list-row" data-player-row="' + player.id + '" style="align-items:center">' +
    '<label style="display:flex;align-items:center;gap:8px;flex:1;min-width:0">' +
      '<input type="checkbox" name="played_' + player.id + '" class="played-cb">' +
      '<span>' + esc(player.name) + (player.jersey?' <span class="subtle tnum">#' + esc(player.jersey) + '</span>':'') + '<span class="subtle" style="display:block;font-size:11px">' + posLabel(player.position) + '</span></span>' +
    '</label>' +
    (isG ?
      '<div class="field" style="width:84px"><label>GA</label><input type="number" min="0" max="30" name="ga_' + player.id + '" disabled value="0"></div>'
      :
      '<div style="display:flex;gap:8px">' +
        '<div class="field" style="width:64px"><label>G</label><input type="number" min="0" max="20" name="goals_' + player.id + '" disabled value="0"></div>' +
        '<div class="field" style="width:64px"><label>A</label><input type="number" min="0" max="20" name="assists_' + player.id + '" disabled value="0"></div>' +
      '</div>'
    ) +
  '</div>';
}
function scheduleFormHTML(teams){
  return '<form data-form="scheduleGame" class="card card-pad stack" style="max-width:480px">' +
    '<div class="field-row">' +
      '<div class="field"><label>Home team</label><select name="homeTeamId" required><option value="">Select&hellip;</option>' + teams.map(function(t){return '<option value="' + t.id + '">' + esc(t.name) + '</option>';}).join('') + '</select></div>' +
      '<div class="field"><label>Away team</label><select name="awayTeamId" required><option value="">Select&hellip;</option>' + teams.map(function(t){return '<option value="' + t.id + '">' + esc(t.name) + '</option>';}).join('') + '</select></div>' +
    '</div>' +
    '<div class="field"><label>Date</label><input type="date" name="date" value="' + todayISO() + '" required></div>' +
    '<div class="field"><label>Note (optional)</label><input type="text" name="note" placeholder="e.g. Community Rink, 7:30pm"></div>' +
    '<div class="form-actions"><button class="btn primary" type="submit">Add to schedule</button></div>' +
  '</form>';
}
function resultFormHTML(teams, isPlayoff, openSeries){
  var homeId = lgDraft.homeTeamId, awayId = lgDraft.awayTeamId;
  var teamPickerHTML;
  if(isPlayoff){
    var series = lgDraft.seriesId ? openSeries.filter(function(s){return s.id===lgDraft.seriesId;})[0] : null;
    if(series){ homeId = lgDraft.seriesHomeId || series.teamAId; awayId = homeId===series.teamAId ? series.teamBId : series.teamAId; }
    else { homeId = ''; awayId = ''; }
    teamPickerHTML = '<div class="field-row">' +
      '<div class="field"><label>Series</label><select data-bind="seriesId"><option value="">Select series&hellip;</option>' +
        openSeries.map(function(s){
          var a = teamById(s.teamAId), b = teamById(s.teamBId);
          return '<option value="' + s.id + '" ' + (lgDraft.seriesId===s.id?'selected':'') + '>' + esc(a?a.name:'?') + ' vs ' + esc(b?b.name:'?') + ' (Rd ' + s.round + ', ' + s.winsA + '-' + s.winsB + ')</option>';
        }).join('') +
      '</select></div>' +
      (series ? '<div class="field"><label>Home team this game</label><select data-bind="seriesHomeId">' +
        '<option value="' + series.teamAId + '" ' + (homeId===series.teamAId?'selected':'') + '>' + esc(teamById(series.teamAId).name) + '</option>' +
        '<option value="' + series.teamBId + '" ' + (homeId===series.teamBId?'selected':'') + '>' + esc(teamById(series.teamBId).name) + '</option>' +
      '</select></div>' : '') +
    '</div>';
  } else {
    teamPickerHTML = '<div class="field-row">' +
      '<div class="field"><label>Home team</label><select data-bind="homeTeamId"><option value="">Select&hellip;</option>' +
        teams.map(function(t){return '<option value="' + t.id + '" ' + (homeId===t.id?'selected':'') + '>' + esc(t.name) + '</option>';}).join('') +
      '</select></div>' +
      '<div class="field"><label>Away team</label><select data-bind="awayTeamId"><option value="">Select&hellip;</option>' +
        teams.filter(function(t){return t.id!==homeId;}).map(function(t){return '<option value="' + t.id + '" ' + (awayId===t.id?'selected':'') + '>' + esc(t.name) + '</option>';}).join('') +
      '</select></div>' +
    '</div>';
  }

  var bodyHTML = '';
  if(homeId && awayId){
    var homeTeam = teamById(homeId), awayTeam = teamById(awayId);
    var homeRoster = teamPlayers(homeId), awayRoster = teamPlayers(awayId);
    bodyHTML =
      '<div class="field-row">' +
        '<div class="field"><label>Date</label><input type="date" data-bind="date" value="' + lgDraft.date + '"></div>' +
        '<div class="field"><label>Decided in</label><select data-bind="resultType">' +
          '<option value="REG" ' + (lgDraft.resultType==='REG'?'selected':'') + '>Regulation</option>' +
          '<option value="OT" ' + (lgDraft.resultType==='OT'?'selected':'') + '>Overtime</option>' +
          '<option value="SO" ' + (lgDraft.resultType==='SO'?'selected':'') + '>Shootout</option>' +
        '</select></div>' +
      '</div>' +
      '<div id="score-preview" style="text-align:center;padding:12px;background:var(--surface-2);border-radius:var(--r-md)">' +
        '<span class="team-name">' + esc(homeTeam.shortName||homeTeam.name) + '</span> <span class="score" id="sp-home">0</span>' +
        '<span class="vs" style="margin:0 8px">&ndash;</span>' +
        '<span class="score" id="sp-away">0</span> <span class="team-name">' + esc(awayTeam.shortName||awayTeam.name) + '</span>' +
      '</div>' +
      '<div class="field-row">' +
        '<fieldset data-side="home"><legend>' + esc(homeTeam.name) + '</legend>' + (homeRoster.length?homeRoster.map(statEntryRow).join(''):'<p class="subtle">No players on this roster yet.</p>') + '</fieldset>' +
        '<fieldset data-side="away"><legend>' + esc(awayTeam.name) + '</legend>' + (awayRoster.length?awayRoster.map(statEntryRow).join(''):'<p class="subtle">No players on this roster yet.</p>') + '</fieldset>' +
      '</div>' +
      '<div class="field"><label>Notes (optional)</label><textarea name="notes" placeholder="Shots, penalties, highlights&hellip;"></textarea></div>' +
      '<div class="form-actions"><button class="btn primary" type="submit">Save final result</button></div>';
  } else {
    bodyHTML = '<p class="subtle">Choose both teams to enter the box score.</p>';
  }
  return '<form data-form="logResult" data-playoff="' + (isPlayoff?'1':'0') + '" class="card card-pad stack">' + teamPickerHTML + bodyHTML + '</form>';
}
function renderLogGame(){
  var teams = activeTeams();
  var head = pageHead('Box Score', 'Log Game');
  if(teams.length<2){
    return head + '<div class="card">' + emptyState('Need at least two teams', 'Add teams from the Management tab before logging games.') + '</div>';
  }
  var season = getCurrentSeason();
  var bracket = playoffsForSeason(season.id);
  var openSeries = bracket ? bracket.series.filter(function(s){return s.teamAId && s.teamBId && s.status!=='completed';}) : [];
  var tabs = '<div class="tabbar">' +
    '<button class="tab-btn ' + (lgDraft.mode==='regular'?'active':'') + '" data-lgmode="regular">Regular Season</button>' +
    (openSeries.length ? '<button class="tab-btn ' + (lgDraft.mode==='playoff'?'active':'') + '" data-lgmode="playoff">Playoff Game</button>' : '') +
    '<button class="tab-btn ' + (lgDraft.mode==='schedule'?'active':'') + '" data-lgmode="schedule">Schedule Future Game</button>' +
  '</div>';
  var body;
  if(lgDraft.mode==='schedule') body = scheduleFormHTML(teams);
  else if(lgDraft.mode==='playoff' && openSeries.length) body = resultFormHTML(teams, true, openSeries);
  else body = resultFormHTML(teams, false, []);
  return head + tabs + body;
}

/* ================= PAGE: MANAGEMENT ================= */
var mgTab = 'teams';
var mgEditTeamId = null;
var mgEditPlayerId = null;
var mgEditDivisionId = null;
var tradeDraft = { moves: [{playerId:'', toTeamId:''}] };

function mgTeamsHTML(){
  var editing = mgEditTeamId ? teamById(mgEditTeamId) : null;
  var divisions = sortedDivisions();
  var formHTML = '<form data-form="saveTeam" class="card card-pad stack" style="max-width:540px;margin-bottom:18px">' +
    '<div class="eyebrow">' + (editing?'Edit Team':'Add Team') + '</div>' +
    (editing?'<input type="hidden" name="id" value="' + editing.id + '">':'') +
    '<div class="field-row">' +
      '<div class="field"><label>Team name</label><input type="text" name="name" required value="' + (editing?esc(editing.name):'') + '" placeholder="e.g. Ice Wolves"></div>' +
      '<div class="field"><label>Short name</label><input type="text" name="shortName" value="' + (editing?esc(editing.shortName||''):'') + '" placeholder="e.g. Wolves"></div>' +
    '</div>' +
    '<div class="field-row">' +
      '<div class="field"><label>Abbreviation</label><input type="text" name="abbr" maxlength="4" value="' + (editing?esc(editing.abbr||''):'') + '" placeholder="e.g. ICE"></div>' +
      '<div class="field"><label>Team color</label><input type="color" name="colorPrimary" value="' + (editing&&editing.colorPrimary?editing.colorPrimary:'#1D5D8C') + '"></div>' +
    '</div>' +
    (divisions.length ? '<div class="field"><label>Division</label><select name="divisionId"><option value="">No division</option>' +
      divisions.map(function(d){return '<option value="' + d.id + '" ' + (editing&&editing.divisionId===d.id?'selected':'') + '>' + esc(d.name) + '</option>';}).join('') +
      '</select></div>' : '') +
    '<div class="form-actions"><button class="btn primary" type="submit">' + (editing?'Save changes':'Add team') + '</button>' + (editing?'<button type="button" class="btn" data-action="cancel-edit-team">Cancel</button>':'') + '</div>' +
  '</form>';
  var rows = STATE.teams.slice().sort(function(a,b){return a.name.localeCompare(b.name);}).map(function(t){
    var gpCount = STATE.games.filter(function(g){return g.homeTeamId===t.id||g.awayTeamId===t.id;}).length;
    var div = t.divisionId ? divisionById(t.divisionId) : null;
    return '<div class="list-row">' +
      '<div style="display:flex;align-items:center;gap:10px;flex:1">' + teamBadgeHTML(t) + '<span>' + esc(t.name) + (t.active===false?' <span class="chip general">Inactive</span>':'') + (div?' <span class="chip general">' + esc(div.name) + '</span>':'') + '</span></div>' +
      '<div class="form-actions">' +
        '<button class="btn sm" data-action="edit-team" data-id="' + t.id + '">Edit</button>' +
        (t.active===false ? '<button class="btn sm" data-action="reactivate-team" data-id="' + t.id + '">Reactivate</button>' : '<button class="btn sm" data-action="deactivate-team" data-id="' + t.id + '">Deactivate</button>') +
        (gpCount===0 ? '<button class="btn sm danger" data-action="delete-team" data-id="' + t.id + '">Delete</button>' : '') +
      '</div></div>';
  }).join('');
  return formHTML + '<div class="card">' + (rows || emptyState('No teams yet', 'Add your first team above.')) + '</div>';
}

function mgDivisionsHTML(){
  var editing = mgEditDivisionId ? divisionById(mgEditDivisionId) : null;
  var formHTML = '<form data-form="saveDivision" class="card card-pad stack" style="max-width:460px;margin-bottom:18px">' +
    '<div class="eyebrow">' + (editing?'Edit Division':'Add Division') + '</div>' +
    (editing?'<input type="hidden" name="id" value="' + editing.id + '">':'') +
    '<div class="field-row">' +
      '<div class="field"><label>Division name</label><input type="text" name="name" required value="' + (editing?esc(editing.name):'') + '" placeholder="e.g. North"></div>' +
      '<div class="field"><label>Playoff cutoff</label><input type="number" min="1" name="playoffCutoff" value="' + (editing&&editing.playoffCutoff!=null?editing.playoffCutoff:'') + '" placeholder="e.g. 4"></div>' +
    '</div>' +
    '<p class="subtle" style="font-size:12px;margin:0">Playoff cutoff is optional — leave blank for no cutoff line. When set, Standings draws a line after that rank when viewing this division.</p>' +
    '<div class="form-actions"><button class="btn primary" type="submit">' + (editing?'Save changes':'Add division') + '</button>' + (editing?'<button type="button" class="btn" data-action="cancel-edit-division">Cancel</button>':'') + '</div>' +
  '</form>';
  var divisions = sortedDivisions();
  var rows = divisions.map(function(d){
    var teamCount = STATE.teams.filter(function(t){return t.divisionId===d.id;}).length;
    return '<div class="list-row">' +
      '<div style="flex:1">' + esc(d.name) + ' <span class="subtle">&middot; ' + teamCount + ' team' + (teamCount===1?'':'s') + (d.playoffCutoff!=null?' &middot; top ' + d.playoffCutoff + ' make playoffs':'') + '</span></div>' +
      '<div class="form-actions">' +
        '<button class="btn sm" data-action="edit-division" data-id="' + d.id + '">Edit</button>' +
        '<button class="btn sm danger" data-action="delete-division" data-id="' + d.id + '">Delete</button>' +
      '</div></div>';
  }).join('');
  return formHTML + '<div class="card">' + (rows || emptyState('No divisions yet', 'Add a division above, then assign teams to it from the Teams tab.')) + '</div>';
}

/* ---------- bulk-add player parsing ---------- */
function parseBulkPlayerLine(line){
  var parts = line.split(',').map(function(s){return s.trim();}).filter(Boolean);
  if(!parts.length) return null;
  var name = parts[0];
  var jersey = null, position = null;
  for(var i=1;i<parts.length;i++){
    var tok = parts[i], up = tok.toUpperCase();
    if(/^\d+$/.test(tok)) jersey = parseInt(tok,10);
    else if(up==='F'||up==='FORWARD') position='F';
    else if(up==='D'||up==='DEFENSE'||up==='DEFENCE') position='D';
    else if(up==='G'||up==='GOALIE'||up==='GOALTENDER') position='G';
  }
  return { name:name, jersey:jersey, position: position || 'F' };
}
function parseBulkPlayersText(text){
  return (text||'').split(/\r?\n/).map(parseBulkPlayerLine).filter(Boolean);
}

var mgPlayerAddMode = 'single';
function mgPlayersHTML(){
  if(!STATE.teams.length) return emptyState('Add a team first', 'Players need a team to belong to.');
  var editing = mgEditPlayerId ? playerById(mgEditPlayerId) : null;
  var teams = STATE.teams.slice().sort(function(a,b){return a.name.localeCompare(b.name);});
  var mode = editing ? 'single' : mgPlayerAddMode;
  var modeToggle = editing ? '' : (
    '<div class="tabbar" style="margin-bottom:14px">' +
      '<button class="tab-btn ' + (mode==='single'?'active':'') + '" data-mgplayeraddmode="single">Add One</button>' +
      '<button class="tab-btn ' + (mode==='bulk'?'active':'') + '" data-mgplayeraddmode="bulk">Bulk Add</button>' +
    '</div>'
  );
  var singleFormHTML = '<form data-form="savePlayer" class="card card-pad stack" style="max-width:580px;margin-bottom:18px">' +
    '<div class="eyebrow">' + (editing?'Edit Player':'Add Player') + '</div>' +
    (editing?'<input type="hidden" name="id" value="' + editing.id + '">':'') +
    '<div class="field-row">' +
      '<div class="field"><label>Name</label><input type="text" name="name" required value="' + (editing?esc(editing.name):'') + '"></div>' +
      '<div class="field"><label>Jersey #</label><input type="number" min="0" max="99" name="jersey" value="' + (editing&&editing.jersey!=null?editing.jersey:'') + '"></div>' +
    '</div>' +
    '<div class="field-row">' +
      '<div class="field"><label>Team</label><select name="teamId" required>' + teams.map(function(t){return '<option value="' + t.id + '" ' + (editing&&editing.teamId===t.id?'selected':'') + '>' + esc(t.name) + '</option>';}).join('') + '</select></div>' +
      '<div class="field"><label>Position</label><select name="position">' + ['F','D','G'].map(function(p){return '<option value="' + p + '" ' + (editing&&editing.position===p?'selected':'') + '>' + posLabel(p) + '</option>';}).join('') + '</select></div>' +
    '</div>' +
    '<div class="form-actions"><button class="btn primary" type="submit">' + (editing?'Save changes':'Add player') + '</button>' + (editing?'<button type="button" class="btn" data-action="cancel-edit-player">Cancel</button>':'') + '</div>' +
  '</form>';
  var bulkFormHTML = '<form data-form="bulkAddPlayers" class="card card-pad stack" style="max-width:580px;margin-bottom:18px">' +
    '<div class="eyebrow">Bulk Add Players</div>' +
    '<div class="field"><label>Team</label><select name="teamId" required>' + teams.map(function(t){return '<option value="' + t.id + '">' + esc(t.name) + '</option>';}).join('') + '</select></div>' +
    '<div class="field"><label>Players</label><textarea name="players" rows="8" placeholder="One player per line:&#10;Sam Carter, 9, F&#10;Jamie Lee, 30, G&#10;Alex Rivera"></textarea></div>' +
    '<p class="subtle" style="font-size:12px;margin:0">One player per line. After the name, add a jersey number and/or position (F/D/G) separated by commas, in any order — both are optional. Every player on the list joins the team selected above.</p>' +
    '<div class="form-actions"><button class="btn primary" type="submit">Add players</button></div>' +
  '</form>';
  var formHTML = mode==='bulk' ? bulkFormHTML : singleFormHTML;
  var body = teams.map(function(t){
    var roster = teamPlayers(t.id, true).slice().sort(function(a,b){return a.name.localeCompare(b.name);});
    if(!roster.length) return '';
    return '<div class="card" style="margin-bottom:14px"><div class="card-head"><h2 style="display:flex;gap:8px;align-items:center">' + teamBadgeHTML(t,'sm') + esc(t.name) + '</h2></div>' +
      roster.map(function(p){
        var gp = STATE.gamePlayerStats.filter(function(gs){return gs.playerId===p.id;}).length;
        return '<div class="list-row"><div style="flex:1">' + esc(p.name) + (p.jersey?' <span class="subtle tnum">#' + esc(p.jersey) + '</span>':'') + ' <span class="subtle">' + posLabel(p.position) + '</span>' + (p.active===false?' <span class="chip general">Inactive</span>':'') + '</div>' +
          '<div class="form-actions">' +
            '<button class="btn sm" data-action="edit-player" data-id="' + p.id + '">Edit</button>' +
            (p.active===false ? '<button class="btn sm" data-action="reactivate-player" data-id="' + p.id + '">Reactivate</button>' : '<button class="btn sm" data-action="deactivate-player" data-id="' + p.id + '">Deactivate</button>') +
            (gp===0 ? '<button class="btn sm danger" data-action="delete-player" data-id="' + p.id + '">Delete</button>' : '') +
          '</div></div>';
      }).join('') +
    '</div>';
  }).join('');
  return modeToggle + formHTML + (body || emptyState('No players yet', 'Add your first player above.'));
}

function mgTradesHTML(){
  if(STATE.players.length<1) return emptyState('Add players first', 'Trades move players between teams.');
  var teams = STATE.teams.slice().sort(function(a,b){return a.name.localeCompare(b.name);});
  var rowsHTML = tradeDraft.moves.map(function(mv, idx){
    return '<div style="display:flex;gap:12px;align-items:end;flex-wrap:wrap">' +
      '<div class="field" style="flex:1;min-width:200px"><label>Player</label><select data-trade-field="playerId" data-idx="' + idx + '"><option value="">Select&hellip;</option>' +
        STATE.players.filter(function(p){return p.active!==false;}).slice().sort(function(a,b){return a.name.localeCompare(b.name);}).map(function(p){
          var t = teamById(p.teamId);
          return '<option value="' + p.id + '" ' + (mv.playerId===p.id?'selected':'') + '>' + esc(p.name) + (t?' (' + esc(t.shortName||t.name) + ')':'') + '</option>';
        }).join('') +
      '</select></div>' +
      '<div class="field" style="flex:1;min-width:200px"><label>New team</label><select data-trade-field="toTeamId" data-idx="' + idx + '"><option value="">Select&hellip;</option>' +
        teams.map(function(t){return '<option value="' + t.id + '" ' + (mv.toTeamId===t.id?'selected':'') + '>' + esc(t.name) + '</option>';}).join('') +
      '</select></div>' +
      '<button type="button" class="btn sm danger" data-action="remove-trade-row" data-idx="' + idx + '" ' + (tradeDraft.moves.length<=1?'disabled':'') + ' style="flex:none">Remove</button>' +
    '</div>';
  }).join('');
  var summary = tradeDraft.moves.filter(function(m){return m.playerId&&m.toTeamId;}).map(function(m){
    var p = playerById(m.playerId), from = p?teamById(p.teamId):null, to = teamById(m.toTeamId);
    return (p?p.name:'?') + ': ' + (from?(from.shortName||from.name):'FA') + ' → ' + (to?(to.shortName||to.name):'?');
  }).join('; ');
  return '<form data-form="logTrade" class="card card-pad stack">' +
    '<div class="eyebrow">Log a Trade</div>' +
    rowsHTML +
    '<div><button type="button" class="btn sm" data-action="add-trade-row">+ Add player</button></div>' +
    '<div class="field"><label>Announcement headline</label><input type="text" name="headline" placeholder="' + (summary?esc(summary):'Trade announcement') + '"></div>' +
    '<div class="field"><label>Details (optional)</label><textarea name="details" placeholder="Draft picks, conditions, etc."></textarea></div>' +
    '<div class="form-actions"><button class="btn primary" type="submit">Execute trade &amp; post news</button></div>' +
  '</form>';
}

function mgSettingsHTML(){
  var season = getCurrentSeason();
  return '<div class="grid-2">' +
    '<form data-form="saveSettings" class="card card-pad stack">' +
      '<div class="eyebrow">Branding</div>' +
      '<div class="field"><label>League name</label><input type="text" name="leagueName" value="' + esc(STATE.settings.leagueName||'') + '" required></div>' +
      '<div class="field"><label>Tagline</label><input type="text" name="tagline" value="' + esc(STATE.settings.tagline||'') + '"></div>' +
      '<div class="eyebrow" style="margin-top:8px">Points System &middot; ' + esc(season.name) + '</div>' +
      '<div class="field-row">' +
        '<div class="field"><label>Win</label><input type="number" name="pointsWin" min="0" value="' + season.pointsWin + '"></div>' +
        '<div class="field"><label>OT/SO Loss</label><input type="number" name="pointsOTL" min="0" value="' + season.pointsOTL + '"></div>' +
        '<div class="field"><label>Loss</label><input type="number" name="pointsLoss" min="0" value="' + season.pointsLoss + '"></div>' +
      '</div>' +
      '<div class="form-actions"><button class="btn primary" type="submit">Save settings</button></div>' +
    '</form>' +
    '<div class="card card-pad stack">' +
      '<div class="eyebrow">Season</div>' +
      '<p>Current season: <strong>' + esc(season.name) + '</strong></p>' +
      '<p class="subtle" style="font-size:12.5px">Starting a new season archives the current standings under Records &rarr; All-Time and gives Standings, Players and Playoffs a clean slate. Rosters carry over.</p>' +
      '<form data-form="newSeason" class="stack">' +
        '<div class="field"><label>New season name</label><input type="text" name="name" required placeholder="e.g. Season 2"></div>' +
        '<div class="form-actions"><button class="btn" type="submit">Start new season</button></div>' +
      '</form>' +
    '</div>' +
  '</div>';
}

function renderManagement(){
  var head = pageHead('Admin', 'Management');
  var labels = {teams:'Teams', divisions:'Divisions', players:'Players', trades:'Trades', settings:'League Settings'};
  var tabs = '<div class="tabbar">' + ['teams','divisions','players','trades','settings'].map(function(t){
    return '<button class="tab-btn ' + (mgTab===t?'active':'') + '" data-mgtab="' + t + '">' + labels[t] + '</button>';
  }).join('') + '</div>';
  var body;
  if(mgTab==='teams') body = mgTeamsHTML();
  else if(mgTab==='divisions') body = mgDivisionsHTML();
  else if(mgTab==='players') body = mgPlayersHTML();
  else if(mgTab==='trades') body = mgTradesHTML();
  else body = mgSettingsHTML();
  return head + tabs + body;
}

/* ================= THEME ================= */
function effectiveTheme(){
  var t = document.documentElement.getAttribute('data-theme');
  if(t) return t;
  return (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
}
function toggleTheme(){
  var next = effectiveTheme()==='dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  try{ localStorage.setItem('rr-theme', next); }catch(e){}
  paint();
}

/* ================= TOAST ================= */
var toastTimer = null;
function toast(msg, isErr){
  var el = document.getElementById('toast');
  if(!el) return;
  el.textContent = msg;
  el.className = 'toast show' + (isErr?' err':'');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function(){ el.className = 'toast'; }, 3400);
}


/* ================= SAVE HELPER ================= */
async function withSave(run, successMsg) {
  if (!SESSION) { toast("Sign in as admin to make changes.", true); return false; }
  if (SAVING) return false;
  SAVING = true;
  try {
    await run();
    STATE = await loadState();
    if (successMsg) toast(successMsg);
    return true;
  } catch (err) {
    console.error(err);
    toast((err && err.message) || "Could not save — please try again.", true);
    return false;
  } finally {
    SAVING = false;
    paint();
  }
}

/* ================= AUTH ================= */
async function doSignIn(email, password) {
  var r = await sb.auth.signInWithPassword({ email: email, password: password });
  if (r.error) throw r.error;
  return r.data.session;
}
async function doSignUp(email, password) {
  var r = await sb.auth.signUp({ email: email, password: password });
  if (r.error) throw r.error;
  return r.data.session;
}
async function doSignOut() { await sb.auth.signOut(); }

/* ================= EVENTS ================= */
function onClick(e) {
  var authToggle = e.target.closest('[data-action="toggle-auth-panel"]');
  if (authToggle) { authPanelOpen = !authPanelOpen; authError = ""; paint(); return; }
  var authTab = e.target.closest("[data-authmode]");
  if (authTab) { authMode = authTab.dataset.authmode; authError = ""; paint(); return; }
  if (authPanelOpen && !e.target.closest("[data-auth-panel]") && !e.target.closest('[data-action="toggle-auth-panel"]')) {
    authPanelOpen = false; paint();
  }

  var t = e.target.closest("[data-action]");
  if (t) {
    var action = t.dataset.action, id = t.dataset.id;
    if (action === "sign-out") { doSignOut(); return; }
    else if (action === "edit-team") { mgEditTeamId = id; paint(); }
    else if (action === "cancel-edit-team") { mgEditTeamId = null; paint(); }
    else if (action === "deactivate-team") { withSave(function () { return DB.setTeamActive(id, false); }); }
    else if (action === "reactivate-team") { withSave(function () { return DB.setTeamActive(id, true); }); }
    else if (action === "delete-team") { if (confirm("Delete this team? This cannot be undone.")) withSave(function () { return DB.deleteTeam(id); }); }
    else if (action === "edit-division") { mgEditDivisionId = id; paint(); }
    else if (action === "cancel-edit-division") { mgEditDivisionId = null; paint(); }
    else if (action === "delete-division") { if (confirm("Delete this division? Teams in it become unassigned.")) withSave(function () { return DB.deleteDivision(id); }); }
    else if (action === "edit-player") { mgEditPlayerId = id; paint(); }
    else if (action === "cancel-edit-player") { mgEditPlayerId = null; paint(); }
    else if (action === "deactivate-player") { withSave(function () { return DB.setPlayerActive(id, false); }); }
    else if (action === "reactivate-player") { withSave(function () { return DB.setPlayerActive(id, true); }); }
    else if (action === "delete-player") { if (confirm("Delete this player? This cannot be undone.")) withSave(function () { return DB.deletePlayer(id); }); }
    else if (action === "delete-news") { if (confirm("Delete this post?")) withSave(function () { return DB.deleteNews(id); }); }
    else if (action === "add-trade-row") { tradeDraft.moves.push({ playerId: "", toTeamId: "" }); paint(); }
    else if (action === "remove-trade-row") { var idx = parseInt(t.dataset.idx, 10); tradeDraft.moves.splice(idx, 1); paint(); }
    else if (action === "reset-bracket") {
      if (confirm("Reset the playoff bracket? All series progress will be lost.")) {
        var b = playoffsForSeason(getCurrentSeason().id);
        if (b) withSave(function () { return DB.resetBracket(b.id); });
      }
    }
    return;
  }
  var lgm = e.target.closest("[data-lgmode]");
  if (lgm) { lgDraft.mode = lgm.dataset.lgmode; paint(); return; }
  var sv = e.target.closest("[data-standingsview]");
  if (sv) { standingsView = sv.dataset.standingsview; paint(); return; }
  var pam = e.target.closest("[data-mgplayeraddmode]");
  if (pam) { mgPlayerAddMode = pam.dataset.mgplayeraddmode; paint(); return; }
  var mgt = e.target.closest("[data-mgtab]");
  if (mgt) { mgTab = mgt.dataset.mgtab; mgEditTeamId = null; mgEditPlayerId = null; mgEditDivisionId = null; paint(); return; }
  var rt = e.target.closest(".tabbar [data-tab]");
  if (rt && document.getElementById("records-body")) {
    $all(".tabbar .tab-btn").forEach(function (b) { b.classList.remove("active"); });
    rt.classList.add("active");
    var season = getCurrentSeason();
    document.getElementById("records-body").innerHTML = recordsBodyHTML(rt.dataset.tab === "all" ? "all" : season.id);
    return;
  }
}
function onChange(e) {
  var el = e.target;
  if (el.matches && el.matches("[data-bind]")) {
    var key = el.dataset.bind;
    lgDraft[key] = el.value;
    if (key === "homeTeamId" && lgDraft.awayTeamId === el.value) lgDraft.awayTeamId = "";
    if (key === "seriesId") { lgDraft.seriesHomeId = ""; }
    paint();
    return;
  }
  if (el.matches && el.matches("[data-trade-field]")) {
    var idx = parseInt(el.dataset.idx, 10);
    tradeDraft.moves[idx][el.dataset.tradeField] = el.value;
    paint();
    return;
  }
  if (el.matches && el.matches(".played-cb")) {
    var row = el.closest("[data-player-row]");
    $all("input[type=number]", row).forEach(function (n) { n.disabled = !el.checked; if (!el.checked) n.value = "0"; });
    updateScorePreview();
    return;
  }
}
function onInput(e) {
  if (e.target.matches && e.target.matches('input[name^="goals_"]')) updateScorePreview();
}
function updateScorePreview() {
  var homeEl = document.getElementById("sp-home"), awayEl = document.getElementById("sp-away");
  if (!homeEl || !awayEl) return;
  var homeSum = 0, awaySum = 0;
  $all('[data-side="home"] input[name^="goals_"]').forEach(function (i) { homeSum += parseInt(i.value, 10) || 0; });
  $all('[data-side="away"] input[name^="goals_"]').forEach(function (i) { awaySum += parseInt(i.value, 10) || 0; });
  homeEl.textContent = homeSum; awayEl.textContent = awaySum;
}
function gatherLogResult(form, fd) {
  var isPlayoff = form.dataset.playoff === "1";
  var homeId, awayId, seriesId = null;
  if (isPlayoff) {
    seriesId = lgDraft.seriesId;
    if (!seriesId) { toast("Select a series first.", true); return null; }
    var s = seriesById(seriesId);
    if (!s) { toast("Series not found.", true); return null; }
    homeId = lgDraft.seriesHomeId || s.teamAId;
    awayId = homeId === s.teamAId ? s.teamBId : s.teamAId;
  } else {
    homeId = lgDraft.homeTeamId; awayId = lgDraft.awayTeamId;
  }
  if (!homeId || !awayId) { toast("Choose both teams.", true); return null; }
  var date = lgDraft.date || todayISO();
  var resultType = lgDraft.resultType || "REG";
  var notes = ((fd.get("notes") || "") + "").trim();
  var homeRoster = teamPlayers(homeId), awayRoster = teamPlayers(awayId);
  var statsEntries = [];
  var homeScore = 0, awayScore = 0;
  [[homeRoster, homeId, true], [awayRoster, awayId, false]].forEach(function (pair) {
    pair[0].forEach(function (p) {
      var playedEl = form.querySelector('input[name="played_' + p.id + '"]');
      if (!playedEl || !playedEl.checked) return;
      if (p.position === "G") {
        var gaEl = form.querySelector('input[name="ga_' + p.id + '"]');
        var ga = gaEl ? (parseInt(gaEl.value, 10) || 0) : 0;
        statsEntries.push({ playerId: p.id, teamId: pair[1], isGoalie: true, goalsAgainst: ga, goals: 0, assists: 0 });
      } else {
        var gEl = form.querySelector('input[name="goals_' + p.id + '"]');
        var aEl = form.querySelector('input[name="assists_' + p.id + '"]');
        var g = gEl ? (parseInt(gEl.value, 10) || 0) : 0;
        var a = aEl ? (parseInt(aEl.value, 10) || 0) : 0;
        statsEntries.push({ playerId: p.id, teamId: pair[1], isGoalie: false, goals: g, assists: a, goalsAgainst: 0 });
        if (pair[2]) homeScore += g; else awayScore += g;
      }
    });
  });
  if (homeScore === awayScore) { toast("Scores are tied (" + homeScore + "-" + awayScore + ") — hockey needs a winner.", true); return null; }
  if (statsEntries.length === 0 && !confirm("No player stats entered — save anyway?")) return null;
  return {
    seasonId: getCurrentSeason().id, date: date, homeTeamId: homeId, awayTeamId: awayId,
    homeScore: homeScore, awayScore: awayScore, result: resultType, isPlayoff: isPlayoff,
    seriesId: seriesId, notes: notes, statsEntries: statsEntries
  };
}
async function onSubmit(e) {
  var form = e.target.closest("form[data-form]");
  if (!form) return;
  e.preventDefault();
  var kind = form.dataset.form;
  var fd = new FormData(form);

  if (kind === "signIn" || kind === "signUp") {
    var email = ((fd.get("email") || "") + "").trim();
    var password = (fd.get("password") || "") + "";
    authError = "";
    try {
      if (kind === "signIn") await doSignIn(email, password);
      else {
        var session = await doSignUp(email, password);
        if (!session) { authError = "Check your email to confirm your account, then sign in."; authMode = "signin"; paint(); return; }
      }
      authPanelOpen = false;
      paint();
    } catch (err) {
      authError = (err && err.message) || "Could not sign in.";
      paint();
    }
    return;
  }

  if (kind === "saveTeam") {
    var tname = ((fd.get("name") || "") + "").trim();
    if (!tname) return;
    var team = {
      id: fd.get("id") || null, name: tname,
      shortName: ((fd.get("shortName") || "") + "").trim(),
      abbr: ((fd.get("abbr") || "") + "").trim().toUpperCase() || tname.slice(0, 3).toUpperCase(),
      colorPrimary: fd.get("colorPrimary") || "#1D5D8C",
      divisionId: fd.get("divisionId") || null
    };
    var ok = await withSave(function () { return DB.saveTeam(team); }, team.id ? "Team updated." : "Team added.");
    if (ok) mgEditTeamId = null;
  } else if (kind === "saveDivision") {
    var dname = ((fd.get("name") || "") + "").trim();
    if (!dname) return;
    var cutoffRaw = fd.get("playoffCutoff");
    var division = {
      id: fd.get("id") || null, name: dname,
      playoffCutoff: (cutoffRaw !== null && cutoffRaw !== "") ? parseInt(cutoffRaw, 10) : null
    };
    var okd = await withSave(function () { return DB.saveDivision(division); }, division.id ? "Division updated." : "Division added.");
    if (okd) mgEditDivisionId = null;
  } else if (kind === "savePlayer") {
    var pname = ((fd.get("name") || "") + "").trim();
    if (!pname) return;
    var jerseyRaw = fd.get("jersey");
    var player = {
      id: fd.get("id") || null, teamId: fd.get("teamId"), name: pname,
      position: fd.get("position") || "F",
      jersey: (jerseyRaw !== null && jerseyRaw !== "") ? parseInt(jerseyRaw, 10) : null
    };
    var ok2 = await withSave(function () { return DB.savePlayer(player); }, player.id ? "Player updated." : "Player added.");
    if (ok2) mgEditPlayerId = null;
  } else if (kind === "bulkAddPlayers") {
    var bulkTeamId = fd.get("teamId");
    if (!bulkTeamId) { toast("Choose a team.", true); return; }
    var parsedPlayers = parseBulkPlayersText((fd.get("players") || "") + "");
    if (!parsedPlayers.length) { toast("Paste at least one player, one per line.", true); return; }
    var bulkTeam = teamById(bulkTeamId);
    if (!confirm("Add " + parsedPlayers.length + " player" + (parsedPlayers.length === 1 ? "" : "s") + " to " + (bulkTeam ? bulkTeam.name : "this team") + "?")) return;
    var bulkRows = parsedPlayers.map(function (p) { return { teamId: bulkTeamId, name: p.name, position: p.position, jersey: p.jersey }; });
    await withSave(function () { return DB.bulkAddPlayers(bulkRows); }, "Added " + bulkRows.length + " player" + (bulkRows.length === 1 ? "" : "s") + ".");
  } else if (kind === "logTrade") {
    var moves = tradeDraft.moves.filter(function (m) { return m.playerId && m.toTeamId; });
    if (!moves.length) { toast("Add at least one player move.", true); return; }
    var summaryParts = moves.map(function (m) {
      var p = playerById(m.playerId), from = p ? teamById(p.teamId) : null, to = teamById(m.toTeamId);
      return (p ? p.name : "?") + ": " + (from ? (from.shortName || from.name) : "Free Agent") + " → " + (to ? (to.shortName || to.name) : "?");
    });
    var headline = ((fd.get("headline") || "") + "").trim() || ("Trade: " + summaryParts.join("; "));
    var details = ((fd.get("details") || "") + "").trim();
    var ok3 = await withSave(function () { return DB.logTrade(moves, headline, details); }, "Trade logged.");
    if (ok3) tradeDraft = { moves: [{ playerId: "", toTeamId: "" }] };
  } else if (kind === "postNews") {
    var title = ((fd.get("title") || "") + "").trim();
    if (!title) return;
    var news = { type: fd.get("type") || "general", title: title, body: ((fd.get("body") || "") + "").trim(), date: fd.get("date") || todayISO() };
    await withSave(function () { return DB.postNews(news); }, "Posted.");
  } else if (kind === "saveSettings") {
    var lname = ((fd.get("leagueName") || "") + "").trim();
    if (!lname) return;
    var settings = {
      leagueName: lname, tagline: ((fd.get("tagline") || "") + "").trim(), seasonId: getCurrentSeason().id,
      pointsWin: parseInt(fd.get("pointsWin"), 10) || 0, pointsOTL: parseInt(fd.get("pointsOTL"), 10) || 0, pointsLoss: parseInt(fd.get("pointsLoss"), 10) || 0
    };
    await withSave(function () { return DB.saveSettings(settings); }, "Settings saved.");
  } else if (kind === "newSeason") {
    var sname = ((fd.get("name") || "") + "").trim();
    if (!sname) return;
    if (!confirm('Start "' + sname + '"? The current season will be archived under All-Time records.')) return;
    var old = getCurrentSeason();
    var payload = { name: sname, pointsWin: old.pointsWin, pointsOTL: old.pointsOTL, pointsLoss: old.pointsLoss, oldSeasonId: old.id };
    await withSave(function () { return DB.startNewSeason(payload); }, "New season started.");
  } else if (kind === "scheduleGame") {
    var h = fd.get("homeTeamId"), a = fd.get("awayTeamId");
    if (!h || !a || h === a) { toast("Pick two different teams.", true); return; }
    var sched = { seasonId: getCurrentSeason().id, date: fd.get("date") || todayISO(), homeTeamId: h, awayTeamId: a, note: ((fd.get("note") || "") + "").trim() };
    await withSave(function () { return DB.scheduleGame(sched); }, "Added to schedule.");
  } else if (kind === "logResult") {
    var payload2 = gatherLogResult(form, fd);
    if (!payload2) return;
    var ok4 = await withSave(function () { return DB.logResult(payload2); }, "Game saved.");
    if (ok4) lgDraft = { mode: payload2.isPlayoff ? "playoff" : "regular", homeTeamId: "", awayTeamId: "", seriesId: "", seriesHomeId: "", date: todayISO(), resultType: "REG" };
  } else if (kind === "genBracket") {
    var seeds = parseInt(fd.get("seeds"), 10);
    var bestOf = parseInt(fd.get("bestOf"), 10);
    var seasonId = getCurrentSeason().id;
    await withSave(function () { return DB.createBracket(seasonId, seeds, bestOf); }, "Bracket generated.");
  }
}

/* ================= ROUTER / PAINT ================= */
function router(){
  var route = currentRoute();
  var parts = route.split('/');
  var top = parts[0];
  if(top==='team' && parts[1]) return renderTeam(decodeURIComponent(parts[1]));
  if(top==='standings') return renderStandings();
  if(top==='players') return renderPlayers();
  if(top==='playoffs') return renderPlayoffs();
  if(top==='records') return renderRecords();
  if(top==='news') return renderNews();
  if(top==='log' || top==='manage'){
    if(READONLY) return pageHead('Admin', 'Sign In Required') + '<div class="card">' + emptyState('Admin sign-in required', 'Use "Admin sign in" in the header to log game results or manage the league.') + '</div>';
    return top==='log' ? renderLogGame() : renderManagement();
  }
  return renderHome();
}
function paint(){
  if(!STATE) return; /* still loading — boot() owns the screen until data arrives */
  document.getElementById('app').innerHTML = shellHTML(router());
  var btn = document.getElementById('theme-toggle');
  if(btn) btn.onclick = toggleTheme;
}

/* ================= INIT ================= */
(function initTheme(){
  try{
    var saved = localStorage.getItem('rr-theme');
    if(saved==='light' || saved==='dark') document.documentElement.setAttribute('data-theme', saved);
  }catch(e){}
})();

document.addEventListener('click', onClick);
document.addEventListener('submit', onSubmit);
document.addEventListener('change', onChange);
document.addEventListener('input', onInput);
window.addEventListener('hashchange', function(){ paint(); window.scrollTo(0,0); });

async function boot(){
  document.getElementById('app').innerHTML = '<main class="container"><div class="empty" style="padding:80px 0"><div class="big">Loading&hellip;</div></div></main>';
  try{
    var sessionResult = await sb.auth.getSession();
    SESSION = sessionResult.data ? sessionResult.data.session : null;
  }catch(e){ SESSION = null; }
  READONLY = !SESSION;
  sb.auth.onAuthStateChange(function(event, session){
    SESSION = session || null;
    READONLY = !SESSION;
    authPanelOpen = false; authError = '';
    paint();
  });
  try{
    STATE = await loadState();
  }catch(e){
    console.error(e);
    document.getElementById('app').innerHTML =
      '<main class="container"><div class="card card-pad"><h2>Could not connect</h2>' +
      '<p class="subtle">The site could not load data from Supabase. Check that js/config.js has the correct project URL and key, and that your connection is online.</p>' +
      '<p class="subtle" style="font-size:12px">' + esc((e && e.message) || String(e)) + '</p></div></main>';
    return;
  }
  paint();
}
boot();
