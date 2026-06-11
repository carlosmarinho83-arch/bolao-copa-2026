// ─── Bolão Copa 2026 — Cloudflare Worker ──────────────────────────────────────
// Busca placar ao vivo da API-Football e salva no Firebase Firestore
// Intervalo real: 90 segundos (controlado internamente via KV)

const API_KEY = "44b7d885877640781a6ebfdf0dc66dc9";
const API_URL = "https://v3.football.api-sports.io";

// IDs dos jogos do Brasil — preencher após rodar /fixtures
const FIXTURE_IDS = {
  g1: null, // Brasil × Marrocos  — 13/06/2026
  g2: null, // Brasil × Haiti     — 19/06/2026
  g3: null, // Escócia × Brasil   — 24/06/2026
};

const FIREBASE_PROJECT = "bolao-copa-2026-ed8dc";
const FIREBASE_URL = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents`;

const THROTTLE_MS = 80 * 1000; // 1 minuto e 20 segundos

export default {
  // Cron: chamado a cada 1 minuto, mas só executa se passou 90s desde o último
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runWithThrottle(env));
  },

  // HTTP para testes e configuração
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/status") {
      const last = await env.BOLAO_KV?.get("lastPoll");
      return Response.json({ ok: true, lastPoll: last, fixtureIds: FIXTURE_IDS });
    }

    if (url.pathname === "/fixtures") {
      const data = await fetchFixtures();
      return Response.json(data);
    }

    if (url.pathname === "/search") {
      // Tenta encontrar jogos do Brasil por datas específicas
      const results = {};
      const searches = [
        { label: "team=6&season=2026&league=1", url: `${API_URL}/fixtures?team=6&season=2026&league=1` },
        { label: "team=6&season=2026", url: `${API_URL}/fixtures?team=6&season=2026` },
        { label: "league=1&season=2026", url: `${API_URL}/fixtures?league=1&season=2026` },
        { label: "date=2026-06-13&team=6", url: `${API_URL}/fixtures?date=2026-06-13&team=6` },
        { label: "live=all", url: `${API_URL}/fixtures?live=all` },
      ];
      for (const s of searches) {
        const res = await fetch(s.url, { headers: { "x-apisports-key": API_KEY } });
        const data = await res.json();
        results[s.label] = { count: data?.response?.length || 0, sample: data?.response?.slice(0,2) };
      }
      return Response.json(results);
    }

    if (url.pathname === "/poll") {
      const result = await pollAndUpdate(env);
      return Response.json(result);
    }

    return Response.json({ routes: ["/status", "/fixtures", "/search", "/poll"] });
  },
};

// ── Throttle via KV ───────────────────────────────────────────────────────────
async function runWithThrottle(env) {
  const now = Date.now();
  const lastStr = await env.BOLAO_KV?.get("lastPoll");
  const last = lastStr ? parseInt(lastStr) : 0;

  if (now - last < THROTTLE_MS) {
    console.log(`Throttled — ${Math.round((now - last) / 1000)}s desde último poll`);
    return;
  }

  await env.BOLAO_KV?.put("lastPoll", String(now));
  await pollAndUpdate(env);
}

// ── Poll principal ────────────────────────────────────────────────────────────
async function pollAndUpdate(env) {
  const results = [];

  for (const [gameId, fixtureId] of Object.entries(FIXTURE_IDS)) {
    if (!fixtureId) {
      results.push({ gameId, skipped: true, reason: "fixtureId não configurado" });
      continue;
    }

    try {
      const fixture = await fetchLiveFixture(fixtureId);
      if (!fixture) {
        results.push({ gameId, skipped: true, reason: "jogo não encontrado" });
        continue;
      }

      // Salva resultado no Firebase (coleção games)
      if (["FT", "AET", "PEN"].includes(fixture.status)) {
        await saveResult(gameId, fixture);
      }

      // Salva dados ao vivo (coleção live)
      await saveLiveData(gameId, fixture);

      results.push({
        gameId,
        home: fixture.homeName,
        away: fixture.awayName,
        score: `${fixture.homeScore}-${fixture.awayScore}`,
        minute: fixture.minute,
        status: fixture.status,
      });
    } catch (err) {
      results.push({ gameId, error: err.message });
    }
  }

  return { polledAt: new Date().toISOString(), results };
}

// ── API-Football ──────────────────────────────────────────────────────────────
async function fetchLiveFixture(fixtureId) {
  const res = await fetch(`${API_URL}/fixtures?id=${fixtureId}`, {
    headers: {
      "x-apisports-key": API_KEY,
    },
  });

  const data = await res.json();
  const f = data?.response?.[0];
  if (!f) return null;

  const status   = f.fixture.status.short;
  const homeScore = f.goals.home ?? 0;
  const awayScore = f.goals.away ?? 0;
  const minute    = f.fixture.status.elapsed ?? 0;

  const events = (f.events || [])
    .filter(e => ["Goal", "Card"].includes(e.type))
    .slice(-5)
    .map(e => ({
      icon:   e.type === "Goal" ? "⚽" : e.detail === "Yellow Card" ? "🟨" : "🟥",
      label:  e.type === "Goal" ? "Gol" : e.detail,
      player: e.player?.name || "",
      minute: e.time?.elapsed || 0,
    }));

  return {
    fixtureId,
    status,
    homeScore,
    awayScore,
    minute,
    events,
    homeName: f.teams.home.name,
    awayName:  f.teams.away.name,
    active: !["NS", "FT", "AET", "PEN", "CANC", "PST", "TBD"].includes(status),
  };
}

async function fetchFixtures() {
  const res = await fetch(`${API_URL}/fixtures?team=6&season=2026&league=1`, {
    headers: { "x-apisports-key": API_KEY },
  });
  const data = await res.json();
  return data?.response?.map(f => ({
    id:     f.fixture.id,
    date:   f.fixture.date,
    home:   f.teams.home.name,
    away:   f.teams.away.name,
    status: f.fixture.status.short,
  })) || [];
}

// ── Firebase Firestore ────────────────────────────────────────────────────────
async function saveResult(gameId, { homeScore, awayScore }) {
  await fetch(`${FIREBASE_URL}/games/${gameId}?updateMask.fieldPaths=homeScore&updateMask.fieldPaths=awayScore`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fields: {
        homeScore: { integerValue: homeScore },
        awayScore: { integerValue: awayScore },
      },
    }),
  });
}

async function saveLiveData(gameId, fixture) {
  await fetch(`${FIREBASE_URL}/live/current`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fields: {
        active:    { booleanValue: fixture.active },
        gameId:    { stringValue: gameId },
        homeScore: { integerValue: fixture.homeScore },
        awayScore: { integerValue: fixture.awayScore },
        minute:    { integerValue: fixture.minute },
        status:    { stringValue: fixture.status },
        homeName:  { stringValue: fixture.homeName },
        awayName:  { stringValue: fixture.awayName },
        events:    { stringValue: JSON.stringify(fixture.events) },
        updatedAt: { stringValue: new Date().toISOString() },
      },
    }),
  });
}
