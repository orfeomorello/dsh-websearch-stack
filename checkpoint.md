# Checkpoint — dsh-websearch-stack

Ultimo aggiornamento: round 21 (README revisionato: superficie di configurazione reale, SearXNG self-hosted, metadata GitHub).

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

## Round 14

- README riallineato allo stato reale: sei backend, verificati live solo Tavily keyless e Parallel MCP. Rimosso "3 backend".
- Esempio YAML del README corretto alla forma `insert:` + `config:` della guida, marcato come da verificare con `dump-config`.
- **Bug corretto**: Tavily aveva `apiKey: undefined` fisso, quindi `TAVILY_API_KEY` era ignorata. Ora legge la variabile d'ambiente, come gli altri backend.
- 29/29 test verdi, typecheck ok.

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

## Round 15 — UI Settings (card client web)

- Scompartito in dettaglio il pacchetto di riferimento `dsh-client-ui-settings-web-search` 0.2.0-rc.2: il formato bundle è `window.__ModuleLoader__.load({ id, factory })` con modulo CommonJS dentro e `require` dal registry del client.
- Verificato il contratto reale dei pacchetti 0.2.0-rc.2: slot confermato **`plugins.bundle.config`** (keyed col nome del pacchetto; `plugins.item` è riservato ai plugin ufficiali), primitives `SettingsSecretField`, remote `credentials` con `describe`/`set`/`unset` + evento `credentials/reference-updated` (dsh-api-remotes 0.2.0-rc.2).
- Servizio credenziali del Host: `@deepseek-ai/dsh-credentials` (`describe` → `{configured, source?, writable}`, mai il valore) con provider file `~/.dsh/.credentials.yaml` (`dsh-credentials-local`): ambiente read-only preminente.
- Deciso con l'utente: la card gestisce SOLO le API keys (Tavily, Brave, TinyFish, Exa), non enabled_providers/SearXNG URL (restano via YAML).
- Scritto `src/client/card.ts` (store snapshot, controller describe/set con bozze staged, salvataggio multiplo, componente React con `createElement`, `apply` che registra dictionary + invalidation + slot).
- **Injection declarations aggiunte** (fix): `package.json` aggiunge `@deepseek-ai/dsh-client-ui-renderer` all'inject (necessario per la rendering del card). `src/client/card.ts` espone `inject = ['locale', 'slots', 'remote', 'remote.credentials']` per rispettare i guard di injection di cordis (accesso a proprietà context senza la dichiarazione fallisce prima di `apply`).
- `scripts/bundle-client.mjs`: traspile con tsc (commonjs) e wrap nel formato ModuleLoader; produce `lib/client.js` + `lib/client/card.d.ts`. `npm run build` ora genera anche il bundle; `src/client` escluso dalla build host.
- package.json: `exports["./client"]`, `dsh.client { platform: web, inject: [locale, ui-settings, ui-renderer, ui-plugin-manager, api-remotes] }`, devDeps react + primitives + client-locale.
- Test del bundle: 4 test (formato loader, registrazione slot keyed, inject face, describe iniziale). Test totali: **33 verdi**, typecheck ok.
- **Limite**: la card non è mai stata caricata dentro il web client reale (serve un client in esecuzione): smoke test solo su stub vm.
- Scartata la strada `ctx.configForms` (esiste solo per namespace di provider; un bundle non ne ha uno) e `ctx.credentials` diretto (tecnicamente disponibile ma il client usa il remote; i pacchetti client non importano dsh-credentials).

## Round 16 — UI fix pushed su GitHub

- **Fix del non caricamento del client**: aggiunto l'inject del renderer (`dsh-client-ui-renderer`) e le declaration di injection (`inject` con `locale`, `slots`, `remote`, `remote.credentials`) nel card. Il formato ModuleLoader era corretto; il problema era i guard di injection di cordis che non prevedevano le proprietà consume.
- Rigenerato gli artifacti: `npm run build` produce `lib/client.js` (10706 bytes) e `lib/client/card.d.ts` (3350 bytes).
- Commit `f217f9b` ("Add client renderer inject and card inject declarations (injection guards)") pubblicato su GitHub con `git push origin main`.
- Verificato: remote HEAD e main = `f217f9b`, identici con local, "main pushes to main (up to date)", working tree pulito.
- Test: 33/33 verdi, typecheck pulito.

## Round 17 — Card: form disabilitata e bottoni senza spazi (fix)

- **Sintomo riportato dall'utente nel web client reale**: configurazione del plugin visibile, ma tutti i campi provider disabilitati (non scrivibili) e Save/Discard disabilitati e attaccati senza spazi.
- **Causa 1 (tutto disabilitato)**: `ctx.remote.credentials.describe()` risolve un `RemoteResult` (`{ ok, value }`), non il record dei fatti. Il codice leggeva l'envelope: `answer[ref]` era `undefined` per ogni ref → `writable:false` ovunque → campi disabilitati; `ready` comunque true, `dirty` false → Save/Discard disabilitati. Verificato contro i pacchetti ufficiali 0.2.0-rc.2: descriptor `credentials/describe` in `@deepseek-ai/dsh-api-remotes/lib/client.js` (risultato `record(string(), {configured, source?, writable})`) e card ufficiale `@deepseek-ai/dsh-client-ui-settings-web-search`, che fa `if (!response.ok) return; const view = response.value[ref]` con default `writable: true`.
- **Causa 2 (bottoni)**: `CardBody` creava due `<button>` nudi (nessuna className, nessun contenitore) come figli di una `div` vuota: bottoli nativi senza stile né spaziatura. Sostituiti dal frame condiviso `SettingsForm` delle primitives (colonna `.form`, footer flex con `gap: 8px`, save stilizzato, riga di errore). Rimosso il bottone Discard manuale: il frame scarta le bozze allo unmount, come fa la card ufficiale.
- **Altre correzioni**: una risposta `{ ok: false }` di `set` conta ora come scrittura fallita (prima il `try/catch` non scattava mai: un Remote non rigetta per contratto). Retry con backoff (250ms/1s/4s) se l'Host non ha ancora servito il Remote al mount, più reload su `connection/reset`.
- Test: +6 di regressione sul bundle (envelope RemoteResult, record plain, retry, write rifiutata che conserva la bozza, rendering nel frame). **39/39 verdi**, typecheck pulito, `lib/` rigenerato.

## Round 21 — README obsoleto: cosa si configura davvero, e come

- **Osservazione utente**: dalla pagina dei setting non si configura nulla (né la catena né `searxng_url`), e il README andava rivisto/arricchito.
- **Verifiche fatte**:
  - `@deepseek-ai/dsh-client-ui-plugin-manager@0.2.0-rc.2` (`lib/client.js`): `PackageDetail` renderizza `plugins.bundle.config` con `{ view: "page" }` **senza** `form`; il `form` lo riceve solo `plugins.row.config` (e `plugins.item`). Quindi i campi volatile del plugin non hanno widget nella UI: un bundle non ottiene una forma di config. La card esistente (chiavi) sì, perché è lei a renderli.
  - Volatile = riferimento riscritto in posto (`schemastery` `createVolatile`: `get` + simbolo `write`): un writer (form/CLI) aggiorna il valore e i reader lo vedono alla richiesta successiva. Il plugin espone solo `get` (`src/config.ts` wrappa ogni campo).
  - Shape della config di boot verificata con `dsh --profile dsh-wesearch-probe --patch probe-config.yml --dump-config`: la row `websearch-stack` accetta `config:` con `enabled_providers` e `searxng_url` (compare nel dump). Layer del profilo: `$DSH_HOME/profiles/<profile>/cordis.patch.yml`; overlay `--patch` applicato per ultimo (5 layer, `dsh-base` primo).
  - SearXNG: docs ufficiali (2026.10.9) — `search.formats` di default è solo `html`, va aggiunto `json`; installazione docker consigliata via compose (`container/docker-compose.yml` + `.env.example`, config in `core-config/settings.yml`). Backend: `GET <base>/search?q=…&format=json&language=en` (language fisso `'en'` in `src/index.ts`).
- **README riscritto nelle sezioni**: Features (tolto il claim falso "editable from the Plugins page"), Configuration (tabella delle due superfici: chiavi live dalla pagina, tutto il resto boot-time dalla patch del profilo; esempi verificati con `--patch` e file), nuova **Quick start** (default chain funziona senza chiavi), **SearXNG** (docker + json format + `searxng_url` + limiti), "How the fallback works" (niente più "reordering on the Plugins page"), "UI status" e Known limitations (la forma di config per bundle non è renderizzata dall'host; `plugins.row.config` chiuderebbe il gap — feature futura, non implementata).
- **GitHub**: descrizione aggiornata (keyless default + seam + chain + chiavi dalla pagina) e topic aggiunti via `gh repo edit` (dsh, dsh-plugin, deepseek-harness, web-search, tavily, searxng).
- Nessun cambiamento di codice: solo README, checkpoint e metadata del repo. Test/typecheck invariati (52/52).

## Round 20 — Pagina plugin poco chiara; ogni provider con nome + link al sito

- **Richiesta utente**: sulla pagina di dettaglio del plugin si legge solo nome/versione/descrizione ("non è molto chiaro"); ogni provider dovrebbe avere un nome e un link al sito proprietario per configurarlo.
- **Come funziona davvero la pagina** (verificato contro `@deepseek-ai/dsh-client-ui-plugin-manager@0.2.0-rc.2`, `lib/client.js` + `lib/types/client/slot-contract.d.ts`, e `readPluginMeta` in `@deepseek-ai/dsh-app-boot@0.2.0-rc.2` `lib/index.js` ~righe 1900-1995):
  - `PackageDetail` mostra: titolo (`packageText`: `meta.title` con fallback a `pkg.name`), tag `v{version}`, `<code>{pkg.name}</code>`, descrizione (`meta.description` con fallback a `package.json.description`), poi `plugins.bundle.config` (la card), le righe, infine `plugins.detail.section`.
  - `meta` lo costruisce l'Host con `readPluginMeta`: legge `<pkg>/locale/en.json` (`meta.title`, `meta.description`; altri file lingua nella stessa dir) e `package.json` (`name`/`description`/`icon`). Senza quel file il titolo è il nome tecnico del pacchetto — il "nome ripetuto" che vedeva l'utente.
  - `plugins.detail.section` è uno slot "list" con `subject = {kind:'bundle'|'row'|'item', ...}`; la entry disegna il proprio chrome e restituisce `null` per soggetti che non la riguardano.
- **Fix**:
  1. `locale/en.json` (nuovo) + export `"./locale/*"` + `locale` in `files`: titolo "Web Search Stack" e descrizione chiara. Verificato con replay fedele di `readPluginMeta`: restituisce `{title:{en:'Web Search Stack'}, description:{en:...}}`. La self-reference `import.meta.resolve('dsh-websearch-stack/locale/en.json')` risolve, quindi l'export map è corretta.
  2. `plugins.detail.section` registration in `src/client/card.ts`: sezione "Search providers" con una riga per backend (id nell'ordine del vocabolario `enabled_providers`): nome leggibile, tag requisito (`API key` / `API key optional` / `No key needed` / `Self-hosted instance`) e link al sito del proprietario. Link verificati live (HTTP 200): app.tavily.com/home, docs.parallel.ai, docs.searxng.org, brave.com/search/api, docs.tinyfish.ai/search-api/reference, exa.ai (search.parallel.ai dà 404: escluso).
  3. Card: i quattro campi chiave ora si chiamano `Tavily API key`, `Brave Search API key`, `TinyFish API key`, `Exa API key` (prima `Key (tavily)` ecc.).
- **Verifiche**: `npm run build` (lib + client bundle), `npm run typecheck` pulito, `npm test` 52/52. Nuovi test: registrazione della sezione, 6 righe con un link https ciascuna (target `_blank`, rel `noreferrer noopener`), `null` per soggetti estranei, nomi dei campi, `locale/en.json` valido + export map + risoluzione Node. Commit da fare.
- Nota di stile: la sezione usa inline style con i token CSS del client (`--dsw-alias-label-primary`, `--dsw-alias-brand-primary`) perché i plugin non possono usare i CSS module hash-ati della pagina host.

## Round 19 — Bug: ricerca web instradata al provider DeepSeek nativo

- **Sintomo riportato dall'utente**: plugin abilitato, ma `web_search` fallisce con "DeepSeek non dispone di una API key configurata (DEEPSEEK_API_KEY)". Il provider del plugin viene registrato ma non viene mai selezionato.
- **Causa radice (verificata contro l'host installato, `@deepseek-ai/dsh` 0.1.2-rc.1 in `%APPDATA%\npm`, profilo `web`)**:
  1. `@deepseek-ai/dsh-base` pinna `web.searchProvider: deepseek-official` (row `web`, `cordis.patch.yml` di dsh-base riga ~450). Il seam `ctx.web` (`@deepseek-ai/dsh-web` `WebRuntime.resolveProvider`) seleziona SOLO il provider pinnato: senza pin ne serve uno solo `available()`.
  2. `web-search-deepseek` (`dsh-web-search-deepseek/lib/index.js`) ha `available()` **true anche senza chiave**: la condizione è `(apiKey?.length ?? 0) > 0 || resolveApiKey !== void 0`, e `resolveApiKey` è sempre definito da `resolveOptions`. La chiave viene risolta per-search in `search()`, che lancia `WEB_PROVIDER_CREDENTIAL_MISSING`. Quindi il fail avviene a ricerca, non a selezione.
  3. Conseguenza: la documentazione precedente (README round 11/18) era sbagliata su entrambi i punti — senza `DEEPSEEK_API_KEY` il provider nativo resta "usabile" per il seam, e con la chiave non è mai ambiguo (è sempre lui, perché è pinnato).
- **Fix**: `cordis.patch.yml` del bundle ora overridea la row `web` (override per `id`, senza wrapper `insert`: `applyEntryPatches` in `@deepseek-ai/dsh-app-boot`/`cordis-plugin-include`) con `config: { searchProvider: websearch-stack, fetchProvider: http }`. `config` è sostituito intero (mai deep-merge), quindi `fetchProvider: http` è ristabilito come nella row di base. Layer del bundle applicato dopo `dsh-base` (`dsh plugin add` appende in coda a `dsh.profile.bundles`); profilo/home patch e `--patch` restano layer successivi e possono ribaltare il pin.
- **Verifiche**:
  - `dsh --profile dsh-wesearch-probe --dump-config` (host reale): la row `web` risulta `# == @deepseek-ai/dsh-base, patched by dsh-websearch-stack` con `searchProvider: websearch-stack`, `fetchProvider: http`, row `websearch-stack` inserita.
  - Runtime con il seam reale (`WebRuntime` da `node_modules/@deepseek-ai/dsh-web`) + stub faithful di `deepseek-official` (available senza chiave, search lancia `WEB_PROVIDER_CREDENTIAL_MISSING`): col pin di base la ricerca fallisce con l'errore dell'utente; col pin del plugin la ricerca passa dallo stack e restituisce 5 fonti reali (Tavily keyless).
  - `npm run typecheck` pulito; `npm test` 47/47 verdi (nuovo test: la patch pinnà il seam e ristabilisce `fetchProvider`, con replica dell'algoritmo `applyEntryPatches`).
- **Comportamento con catena vuota**: cambiato per progetto. Con il pin, catena vuota/tutti backend non disponibili → il seam risponde `WEB_PROVIDER_CONFIGURED_UNAVAILABLE` (prima il README prometteva il fallback al provider dell'host, che col pin di base non era mai raggiungibile). Documentato nel README; per tornare al provider nativo si ribalb il pin nella patch del profilo.
- Aggiornati README (sezione "Coexisting with the native DeepSeek provider" riscritta con i fatti verificati) e commento di registrazione in `src/index.ts`. `lib/` rigenerato. Commit da fare.

## Round 18 — Config volatile: pagina Plugins, ordine di fallback, chiavi operative

- **Richiesta dell'utente**: la pagina di configurazione deve far configurare provider di ricerca e ordine di fallback, non solo le chiavi.
- **Config volatile** (`src/config.ts`): i cinque campi diventano `.volatile()` (Schemastery `Schema.prototype.volatile`), quindi la pagina Plugins li rende automaticamente da schema (guida §6 e §18: "Plugin Config — The product-owned Plugins page, automatically, when fields are `.volatile()`"). `StackConfig` ora è un record di `Volatile<T>` letti con `.get()`.
- **Stack live** (`src/stack.ts`): `StackSearchProvider` prende `order()` (la catena letta a ogni richiesta), `backendOf(id)` e `cacheTtl()`: un edit volatile o una chiave ruotata hanno effetto sulla richiesta successiva, senza re-registrazione. Implementata anche la cache TTL (`cache_ttl_seconds`, prima campo morto).
- **Chiavi operative** (`src/keys.ts`, nuovo): `KeyStore` risolve `TAVILY_API_KEY`, `BRAVE_SEARCH_API_KEY`, `TINYFISH_API_KEY`, `EXA_API_KEY` dal servizio `credentials` dell'Host (letto con `ctx.get`, quindi opzionale) con fallback `process.env`; refresh sull'evento `credentials/reference-updated`. Chiude il cerchio con la card: quello che la card scrive ora viene risolto per richiesta dal provider (guida §18: "Resolve per operation, never at registration").
- **Backend come resolver** (`src/backends/*`): `apiKey`, `timeoutMs`, `limit`, `baseUrl` (SearXNG) sono funzioni lette per operazione; `available()` resta locale e sincrono (vincolo della seam).
- **Registrazione sempre** (`src/index.ts`): il provider si registra una volta; `available()` risponde per la catena in forza, quindi catena vuota o senza chiavi rimette `web_search` al provider dell'host senza reload. Log della catena su `loader/volatile-update`.
- Test: schema risolve in riferimenti volatile (+1), disponibilità live della catena (+1), refresh chiave da evento credentials (+1), ordine letto per operazione (+1), cache TTL (+2) — **46/46 verdi**, typecheck pulito, `lib/` rigenerato.
