# Smart Money Backend

Backend Node.js + Express que sirve **cuotas reales en vivo** desde casas de apuestas (Pinnacle, Bet365, DraftKings, William Hill, …) vía **The Odds API**, y las agrega en indicadores Smart Money (% sharp, % ticket, edge, RLM, STEAM, veredicto) consumibles por los frontends `Parley_Tata_Iraka_2026-27.html` y `Parley_Linemate_2026-27.html`.

## 🎯 Qué hace

1. **Consulta cuotas reales** desde The Odds API (la única API legal y con plan gratuito que agrega casas de apuestas).
2. **Agrega bookmakers sharp vs público**: usa Pinnacle/Circa como referencia sharp y DraftKings/FanDuel/Bet365 como público.
3. **Calcula indicadores Smart Money** en el mismo formato que Pinnacle / Circa / Sports Insights:
   - `sharpPct` — % del dinero en cada lado desde bookies sharp
   - `ticketPct` — % de boletas (cantidad) en cada lado
   - `edgePct` — diferencia entre prob. implícita sharp y pública
   - `rlm` — Reverse Line Movement (bandera)
   - `steam` — movimiento coordinado sharp (bandera)
   - `verdict` — BUY / WATCH / HOLD / AVOID
4. **Guarda snapshots históricos** cada 10 min (configurable) para detectar RLM/STEAM basados en movimiento real de cuotas.
5. **Cache TTL** (default 60s) para no agotar la cuota gratuita de The Odds API.

## 🚀 Arranque rápido (DEMO_MODE, sin API key)

```bash
cd backend
npm install
cp .env.example .env
# Edita .env y pon DEMO_MODE=true (ya viene así)
node src/seed.js 5   # opcional: genera 5 snapshots históricos de prueba
node src/test.js     # smoke-test (29/29 debe pasar)
npm start            # arranca en http://localhost:8787
```

En DEMO_MODE el servidor devuelve datos sintéticos pero coherentes (mismas estructuras que la API real), para que puedas desarrollar el frontend sin consumir cuota.

## 🔑 Arranque con API real (LIVE)

1. **Regístrate** en https://the-odds-api.com/ (plan free: 500 req/mes).
2. Copia tu API key.
3. Edita `backend/.env`:

```env
DEMO_MODE=false
ODDS_API_KEY=tu_api_key_real
ODDS_API_REGION=eu            # us | eu | uk | au
ODDS_API_MARKETS=h2h,spreads,totals
BOOKMAKERS=pinnacle,bet365,williamhill,unibet   # opcional, vacío = todos
CACHE_TTL=60                  # segundos
SNAPSHOT_INTERVAL=600         # 10 min
```

4. Arranca: `npm start`
5. Verifica cuota restante: `curl http://localhost:8787/api/quota`

## 📡 Endpoints

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/health` | Estado del servidor + cuota restante |
| GET | `/api/sports` | Deportes soportados por The Odds API |
| GET | `/api/leagues` | Mapeo `liga_frontend → sport_key` + bookmakers sharp/público |
| GET | `/api/odds/:sportKey` | Cuotas raw de una liga |
| GET | `/api/odds/:sportKey/sm` | Cuotas + análisis smart money de una liga |
| GET | `/api/smart-money` | Análisis agregado de TODAS las ligas soportadas |
| GET | `/api/smart-money/:league` | Análisis de una liga concreta (`LaLiga`, `Premier`, `NFL`, …) |
| GET | `/api/historical/:sportKey` | Último snapshot histórico |
| GET | `/api/quota` | Cuota restante de The Odds API |
| POST | `/api/cache/clear` | Vacía la cache (admin) |

### Ejemplo de respuesta de `/api/smart-money/LaLiga`

```json
{
  "league": "LaLiga",
  "sportKey": "soccer_spain_la_liga",
  "count": 24,
  "rows": [
    {
      "eventId": "...",
      "homeTeam": "Atlético Madrid",
      "awayTeam": "Sevilla",
      "commenceTime": "2026-11-15T...",
      "market": "h2h",
      "selection": "Atlético Madrid",
      "sharpOdds": 1.57,
      "publicOdds": 2.27,
      "sharpPct": 65,
      "ticketPct": 17,
      "edgePct": 18.4,
      "rlm": false,
      "steam": false,
      "verdict": "WATCH",
      "sharpSources": ["pinnacle"],
      "publicSources": ["pinnacle","bet365","williamhill","unibet","betclic","betway"]
    }
  ]
}
```

## 🗺️ Mapeo de ligas

| Frontend | The Odds API sport_key |
|---|---|
| `LaLiga` | `soccer_spain_la_liga` |
| `Premier` | `soccer_epl` |
| `SerieA` | `soccer_italy_serie_a` |
| `Bundesliga` | `soccer_germany_bundesliga` |
| `Ligue1` | `soccer_france_ligue_one` |
| `NFL` | `americanfootball_nfl` |
| `NBA` | `basketball_nba` |
| `MLB` | `baseball_mlb` |
| `UCL` | `soccer_uefa_champs_league` |
| `UEL` | `soccer_uefa_europa_league` |

## 🏷️ Bookmakers por categoría

- **Sharp** (referencia de valor real): `pinnacle`, `circa`, `westgate`, `betonline`
- **Público** (masivo, carga al favorito): `draftkings`, `fanduel`, `betmgm`, `williamhill`, `bet365`

Configurables en `config.js` (`BOOKIES_SHARP`, `BOOKIES_PUBLIC`).

## 📁 Estructura

```
backend/
├── package.json
├── .env.example
├── .env                     # (no commitear)
├── README.md
├── data/
│   └── historical/          # snapshots JSON (se autogenere cada SNAPSHOT_INTERVAL)
│       └── {sportKey}/{YYYY-MM-DD}/{HH-mm}.json
└── src/
    ├── server.js            # Express + endpoints + job de snapshot
    ├── config.js            # variables de entorno
    ├── leagues.js           # mapeo liga → sport_key
    ├── cache.js             # TtlCache en memoria
    ├── oddsApiClient.js     # cliente The Odds API v4
    ├── demoData.js          # datos sintéticos para DEMO_MODE
    ├── smartMoneyAnalyzer.js# núcleo: sharp %, ticket %, edge, RLM, STEAM
    ├── historicalStore.js   # snapshots en disco + diff para RLM/STEAM
    ├── test.js              # smoke-test (29 checks)
    └── seed.js              # genera N snapshots históricos en DEMO
```

## 🌐 Conectar el frontend

En los HTML (`Parley_Tata_Iraka_2026-27.html` y `Parley_Linemate_2026-27.html`) ya está integrado el toggle "📈 Live / 🧮 Modelo" en la sección Smart Money. Al activar "Live", el frontend consulta `GET http://localhost:8787/api/smart-money/:league` en vez del modelo determinista local.

**Configurable** en el HTML: busca `window.SM_BACKEND_URL` y apúntalo a tu servidor:

```js
window.SM_BACKEND_URL = 'http://localhost:8787';   // desarrollo local
// window.SM_BACKEND_URL = 'https://api.midominio.com';   // producción
```

## ⚙️ Producción

Para desplegar en un VPS / contenedor:

```bash
# 1. Clona el repo en el servidor
git clone <repo> /opt/parley-backend
cd /opt/parley-backend/backend

# 2. Instala y configura
npm install --omit=dev
cp .env.example .env
# Edita .env con tu ODDS_API_KEY real y CORS_ORIGINS=https://midominio.com

# 3. Arranca con PM2 (o systemd)
npm install -g pm2
pm2 start src/server.js --name smartmoney
pm2 save && pm2 startup

# 4. Proxy inverso con nginx + HTTPS
# Servir /api/* en https://midominio.com/api/*
```

Ejemplo de configuración **nginx**:

```nginx
server {
  listen 443 ssl http2;
  server_name api.midominio.com;

  ssl_certificate     /etc/letsencrypt/live/api.midominio.com/fullchain.pem;
  ssl_certificate_key  /etc/letsencrypt/live/api.midominio.com/privkey.pem;

  location / {
    proxy_pass http://127.0.0.1:8787;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

Y en el frontend:

```js
window.SM_BACKEND_URL = 'https://api.midominio.com';
```

## ⚠️ Limitaciones

- **Cuota The Odds API**: 500 req/mes en plan free. Con `CACHE_TTL=60s` y 8 ligas, consumes ~8 req/min = ~480/h = cuota agotada en ~1h de uso continuo. Para uso serio, pasa a plan de pago (~$50/mes para 5000 req/mes).
- **RLM/STEAM reales**: solo se detectan tras tener al menos 2 snapshots separados por `SNAPSHOT_INTERVAL` (default 10 min). En arranque limpio, los primeros 10 min no hay histórico.
- **Bookmakers por región**: `eu` no incluye `draftkings`/`fanduel` (son US). Si quieres sharp US (`circa`, `westgate`), usa `ODDS_API_REGION=us`.
- **DEMO_MODE**: los datos son sintéticos. Sirven para validar la integración frontend↔backend, no para tomar decisiones reales de apuesta.

## 📊 Smoke-test

```bash
node src/test.js
```

Salida esperada: `29 OK · 0 FAILED`.
