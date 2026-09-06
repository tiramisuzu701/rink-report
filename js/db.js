/* Data access layer: talks to Supabase (Postgres + Auth) and maps rows
   to/from the camelCase shape the rest of the app (app.js) works with. */
(function () {
  "use strict";

  var sb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_KEY);
  window.sb = sb;

  function check(result) {
    if (result && result.error) throw new Error(result.error.message || "Request failed");
    return result ? result.data : undefined;
  }

  /* ---------- row <-> app-object mappers ---------- */
  function mapSeason(r) {
    return { id: r.id, name: r.name, startDate: r.start_date, isCurrent: r.is_current,
      pointsWin: r.points_win, pointsOTL: r.points_otl, pointsLoss: r.points_loss, createdAt: r.created_at };
  }
  function mapTeam(r) {
    return { id: r.id, name: r.name, shortName: r.short_name, abbr: r.abbr,
      colorPrimary: r.color_primary, active: r.active, divisionId: r.division_id, createdAt: r.created_at };
  }
  function mapDivision(r) {
    return { id: r.id, name: r.name, playoffCutoff: r.playoff_cutoff, createdAt: r.created_at };
  }
  function mapPlayer(r) {
    return { id: r.id, teamId: r.team_id, name: r.name, position: r.position,
      jersey: r.jersey, active: r.active, createdAt: r.created_at };
  }
  function mapGame(r) {
    return { id: r.id, seasonId: r.season_id, date: r.date, homeTeamId: r.home_team_id,
      awayTeamId: r.away_team_id, homeScore: r.home_score, awayScore: r.away_score,
      result: r.result, status: r.status, isPlayoff: r.is_playoff,
      playoffSeriesId: r.playoff_series_id, notes: r.notes, createdAt: r.created_at };
  }
  function mapStat(r) {
    return { id: r.id, gameId: r.game_id, playerId: r.player_id, teamId: r.team_id,
      isGoalie: r.is_goalie, goals: r.goals, assists: r.assists, goalsAgainst: r.goals_against };
  }
  function mapNews(r) {
    return { id: r.id, type: r.type, title: r.title, body: r.body, date: r.date, createdAt: r.created_at };
  }
  function mapBracket(r) {
    return { id: r.id, seasonId: r.season_id, seedCount: r.seed_count, bestOf: r.best_of,
      champion: r.champion_team_id, createdAt: r.created_at, series: [] };
  }
  function mapSeries(r) {
    return { id: r.id, bracketId: r.bracket_id, round: r.round, matchNumber: r.match_number,
      seedA: r.seed_a, seedB: r.seed_b, teamAId: r.team_a_id, teamBId: r.team_b_id,
      bestOf: r.best_of, winsA: r.wins_a, winsB: r.wins_b, winnerId: r.winner_id,
      status: r.status, nextSeriesId: r.next_series_id, nextSeriesSlot: r.next_series_slot };
  }
  function mapSettings(r) {
    return { leagueName: r ? r.league_name : "My Hockey League", tagline: r ? r.tagline : "" };
  }

  /* ---------- full-state load ---------- */
  async function loadState() {
    var results = await Promise.all([
      sb.from("seasons").select("*").order("created_at"),
      sb.from("teams").select("*"),
      sb.from("players").select("*"),
      sb.from("games").select("*"),
      sb.from("game_player_stats").select("*"),
      sb.from("news").select("*").order("date", { ascending: false }),
      sb.from("playoff_brackets").select("*"),
      sb.from("playoff_series").select("*"),
      sb.from("settings").select("*").eq("id", true).maybeSingle(),
      sb.from("divisions").select("*").order("name")
    ]);
    results.forEach(check);
    var brackets = (results[6].data || []).map(mapBracket);
    var seriesAll = (results[7].data || []).map(mapSeries);
    brackets.forEach(function (b) {
      b.series = seriesAll.filter(function (s) { return s.bracketId === b.id; })
        .sort(function (a, z) { return a.round - z.round || a.matchNumber - z.matchNumber; });
    });
    return {
      settings: mapSettings(results[8].data),
      seasons: (results[0].data || []).map(mapSeason),
      teams: (results[1].data || []).map(mapTeam),
      players: (results[2].data || []).map(mapPlayer),
      games: (results[3].data || []).map(mapGame),
      gamePlayerStats: (results[4].data || []).map(mapStat),
      news: (results[5].data || []).map(mapNews),
      playoffs: brackets,
      divisions: (results[9].data || []).map(mapDivision)
    };
  }

  /* ---------- writes (all gated server-side by RLS + admin_emails) ---------- */
  var DB = {
    async saveTeam(t) {
      var row = { name: t.name, short_name: t.shortName || null, abbr: t.abbr || null,
        color_primary: t.colorPrimary || "#1D5D8C", division_id: t.divisionId || null };
      if (t.id) check(await sb.from("teams").update(row).eq("id", t.id));
      else check(await sb.from("teams").insert(row));
    },
    async setTeamActive(id, active) { check(await sb.from("teams").update({ active: active }).eq("id", id)); },
    async deleteTeam(id) { check(await sb.from("teams").delete().eq("id", id)); },

    async saveDivision(d) {
      var row = { name: d.name, playoff_cutoff: (d.playoffCutoff === "" || d.playoffCutoff == null) ? null : d.playoffCutoff };
      if (d.id) check(await sb.from("divisions").update(row).eq("id", d.id));
      else check(await sb.from("divisions").insert(row));
    },
    async deleteDivision(id) { check(await sb.from("divisions").delete().eq("id", id)); },

    async savePlayer(p) {
      var row = { team_id: p.teamId, name: p.name, position: p.position, jersey: p.jersey };
      if (p.id) check(await sb.from("players").update(row).eq("id", p.id));
      else check(await sb.from("players").insert(row));
    },
    async setPlayerActive(id, active) { check(await sb.from("players").update({ active: active }).eq("id", id)); },
    async deletePlayer(id) { check(await sb.from("players").delete().eq("id", id)); },

    async deleteNews(id) { check(await sb.from("news").delete().eq("id", id)); },
    async postNews(n) { check(await sb.from("news").insert({ type: n.type, title: n.title, body: n.body, date: n.date })); },

    async logTrade(moves, headline, details) {
      for (var i = 0; i < moves.length; i++) {
        check(await sb.from("players").update({ team_id: moves[i].toTeamId }).eq("id", moves[i].playerId));
      }
      check(await sb.from("news").insert({ type: "trade", title: headline, body: details, date: todayISO() }));
    },

    async saveSettings(s) {
      check(await sb.from("settings").update({ league_name: s.leagueName, tagline: s.tagline }).eq("id", true));
      check(await sb.from("seasons").update({ points_win: s.pointsWin, points_otl: s.pointsOTL, points_loss: s.pointsLoss }).eq("id", s.seasonId));
    },

    async startNewSeason(s) {
      if (s.oldSeasonId) check(await sb.from("seasons").update({ is_current: false }).eq("id", s.oldSeasonId));
      check(await sb.from("seasons").insert({ name: s.name, is_current: true, points_win: s.pointsWin, points_otl: s.pointsOTL, points_loss: s.pointsLoss }));
    },

    async scheduleGame(g) {
      check(await sb.from("games").insert({ season_id: g.seasonId, date: g.date, home_team_id: g.homeTeamId, away_team_id: g.awayTeamId, status: "scheduled", notes: g.note || null }));
    },

    async logResult(g) {
      var gameRow = check(await sb.from("games").insert({
        season_id: g.seasonId, date: g.date, home_team_id: g.homeTeamId, away_team_id: g.awayTeamId,
        home_score: g.homeScore, away_score: g.awayScore, result: g.result, status: "final",
        is_playoff: g.isPlayoff, playoff_series_id: g.isPlayoff ? g.seriesId : null, notes: g.notes || null
      }).select().single());
      var gameId = gameRow.id;
      if (g.statsEntries.length) {
        var rows = g.statsEntries.map(function (s) {
          return { game_id: gameId, player_id: s.playerId, team_id: s.teamId, is_goalie: s.isGoalie, goals: s.goals, assists: s.assists, goals_against: s.goalsAgainst };
        });
        check(await sb.from("game_player_stats").insert(rows));
      }
      if (g.isPlayoff && g.seriesId) {
        var bracket = STATE.playoffs.filter(function (p) { return p.series.some(function (s) { return s.id === g.seriesId; }); })[0];
        var series = bracket ? bracket.series.filter(function (s) { return s.id === g.seriesId; })[0] : null;
        if (bracket && series) {
          var bracketCopy = clone(bracket);
          var seriesCopy = bracketCopy.series.filter(function (s) { return s.id === g.seriesId; })[0];
          applyGameToSeries(bracketCopy, seriesCopy, { homeTeamId: g.homeTeamId, awayTeamId: g.awayTeamId, homeScore: g.homeScore, awayScore: g.awayScore });
          check(await sb.from("playoff_series").update({
            wins_a: seriesCopy.winsA, wins_b: seriesCopy.winsB, status: seriesCopy.status, winner_id: seriesCopy.winnerId
          }).eq("id", g.seriesId));
          if (seriesCopy.status === "completed" && seriesCopy.nextSeriesId) {
            var next = bracketCopy.series.filter(function (s) { return s.id === seriesCopy.nextSeriesId; })[0];
            if (next) {
              var patch = {};
              if (seriesCopy.nextSeriesSlot === "A") patch.team_a_id = seriesCopy.winnerId; else patch.team_b_id = seriesCopy.winnerId;
              check(await sb.from("playoff_series").update(patch).eq("id", next.id));
            }
          }
          if (seriesCopy.status === "completed" && !seriesCopy.nextSeriesId) {
            check(await sb.from("playoff_brackets").update({ champion_team_id: seriesCopy.winnerId }).eq("id", bracketCopy.id));
          }
        }
      }
    },

    async createBracket(seasonId, seedCount, bestOf) {
      var existing = STATE.playoffs.filter(function (p) { return p.seasonId === seasonId; })[0];
      if (existing) check(await sb.from("playoff_brackets").delete().eq("id", existing.id));
      var bracket = generateBracket(seasonId, seedCount, bestOf);
      check(await sb.from("playoff_brackets").insert({ id: bracket.id, season_id: seasonId, seed_count: seedCount, best_of: bestOf }));
      var seriesRows = bracket.series.map(function (s) {
        return { id: s.id, bracket_id: bracket.id, round: s.round, match_number: s.matchNumber,
          seed_a: s.seedA, seed_b: s.seedB, team_a_id: s.teamAId, team_b_id: s.teamBId,
          best_of: s.bestOf, wins_a: 0, wins_b: 0, status: "pending", next_series_slot: s.nextSeriesSlot };
      });
      check(await sb.from("playoff_series").insert(seriesRows));
      var withNext = bracket.series.filter(function (s) { return s.nextSeriesId; });
      for (var i = 0; i < withNext.length; i++) {
        check(await sb.from("playoff_series").update({ next_series_id: withNext[i].nextSeriesId }).eq("id", withNext[i].id));
      }
    },
    async resetBracket(bracketId) { check(await sb.from("playoff_brackets").delete().eq("id", bracketId)); }
  };

  window.DB = DB;
  window.loadState = loadState;
})();
