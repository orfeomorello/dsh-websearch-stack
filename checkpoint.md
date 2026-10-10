# Checkpoint — dsh-websearch-stack

Ultimo aggiornamento: round 4 (ripresa dopo riattivazione della shell).

## Stato

- Shell PowerShell: funzionante (riattivata dall'utente). Node 24.14.0, npm 11.9.0, pnpm 12.9.1, git 2.42.0.
- Documenti spostati in `docs/` (`docs/analisi.md`, `docs/PLUGIN-GUIDE.md`).
- Versione DSH verificata: `@deepseek-ai/dsh` 0.2.0-rc.2 (npm dist-tag `latest`). `@deepseek-ai/cordis` 4.0.4.
- I `.d.ts` sono stati letti in `.tmp-inspect/` (cartella di lavoro, da eliminare prima del rilascio).
- Decisioni utente: `lib/` committato senza `prepare`; UI React rinviata; provider MVP Tavily, Parallel MCP, SearXNG; licenza MIT.

## Scoperte dalle API reali (0.2.0-rc.2) — correzioni al brief

Il brief descrive un'API che non corrisponde a quella installata. Seguo le `.d.ts`.

- Provider di ricerca: `WebSearchProvider { id: string; available(): boolean; search(request, signal?) }`.
  - Non esiste `isConfigured/test/meta` nel seam: `available()` deve essere locale e senza rete.
  - `WebSearchRequest { query, maxResults? }`.
  - `WebSearchResult { content?, sources: {url,title?,snippet?,publishedAt?}[], truncated }`. Non è `SearchResponse` del brief.
- Provider di fetch: `WebFetchProvider { id; available(); fetch(request, signal?) }`, risultato `{ url, statusCode, body: {kind:'html'|'text', content}, truncated }`.
- Registrazione: `ctx.web.registerSearchProvider(p)` / `registerFetchProvider(p)`, ritornano un disposer.
- Selezione (fatta da `WebRuntime`, non dal plugin): `searchProvider`/`fetchProvider` in config pinnano il provider; altrimenti serve esattamente un provider `available()`. Il plugin NON deve reimplementare il fallback a cascata: va fatto dentro un provider che fa da meta-provider, oppure lasciato al seam.
- `dsh-tool-web` registra già `web_search`/`web_fetch` su `ctx.web`. Il plugin non deve registrare tool.
- Errori: `WebError` (da `@deepseek-ai/dsh-web`) con `code` stringa aperta (es. `WEB_PROVIDER_ERROR`, `WEB_BLOCKED_URL`, `WEB_DUPLICATE_PROVIDER`).

## Decisioni di design derivate

- **Verificato nel seam**: senza `searchProvider` configurato, `WebRuntime` richiede UN SOLO provider `available()`; con più di uno lancia `WEB_PROVIDER_AMBIGUOUS`. Quindi NON si registrano più backend su `ctx.web`.
- Design scelto: il plugin registra UN solo `WebSearchProvider` con `id: 'websearch-stack'`. Dentro esegue la catena di fallback sui backend abilitati (Tavily → Parallel MCP → SearXNG, in ordine config). Questo sostituisce la "cascata" del brief e rispetta il seam.
- Il plugin imposta anche `searchProvider: 'websearch-stack'` nella propria config del patch, così non serve che l'utente lo pinni.
- Stato "disattivato": il provider non è registrato (o `available()` false) quando nessun backend è abilitato. In quel caso `web_search` ricade su quello che ha DSH.
- `dsh-web` e `cordis` vanno in `peerDependencies` **e** `devDependencies` alla versione esatta del host (`0.2.0-rc.2` / `~4.0.4`).
- `schemastery` e librerie non-dsh in `dependencies` (es. `@deepseek-ai/schemastery` ~3.18.4 come nel pacchetto reale).

## Piano

### Fase 0 — Preparazione (in corso)
- [x] Spostare `analisi.md` e `PLUGIN-GUIDE.md` in `docs/`
- [x] Shell funzionante
- [x] Verificare versione DSH 0.2.0-rc.2 e leggere `dsh-web`, `dsh-tool-web`
- [ ] Eliminare `.tmp-inspect/` a fine lavoro
- [ ] Creare `package.json`, `tsconfig.json`, `tsconfig.build.json`, `.gitignore`, `LICENSE` (MIT)

### Fase 1 — Core
- [ ] `src/types.ts` (tipi locali coerenti con `dsh-web`, non duplicati)
- [ ] `src/config.ts` (Schemastery con default)
- [ ] `src/utils/` (errori `WebError`, http con timeout e limite byte)
- [ ] Provider Tavily, Parallel MCP, SearXNG
- [ ] `src/index.ts`: `name`, `inject: ['web']`, `apply` con registrazione
- [ ] `cordis.patch.yml` con `id` = `name`

### Fase 2 — Test
- [ ] Unit test dei provider (mock HTTP locale)
- [ ] Smoke test pacchetto (`main`/`exports` esistenti, `id` patch = `name`)

### Fase 3 — Provider restanti
- [ ] Exa, TinyFish, Brave, Jina — rinviati a dopo MVP se la complessità lo richiede (l'utente ha chiesto "tutto", da confermare)

### Fase 4 — Packaging e rilascio
- [ ] `lib/` committato; CI che fallisce se `lib/` è stantio
- [ ] `README.md`, `LICENSE`
- [ ] Verifica boot profilo disposable (install → dump-config → boot)

### Fase 5 — UI
- [ ] Pagina Settings (rinviata: fuori MVP)

## Avanzamento (round 4)

- [x] Scaffold: `package.json`, `tsconfig.json`, `tsconfig.build.json`, `LICENSE` (MIT), `.gitignore`, `cordis.patch.yml`
- [x] `src/config.ts` (Schemastery con default, usa `Schema.object/array/union/const`)
- [x] `src/http.ts` (richiesta con timeout fuso al signal, limite byte, `WebError` con codici `WEB_*`)
- [x] Backend: `tavily.ts`, `parallel-mcp.ts` (JSON-RPC diretto), `searxng.ts`
- [x] `src/stack.ts`: `StackSearchProvider` con fallback su codici recuperabili
- [x] `src/index.ts`: `name`, `inject = ['web']`, `Config`, `apply`
- [x] `npm install` ok, `typecheck` ok (exit 0)
- [x] Script build `scripts/build.mjs` (riscrive `.ts`→`.js` anche nei `.d.ts`); `lib/` generato
- [x] Test: `npm test` → 23/23 passano (stack, backend con server locale, smoke pacchetto)
- [x] Smoke pacchetto: `main`/`exports` esistono, `id` patch = `name` esportato
- [x] Install nel profilo di prova `dsh-wesearch-test` (link locale): `--dump-config` mostra la patch, `--dump-config-schema` senza errori di risoluzione
- [~] Boot reale del profilo: avviato come job di background (`pwsh-31`), da verificare
- [ ] Verifica con servizi reali (Tavily keyless, Parallel MCP): non fatta, non c'è rete nel round
- [ ] Decidere fate di `enabled_providers` default: ora `['tavily','parallel-mcp']` (SearXNG va attivato con URL)
- [ ] README.md
- [ ] Eliminare `.tmp-inspect/`

**Da verificare contro il servizio reale**: header keyless di Tavily, endpoint e formato JSON-RPC di Parallel MCP. Sono implementati dal brief, non confermati dalla documentazione letta.

## Log dei round

- Round 1–3: shell non disponibile (exit 3221225794). Nessun avanzamento. Goal bloccato al round 3.
- Round 4: shell disponibile. Verificate versioni e API. Analisi del seam completata. Prossimo: scaffold e provider.
- Round 4 (seguito): scaffold, 3 backend, stack di fallback, index.ts, build lib/, 23 test verdi, typecheck ok, install di prova con `dsh plugin add` + `--dump-config` ok. Profilo di prova rimosso. README scritto. Repo git inizializzato, commit `b5c62ef`. `lib/` verificato allineato a `src/` dopo rebuild.

## Round 5

- Aggiunto backend `brave` (documentato: `GET /res/v1/web/search`, header `X-Subscription-Token`, `web.results[]`). Chiave da env `BRAVE_SEARCH_API_KEY`: il pacchetto `dsh-web` non espone un servizio credenziali.
- 25/25 test verdi, typecheck ok, `lib/` allineato a `src/`. Commit `8549499`.
- **Exa**: documentazione letta solo parzialmente (pagina troncata prima del body). Non implementato: serve la pagina completa dei parametri.
- **TinyFish**: nessuna fonte ottenuta (la ricerca web non restituisce risultati). Non implementato.
- **Jina** (fetch): non implementato; il fetch di DSH è già coperto da `dsh-web-fetch-http`.
- **UI**: non iniziata.
- Ricerca web: il provider DSH nativo richiede `DEEPSEEK_API_KEY`, quindi non è usabile per verificare i provider dal sistema.

## Round 13

- Tentativo di verifica SearXNG: Docker CLI presente, ma il daemon non è in esecuzione (pipe `docker_engine` assente, richiede privilegi elevati). Nessuna escalation richiesta: SearXNG resta non verificato.
- Nessun remote git configurato: il push richiede l'owner GitHub.
- Nessuna modifica al codice in questo round.

## Round 12

- CI aggiunta: `.github/workflows/ci.yml` (typecheck, test, build, fallisce se `lib/` non corrisponde a `src/`). Commit `8906e4b`.
- Logica del controllo verificata in locale: lib pulito passa, modifica a `src` senza rebuild viene rilevata, ripristino pulito.
- Il workflow non è ancora eseguito su GitHub: serve il push (vedi decisioni aperte).

## Round 11

- Profilo `web` di default: include `web-search-deepseek` e `web-fetch-http`.
- `web-search-deepseek.available()` richiede chiave, token account o `resolveApiKey`. Senza `DEEPSEEK_API_KEY` non è utilizzabile: lo stack è l'unico candidato.
- **Limite noto**: con `DEEPSEEK_API_KEY` impostata, il seam risponde `WEB_PROVIDER_AMBIGUOUS` finché `searchProvider` non è pinnato nel servizio `web` (non nel plugin). Documentato nel README. Il plugin non può impostarlo da solo.
- Nessuna modifica al codice in questo round: analisi e documentazione.

## Round 10

- Endpoint verificati live senza chiave: Brave 422, Exa 402, TinyFish 401. Gli URL sono corretti.
- Errori HTTP ora mappati per codice: 401/403 → `WEB_AUTH_FAILED`, 402 → `WEB_CREDITS_EXHAUSTED`, 429 → `WEB_RATE_LIMITED`. Tutti e tre sono recuperabili per il fallback. Commit `91c7145`.
- Rimosso un limite di rate ("30 req/min") nel commento TinyFish: non verificato.
- 29/29 test verdi. `lib/` allineato.
- Restano non verificati con chiave reale: Brave, Exa, TinyFish. SearXNG non verificato (serve istanza).

## Round 9 — verifica su servizi reali

- **Tavily keyless**: verificato live (HTTP 200, 3 fonti reali). Backend OK.
- **Parallel MCP**: il backend era SBAGLIATO (usava `query`/`max_results`, inesistenti). Corretto da `tools/list` live: `objective` + `search_queries` (array), risultato `structuredContent.results[]` con `url`, `title`, `publish_date`, `excerpts[]`. Verificato live (3 fonti). Commit `2e1b7d8`.
- 27/27 test verdi, typecheck ok, `lib/` allineato.
- Brave, TinyFish, Exa: NON verificati live (mancano le chiavi API).
- SearXNG: NON verificato (serve un'istanza locale).

## Round 8 — analisi UI (nessun codice scritto)

- Letta la struttura dei plugin client di DSH in `dsh-client-ui-settings-web-search` (0.2.0-rc.2), scaricata in `%TEMP%` fuori dal repo.
- Contratto UI: `package.json` con `dsh.client { inject, platform: "web" }`, bundle `lib/client.js` esposto come `exports["./client"]`, `apply(ctx)` che registra un contributo allo slot `settings.plugins.tab` con `id`, `order`, `label`.
- Il pacchetto di riferimento usa `tsdown` per il bundle, non un preset interno.
- **Decisione rinviata**: la card scrive le chiavi tramite il servizio `remote.credentials` del Host. Non l'ho verificato per il nostro plugin, e la UI non è testabile senza il web client in esecuzione. Non scrivo codice non verificato per il salvataggio di segreti.
- Il backend funziona già via variabili d'ambiente e `cordis.patch.yml`; la UI è un miglioramento, non un prerequisito.

## Round 7

- Exa implementato dalla specifica JSON completa (https://exa.ai/docs/exa-spec.json): `POST https://api.exa.ai/search`, header `x-api-key`, `query` obbligatorio, `numResults` 1–100, `type: auto`, `contents.highlights`. Risposta `results[]`: `title` e `url` obbligatori, `publishedDate`, `highlights`. Chiave da env `EXA_API_KEY`. Commit `4c8592c`.
- 27/27 test verdi, typecheck ok, `lib/` allineato a `src/`.
- Provider coperti: Tavily, Parallel MCP, SearXNG, Brave, TinyFish, Exa (6 di 7 della lista del brief).
- Restano: Jina (decisione: è fetch, non search; il fetch di DSH è `dsh-web-fetch-http`), UI, verifica su servizi reali.

## Round 6

- Aggiunto backend `tinyfish`: `GET https://api.search.tinyfish.ai?query=`, header `X-API-Key`, chiave da env `TINYFISH_API_KEY`. Fonte: https://docs.tinyfish.ai/search-api/reference. Commit `535887c`.
- 26/26 test verdi, typecheck ok, `lib/` allineato a `src/`.
- **Exa**: NON implementato. Dalla specifica OpenAPI (https://exa.ai/docs/exa-spec.yaml) il testo ottenuto è troncato e non contiene i componenti `SearchRequest`/`SearchResponse`, quindi non posso confermare i campi di request e response. Serve la specifica completa (es. file `exa-spec.json`).
- **Jina**: non implementato. Il fetch è coperto da `dsh-web-fetch-http`; decisione da confermare con l'utente.
- **UI**: non iniziata.
- **Servizi reali**: nessun backend è stato chiamato contro il servizio live (manca la chiave; la ricerca web del provider DSH nativo richiede `DEEPSEEK_API_KEY`).

## Stato finale del round 4

- Repo git: commit `b5c62ef` su `main`, working tree pulito.
- Restano: verifica con servizi reali (Tavily keyless, Parallel MCP), UI (rinviata), CI per `lib/` stantio, push su GitHub (serve owner), boot completo del profilo.

## Note tecniche da verificare

- `analisi.md` §12 (mappa `plugins:`) contrasta con la guida §3 (array `insert:`): seguo la guida.
- `trafilatura` è Python: non usarlo. Il fetch locale resta fuori MVP (il seam ha già `dsh-web-fetch-http`).
- Il brief chiede `WebSearchResponse` e `test()` su ogni provider: l'API reale non li prevede. Il test di connessione va fatto come chiamata `search` reale nel comando o nel test.
