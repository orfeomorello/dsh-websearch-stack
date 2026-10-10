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

## Note tecniche da verificare

- `analisi.md` §12 (mappa `plugins:`) contrasta con la guida §3 (array `insert:`): seguo la guida.
- `trafilatura` è Python: non usarlo. Il fetch locale resta fuori MVP (il seam ha già `dsh-web-fetch-http`).
- Il brief chiede `WebSearchResponse` e `test()` su ogni provider: l'API reale non li prevede. Il test di connessione va fatto come chiamata `search` reale nel comando o nel test.
