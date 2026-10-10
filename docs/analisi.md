# dsh-websearch-stack — Documento di Requisiti e Analisi

> **Brief implementabile.** Questo documento è destinato a un LLM (o a uno sviluppatore umano) che dovrà realizzare il plugin da zero. Ogni sezione contiene le decisioni di design già prese, gli schemi di codice, e i dati tecnici necessari per implementare senza ulteriori ricerche.

---

## 1. Executive Summary

**`dsh-websearch-stack`** è un plugin per **DeepSeek Harness (dsh)** che espone il tool `web_search` (e opzionalmente `web_fetch`) instradandolo attraverso un **fallback chain configurabile** di provider di search ToS-compliant. Il plugin permette all'utente di scegliere da una web UI quale provider usare, conoscere la quota free disponibile, e avere un link diretto per informazioni/iscrizione. I provider **senza autenticazione** sono messi in cima alla lista. È supportata anche l'opzione **SearXNG self-hosted** per uso 100% locale.

**Target primario:** utenti che usano DSH con modelli locali (LMStudio + Qwen / LFM2.5 / MiniCPM5 / BTL-4 Compact) e vogliono web search gratuita, privata, e configurabile senza dover usare il provider DeepSeek ufficiale.

**Tecnologie coinvolte:** DSH (Node.js, Cordis, React), TypeScript, MCP (Model Context Protocol), HTTP REST, opzionalmente Docker (per SearXNG).

---

## 2. Nome del Plugin

**Nome scelto:** `dsh-websearch-stack`

**Motivazione:**
- Parallelismo con il naming di TinyFish ("The web stack for AI agents")
- "Stack" evoca modularità, intercambiabilità, fallback
- Coerente con la nomenclatura DSH (lowercase, dash-separated)
- Disponibilità da verificare su npm e GitHub topic `dsh-plugin` prima della pubblicazione

**Topic GitHub:** `dsh-plugin`, `web-search`, `search-providers`, `deepseek-harness`

---

## 3. Background e Contesto

### 3.1 Perché esiste

DSH (rilasciato 13 agosto 2026 da DeepSeek AI) è un agent runtime open-source basato su Cordis. Espone nativamente i tool `web_search` e `web_fetch` tramite il seam `ctx.web`, ma il **provider di default** richiede la `DEEPSEEK_API_KEY` — il che significa che le query di ricerca passano per i server DeepSeek. Per un utente che usa DSH **localmente con un modello proprio** (LMStudio), questo è doppiamente indesiderabile:
- le query lasciano la macchina locale
- la `DEEPSEEK_API_KEY` non è gratuita per l'uso continuativo

### 3.2 Esiste già qualcosa di simile?

Sì, ci sono **almeno 8 plugin DSH** che aggiungono provider search alternativi. I più noti:
- `ForeverYoungPp/dsh-web-search` (8 provider, fallback chain)
- `A3Boy/dsh-web-tools` (multi-provider)
- `tonyd2wild/DeepSeek-Harness-Web-Tools` (keyless DDG)
- `shinjiyu/dsh-plugin-search` (keyless Tavily)
- `CREAIT-nl/dsh-plugins` (SearXNG self-hosted)
- `cloveric/deepseek-harness-web-search-plugin` (Brave/Tavily)
- `maxwell-feng/dsh-tinyfish-search` (TinyFish)
- `dsh-web-search` (desconocido autore originale, pluckato dal sito DSH cinese)

**Cosa manca e perché costruire un nono plugin:**
- I provider **keyless veri** (senza account, senza carta) non sono raggruppati in un unico posto visibile
- La **UI di configurazione** è spesso nascosta o richiede editing di YAML
- L'utente che vuole provare "**cosa c'è di free**" deve leggere 8 README diversi
- Il fallback chain è spesso cablato nell'ordine, non riconfigurabile da UI
- Non c'è un clear "**voglio il self-hosted, datemi SearXNG**" toggle
- **Nessun plugin ha esplicitamente un'opzione "nessun provider / disattivato"** che permetta all'utente di spegnere il plugin senza disinstallarlo (utile per debug, test, o quando non si vuole che l'agente usi la search)

`dsh-websearch-stack` si posiziona come **il "discovery layer"**: 6 provider raggruppati per tier, ordinati per barriera di accesso (keyless → free con signup → paid), con UI che mostra gratis/requisiti/link, e con l'opzione esplicita **"Nessun provider (plugin disattivato)"** che ripristina il comportamento di default di DSH.

### 3.3 Plugin di riferimento da studiare (non copiare)

Prima di implementare, studiare il codice di questi plugin esistenti per capire i pattern DSH, le convenzioni del seam `ctx.web`, e le API di integrazione con la web UI. **Non copiare codice**: leggere, capire, riscrivere da zero con le proprie scelte di design.

| Repo | Cosa studiare | Note |
|------|---------------|------|
| [`ForeverYoungPp/dsh-web-search`](https://github.com/ForeverYoungPp/dsh-web-search) | Pattern di 8 provider con fallback chain, settings page React, `registerSearchProvider` su `ctx.web`, gestione `api-key` records | Il plugin più completo esistente per `web_search` |
| [`A3Boy/dsh-web-tools`](https://github.com/A3Boy/dsh-web-tools) | Multi-provider con "SearchHints" e "Search Mode" toggle, normalizzazione query provider-specifiche (Tavily, Brave, Exa, SearXNG, Xiaohongshu, X) | Buon pattern per query "intelligenti" per-engine |
| [`tonyd2wild/DeepSeek-Harness-Web-Tools`](https://github.com/tonyd2wild/DeepSeek-Harness-Web-Tools) | Plugin minimal keyless, struttura file Cordis, integrazione con `cordis.patch.yml` | Buona reference per un plugin "thin" senza UI pesante |
| [`shinjiyu/dsh-plugin-search`](https://github.com/shinjiyu/dsh-plugin-search) | Drop-in replacement del tool nativo, keyless Tavily fallback | Pattern di override del tool `web_search` esistente |
| [`CREAIT-nl/dsh-plugins`](https://github.com/CREAIT-nl/dsh-plugins) | Multi-package (9 plugin correlati), SearXNG provider, web fetch con SSRF block, research-mode | Pattern modulare con `web-fetch`, `web-search-searxng`, `research-mode` separati |
| [`maxwell-feng/dsh-tinyfish-search`](https://github.com/maxwell-feng/dsh-tinyfish-search) | Provider singolo ben fatto, TinyFish search API, env var + config | Reference per implementazione di un singolo provider pulito |
| [`cloveric/deepseek-harness-web-search-plugin`](https://github.com/cloveric/deepseek-harness-web-search-plugin) | Brave + Tavily con health_check, provider_status, TaroCub gateway integration | Pattern di "provider diagnostics" (test live + health probe) |
| Sito [`dsh.deepseek404.com`](https://dsh.deepseek404.com/detail.php?id=ForeverYoungPp/dsh-web-search) | Documentazione cinese con patch overlay dettagliate (`patch.web.yml`) | Utile per capire come si applicano le patch al profile `web` |
| Documentazione ufficiale DSH [`deepseek-harness.github.io`](https://deepseek-harness.github.io/deepseek-harness/en/reference/subsystems/web) | Specifica del `ctx.web` seam, `WebSearchProvider` interface, error handling | **Documentazione primaria**, da leggere prima di tutto |

**Pattern chiave da studiare** (in ordine di importanza):
1. Come si registra un provider su `ctx.web` (signature `registerSearchProvider(provider)`)
2. Come si legge/salva la config in `cordis.patch.yml`
3. Come si gestiscono le API key in `~/.dsh/.credentials.yaml` (write-only)
4. Come si applica una `patch.web.yml` per inserire il plugin in un profile
5. Come si espone una settings page React e la si collega al backend del plugin

### 3.4 Provider ToS-compliant (ricerca completata)

Escludiamo `ddgs`/DuckDuckGo perché lo scraping HTML di DuckDuckGo viola i ToS. Restano 6 provider + SearXNG self-hosted. Dettaglio nella sezione 9.

---

## 4. Obiettivi

### 4.1 Obiettivi primari

1. **Zero-config start**: l'utente installa il plugin e ha subito `web_search` funzionante, senza account, senza carta
2. **Discovery**: l'utente vede in un'unica schermata tutti i provider disponibili, con tier, gratis/requisiti, link
3. **Configurabilità**: l'utente può cambiare provider attivo, riordinare il fallback, configurare le key, testare la connessione
4. **Privacy-first by default**: i provider keyless sono in cima; SearXNG self-hosted è una opzione di prima classe
5. **ToS-compliance**: nessun provider viola ToS
6. **Affidabilità**: fallback automatico se un provider fallisce

### 4.2 Non-obiettivi (espliciti)

- **Non è un browser agent**: non usa CDP, non clicca, non naviga. Solo search + fetch HTTP.
- **Non duplica DSH**: usa il seam `ctx.web` esistente, non reinventa il tool system.
- **Non gestisce account utente**: il login ai provider è responsabilità dell'utente (noi forniamo il link).
- **Non fa scraping pesante**: il fetch è una richiesta HTTP, non un browser headless.

---

## 5. User Stories

### US-1: Installazione zero-config
**Come** utente DSH con modello locale,
**voglio** installare `dsh-websearch-stack` e avere `web_search` funzionante senza fare nulla,
**così** che il mio agente possa cercare informazioni senza configurazione.

**Criterio di accettazione:** dopo `dsh plugin --profile web add github:<owner>/dsh-websearch-stack` e restart di `dsh web`, il tool `web_search` è disponibile e una query di test (`site:github.com deepseek harness`) restituisce almeno 3 risultati in meno di 5 secondi.

### US-2: Scelta provider da UI
**Come** utente che vuole più qualità o specificità,
**voglio** vedere nella web UI una lista di provider con descrizione, gratis, requisiti, e link,
**così** che possa scegliere consapevolmente quale usare.

**Criterio di accettazione:** in `Settings → Web Search Stack`, vedo 6+ provider raggruppati per tier (keyless / free / paid), con badge "Gratis", "Auth richiesta", "Carta richiesta", e link cliccabili al sito del provider.

### US-3: Default sensato
**Come** utente che non vuole configurare nulla,
**voglio** che il plugin usi di default un provider keyless affidabile,
**così** che "funzioni e basta" senza intervento.

**Criterio di accettazione:** al primo avvio, l'ordine di fallback è `tavily-keyless → parallel-mcp → searxng` (se configurato). Il primo disponibile viene usato.

### US-4: Test del provider
**Come** utente che ha appena inserito una API key,
**voglio** cliccare un bottone "Test" e vedere se funziona,
**così** che non debba fare una query di prova per verificare.

**Criterio di accettazione:** ogni card provider ha un bottone "Test connessione" che restituisce `{ok, latencyMs, error?}` e mostra un toast con esito.

### US-5: Fallback chain
**Come** utente che usa più provider,
**voglio** che se il primo fallisce il sistema provi il secondo automaticamente,
**così** che la ricerca non si blocchi per un singolo provider down.

**Criterio di accettazione:** configurando due provider (es. Tavily + Parallel MCP), se Tavily ritorna 429 o errore di rete, il sistema riprova con Parallel MCP senza che l'utente se ne accorga (eccetto nei log).

### US-6: SearXNG self-hosted
**Come** utente paranoico della privacy,
**voglio** puntare il plugin al mio SearXNG in Docker,
**così** che le query non escano dalla mia rete.

**Criterio di accettazione:** nella sezione "Self-hosted", inserisco `http://localhost:8080` (o qualsiasi URL), clicco Test, e il plugin lo usa come provider.

### US-7: Cambio runtime del provider attivo
**Come** utente che vuole sperimentare,
**voglio** cambiare il provider attivo senza riavviare DSH,
**così** che possa provare e confrontare.

**Criterio di accettazione:** il toggle "Provider attivo" nella UI aggiorna la configurazione live; la prossima query di `web_search` usa il nuovo provider.

---

## 6. Requisiti Funzionali

### RF-1: Provider supportati

Il plugin deve supportare **6 provider ToS-compliant + 1 self-hosted**:

| ID | Nome | Auth | Free tier | Tier | Categoria |
|----|------|------|-----------|------|-----------|
| `tavily` | Tavily (keyless mode) | ❌ No | 1000/mese se firmi (no carta) | **Keyless** | Cloud |
| `parallel-mcp` | Parallel (MCP) | ❌ No | $5/mese se firmi | **Keyless** | Cloud MCP |
| `searxng` | SearXNG self-hosted | ❌ No | Illimitato (self) | **Self-hosted** | Self-hosted |
| `exa` | Exa | ✅ Key gratuita | $10 signup + $10/mese | Free | Cloud |
| `tinyfish` | TinyFish | ✅ Key gratuita | 12k/giorno | Free | Cloud |
| `brave` | Brave Search | ✅ Key + carta | $5/mese | Paid | Cloud |
| `jina` | Jina Reader (fetch only) | ✅ Key gratuita | 1M tokens/mese | Free | Cloud (solo fetch) |

**Tier visualizzati nella UI con colori distinti:**
- **Keyless** (verde): zero setup, parte subito
- **Self-hosted** (verde scuro): zero dipendenza esterna
- **Free** (blu): signup gratuito, no carta
- **Paid** (ambra): richiede carta di credito

### RF-2: Configurazione persistita

La configurazione deve essere persistita in `$DSH_HOME/profiles/web/cordis.patch.yml` (formato standard DSH) o tramite il sistema di `api-key` records. Le chiavi API sono salvate con write-only nel file `.credentials.yaml` e referenziate per ID.

### RF-3: Fallback chain

- L'ordine dei provider è configurabile dall'utente (drag-to-reorder)
- Il sistema prova il primo provider disponibile (configurato + funzionante)
- Se il primo ritorna errore (5xx, 429, network error), passa al successivo
- Se tutti falliscono, ritorna errore strutturato `WebError` con la lista dei tentativi
- Il fallback è trasparente all'utente (loggato in debug mode, silenzioso in produzione)

### RF-4: UI di configurazione

Una nuova pagina in **Settings → Web Search Stack** con:
- Lista provider raggruppati per tier
- Per ogni provider: nome, descrizione breve, badge tier, badge "Free", indicatore auth, link al sito, campo key (se richiesto), bottone Test, toggle on/off
- Sezione "Fallback chain" con drag-to-reorder
- Sezione "Default behavior" con toggle: "Usa primo provider disponibile" / "Prova tutti e unisci i risultati" / "Chiedi conferma all'utente"
- Sezione "SearXNG self-hosted" con campo URL e bottone Test
- Bottone "Save" che persiste la configurazione

### RF-5: Tool esposti

Il plugin registra tramite `ctx.web`:
- 6 `WebSearchProvider` (uno per provider)
- 2 `WebFetchProvider` (Jina per il tier Free, fallback locale con `trafilatura` per Brave/SearXNG)
- Il tool `web_search` di DSH instrada automaticamente tramite il fallback chain
- Il tool `web_fetch` usa il fetch provider selezionato (o fallback su quello locale)

### RF-6: Comportamento runtime

Alla ricezione di una query `web_search(query)`:
1. Il plugin identifica il primo provider configurato nell'ordine di fallback
2. Verifica che sia disponibile (key presente, self-hosted raggiungibile)
3. Esegue la query con un timeout configurabile (default 10s)
4. Se fallisce (errore di rete, 4xx/5xx, timeout), passa al successivo
5. Normalizza la risposta in `WebSearchResponse` (formato DSH standard)
6. Ritorna i risultati all'agente

### RF-7: Stato "Nessun provider (plugin disattivato)"

Il plugin deve supportare esplicitamente lo stato **disattivato**, dove:
- Nessun provider è attivo, ma il plugin resta installato
- Il tool `web_search` di DSH ricade sul suo comportamento di default (DeepSeek provider nativo, o errore se non configurato)
- L'utente vede in UI un banner chiaro "Plugin disattivato — il tool `web_search` userà il provider di default di DSH"
- È utile per:
  - **Debug**: capire se un problema è causato dal plugin o da DSH
  - **Testing**: confrontare risultati con/senza il plugin
  - **Compliance**: utenti che in alcuni momenti non vogliono che l'agente usi la search
  - **Bootstrapping**: installare il plugin prima di decidere quale provider usare

**Trigger per lo stato disattivato:**
- Tutti i provider in `enabled_providers` sono `false` (nessun toggle ON)
- L'utente ha esplicitamente selezionato "Nessun provider" nel fallback order
- L'utente ha disinstallato il plugin (gestito da DSH, non dal plugin)

**Comportamento in stato disattivato:**
- Il plugin non intercetta le query `web_search`
- Il fallback chain è vuoto
- Nessuna chiamata di rete
- Il banner in UI è persistente finché l'utente non abilita almeno un provider

**Transizione da disattivato ad attivo:**
- L'utente mette ON almeno un provider → il plugin riprende a funzionare
- Nessun restart necessario
- La cache precedente (se presente) non viene pulita automaticamente

### RF-8: Stati del plugin

Il plugin ha 4 stati visibili in UI:

| Stato | Descrizione | UI |
|-------|-------------|-----|
| **Attivo** | Almeno un provider ON | Banner verde "Plugin attivo, N provider abilitati" |
| **Disattivato (nessun provider)** | Tutti OFF, utente non vuole search | Banner grigio "Plugin disattivato — web_search usa provider DSH di default" |
| **Errore di config** | Almeno un provider richiede key mancante | Banner giallo "Configurazione incompleta: 2 provider richiedono API key" |
| **Tutti i provider falliscono** | Ultimo tentativo andato male | Banner rosso temporaneo "Tutti i provider hanno fallito, riprova o controlla la config" |

---

## 7. Requisiti Non Funzionali

### RNF-1: Performance
- Latenza aggiunta dal plugin: <50ms (overhead di normalizzazione e dispatch)
- Timeout di default per query: 10 secondi
- Cache opzionale: 60 secondi per query identiche (evita doppioni in sessioni lunghe)

### RNF-2: Privacy
- Nessuna telemetria
- Le key sono salvate con write-only, mai loggate
- Il fallback chain rispetta l'ordine: keyless → free → paid (se l'utente non mette key, non vengono usati provider a pagamento)
- Le query non passano per server intermedi nostri: il plugin è un thin wrapper

### RNF-3: Affidabilità
- Se un provider keyless è temporaneamente non disponibile, fallback automatico
- Se tutti i provider falliscono, errore chiaro con la causa
- Lo stato "configured" di un provider non cambia runtime (eccetto per SearXNG che può andare su/giù)

### RNF-4: Estensibilità
- Nuovi provider aggiungibili con una nuova classe che implementa `WebSearchProvider`
- Registry di provider caricato dinamicamente
- Il fallback chain è una lista, non cablata

### RNF-5: Internazionalizzazione
- La UI è in inglese di default (coerente con DSH)
- Supporto per query in tutte le lingue (dipende dal provider)
- Il `purpose` param (TinyFish) accetta qualsiasi lingua

### RNF-6: Compatibilità
- DSH versione `0.1.2` alpha train (richiesto dai plugin nello stesso ecosystem)
- Node.js 20+
- TypeScript 5+
- React 18+ (per la UI)

---

## 8. Architettura

### 8.1 Componenti

Il plugin è strutturato in 4 layer:

```
┌─────────────────────────────────────────────────┐
│  DSH Core (ctx.web, ctx.tools, ctx.ui)         │  ← esistente
└─────────────────────────────────────────────────┘
                    ▲
                    │ registerSearchProvider
                    │ registerFetchProvider
                    │ ui.registerPage
┌─────────────────────────────────────────────────┐
│  dsh-websearch-stack plugin                        │
│  ┌───────────────────────────────────────────┐  │
│  │  index.ts (Cordis entry)                  │  │
│  │  - Registers all providers on ctx.web    │  │
│  │  - Registers settings page on ctx.ui     │  │
│  │  - Manages fallback chain                 │  │
│  └───────────────────────────────────────────┘  │
│                    ▲                            │
│  ┌─────────────────┴───────────────────────┐  │
│  │  Providers layer                        │  │
│  │  - TavilyProvider                       │  │
│  │  - ParallelMCPProvider                  │  │
│  │  - SearXNGProvider                      │  │
│  │  - ExaProvider                          │  │
│  │  - TinyFishProvider                     │  │
│  │  - BraveProvider                        │  │
│  │  - JinaFetchProvider (fetch only)       │  │
│  │  - LocalFetchProvider (trafilatura)     │  │
│  └─────────────────────────────────────────┘  │
│                    ▲                            │
│  ┌─────────────────┴───────────────────────┐  │
│  │  UI layer (React)                       │  │
│  │  - SettingsPage                         │  │
│  │  - ProviderCard                         │  │
│  │  - KeyInput (secure)                    │  │
│  │  - FallbackChain (drag-to-reorder)      │  │
│  │  - TestButton                           │  │
│  └─────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

### 8.2 Schema del codice (TypeScript)

```typescript
// types.ts — Definizioni condivise
export type ProviderTier = 'keyless' | 'self-hosted' | 'free' | 'paid';

export interface SearchParams {
  query: string;
  maxResults?: number;
  recencyMinutes?: number;
  location?: string;       // ISO country code: "IT", "US", "FR"
  language?: string;       // ISO 639-1: "it", "en"
  purpose?: string;        // Solo TinyFish: descrizione del perché
  includeDomains?: string[];
  excludeDomains?: string[];
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  source: ProviderId;
  date?: string;
  score?: number;
  score_position?: number;
}

export interface SearchResponse {
  results: SearchResult[];
  provider_used: ProviderId;
  total_results?: number;
  query_time_ms: number;
  fallback_attempts?: Array<{ provider: ProviderId; error: string }>;
}

export type ProviderId =
  | 'tavily'
  | 'parallel-mcp'
  | 'searxng'
  | 'exa'
  | 'tinyfish'
  | 'brave';

export type FetchProviderId = 'jina' | 'local';

export interface ProviderMeta {
  id: ProviderId | FetchProviderId;
  label: string;                // "Tavily"
  description: string;          // "AI-native search, snippet puliti per LLM"
  tier: ProviderTier;
  requires_key: boolean;
  requires_card: boolean;       // solo per tier paid
  free_quota: string;           // "1000/mese" o "Illimitato (self-hosted)" o "12.000/giorno"
  signup_url: string;           // link per iscriversi
  docs_url: string;             // link alla documentazione
  icon_url?: string;            // icona del provider
  default_max_results: number;
  default_timeout_ms: number;
}

export interface WebSearchProvider {
  readonly id: ProviderId;
  readonly meta: ProviderMeta;
  isConfigured(): boolean;
  test(): Promise<{ ok: boolean; latencyMs: number; error?: string }>;
  search(params: SearchParams): Promise<SearchResponse>;
}

export interface WebFetchProvider {
  readonly id: FetchProviderId;
  readonly meta: ProviderMeta;
  isConfigured(): boolean;
  test(): Promise<{ ok: boolean; latencyMs: number; error?: string }>;
  fetch(url: string, opts?: { maxChars?: number }): Promise<{ content: string; title?: string }>;
}

// Config persistita
export interface SearchStackConfig {
  enabled: ProviderId[];              // provider attivi, in ordine di fallback
  default_max_results: number;        // default 5
  default_timeout_ms: number;         // default 10000
  cache_ttl_seconds: number;          // default 60, 0 per disabilitare
  behavior: 'first-available' | 'merge-all' | 'ask-user';
  searxng_url?: string;               // es. "http://localhost:8080"
  provider_keys: Partial<Record<ProviderId, string>>;  // API key per provider
}
```

### 8.3 Provider — interfaccia comune

Tutti i provider devono essere classi TypeScript che:
- Implementano `WebSearchProvider` o `WebFetchProvider`
- Espongono `meta` come static getter (o readonly field) con tutte le info per la UI
- Hanno un constructor che riceve `getKey: () => string | undefined` e `config: SearchStackConfig`
- Espongono un metodo statico `fromConfig(config)` per istanziazione
- Sono registrati nel `PROVIDER_REGISTRY` con il loro ID

### 8.4 Integrazione DSH

Il plugin deve:
1. Estendere `ctx.web` registrando i provider con `ctx.web.registerSearchProvider(provider)`
2. Estendere `ctx.ui` (o equivalente) registrando la settings page
3. Persistere la config in `cordis.patch.yml` tramite `ctx.persistence`
4. Leggere le key da `ctx.credentials` (che le salva cifrate in `.credentials.yaml`)
5. Esporre comandi CLI (opzionale) tramite `ctx.cli`: `dsh search-stack list`, `dsh search-stack test <provider>`

### 8.5 Hook nel fallback chain

Il plugin NON modifica il tool `web_search` originale di DSH. Invece:
- Registra ogni provider come alternativa
- Configura il fallback come "first available" tramite un wrapper che DSH userà
- Se l'utente vuole "merge all", il plugin espone un meta-provider che chiama tutti in parallelo e deduplica i risultati

---

## 9. Provider — Dettaglio Tecnico

Questa sezione contiene i dati tecnici esatti di ogni provider, pronti per l'implementazione.

### 9.1 Tavily (`tavily`)

**Tier:** Keyless  
**Meta:**
- label: "Tavily"
- description: "AI-native search con keyless mode. Snippet puliti, ottimo per agenti."
- free_quota: "1000/mese (no carta)"
- signup_url: "https://app.tavily.com"
- docs_url: "https://docs.tavily.com"
- default_max_results: 5
- default_timeout_ms: 10000

**Endpoint:** `POST https://api.tavily.com/search`

**Headers (keyless mode):**
```
Content-Type: application/json
X-Tavily-Access-Mode: keyless
```

**Headers (con key):**
```
Content-Type: application/json
Authorization: Bearer tvly-XXXX
```

**Body:**
```json
{
  "query": "string",
  "max_results": 5,
  "search_depth": "basic",  // "basic" = 1 credito, "advanced" = 2
  "include_answer": false,
  "include_raw_content": false,
  "topic": "general"  // "general" | "news"
}
```

**Response (entrambe le mode identiche):**
```json
{
  "query": "string",
  "results": [
    {
      "title": "string",
      "url": "string",
      "content": "string",  // snippet esteso
      "score": 0.95,
      "raw_content": null
    }
  ],
  "answer": null,
  "follow_up_questions": null,
  "response_time": 1.2
}
```

**Note implementative:**
- Modalità keyless ritorna risposte identiche ma con rate limit più basso
- Quando keyless esaurisce, risponde con un messaggio in linguaggio naturale (testo, non JSON) che l'agente può leggere
- Se l'utente vuole più capacità, swap della key senza cambiare codice

### 9.2 Parallel MCP (`parallel-mcp`)

**Tier:** Keyless  
**Meta:**
- label: "Parallel (MCP)"
- description: "Server MCP remoto gratuito. Search + fetch in un tool, no signup."
- free_quota: "$5/mese (se firmi), keyless MCP illimitato per uso personale"
- signup_url: "https://platform.parallel.ai"
- docs_url: "https://docs.parallel.ai/integrations/mcp/search-mcp"
- default_max_results: 5
- default_timeout_ms: 15000

**Implementazione:** usa il client MCP di DSH (se esiste) o un client MCP custom.

**MCP Server URL:** `https://search.parallel.ai/mcp`

**Tools esposti dal server:**
- `web_search(query: str, max_results?: int) -> {results: [{title, url, excerpt}]}`
- `web_fetch(url: str) -> {content: str}`

**Configurazione DSH (in `cordis.patch.yml`):**
```yaml
mcp-servers:
  parallel:
    url: https://search.parallel.ai/mcp
    auth: none  # opzionale: parallel_api_key
```

**Note:** il client MCP fa la traduzione tool-call → MCP protocol. Il plugin wrappa il client e normalizza l'output.

### 9.3 SearXNG self-hosted (`searxng`)

**Tier:** Self-hosted  
**Meta:**
- label: "SearXNG (self-hosted)"
- description: "Metasearch engine locale. Zero dipendenze esterne, totale privacy."
- free_quota: "Illimitato (self-hosted)"
- signup_url: "https://github.com/searxng/searxng"
- docs_url: "https://docs.searxng.org"
- default_max_results: 10
- default_timeout_ms: 10000

**Endpoint:** `GET <user-configured-url>/search?q=<query>&format=json&language=<lang>`

Esempio: `GET http://localhost:8080/search?q=dsh&format=json&language=en`

**Response (formato JSON SearXNG):**
```json
{
  "query": "dsh",
  "results": [
    {
      "title": "string",
      "url": "string",
      "content": "string",  // snippet
      "engine": "google",
      "engines": ["google", "bing"],
      "score": 1.5,
      "category": "general"
    }
  ],
  "suggestions": [],
  "answers": []
}
```

**Setup raccomandato:**
```yaml
# searxng/settings.yml
server:
  limiter: false  # per uso locale
search:
  formats: [html, json]
```

**Docker command (documentato nel README):**
```bash
docker run -d -p 8080:8080 \
  -e SEARXNG_SECRET=change-me \
  -v ./searxng:/etc/searxng \
  searxng/searxng
```

**Note implementative:**
- Il `searxng_url` è configurabile dall'utente
- Test del provider fa una query `q=dsh` e verifica che ritorni 200 + JSON
- Se l'utente non ha SearXNG, il test fallisce con messaggio chiaro

### 9.4 Exa (`exa`)

**Tier:** Free (signup senza carta)  
**Meta:**
- label: "Exa"
- description: "Neural/semantic search. Per query complesse e semantiche."
- free_quota: "$10 signup + $10/mese (no carta)"
- signup_url: "https://dashboard.exa.ai"
- docs_url: "https://docs.exa.ai"
- default_max_results: 5
- default_timeout_ms: 12000

**Endpoint:** `POST https://api.exa.ai/search`

**Headers:**
```
Content-Type: application/json
x-api-key: <EXA_API_KEY>
```

oppure:
```
Authorization: Bearer <EXA_API_KEY>
```

**Body:**
```json
{
  "query": "string",
  "numResults": 5,
  "type": "auto",  // "neural" | "keyword" | "auto" (default)
  "contents": {
    "text": true,
    "highlights": true
  }
}
```

**Response:**
```json
{
  "requestId": "string",
  "results": [
    {
      "title": "string",
      "url": "string",
      "publishedDate": "string",
      "author": "string",
      "score": 0.85,
      "text": "string",       // contenuto estratto
      "highlights": ["string"],
      "highlightScores": [0.9]
    }
  ],
  "searchType": "neural",
  "costDollars": 0.005
}
```

**Note:** Exa ha un MCP server ufficiale ma è meglio chiamarlo via REST per controllo fine.

### 9.5 TinyFish (`tinyfish`)

**Tier:** Free (signup senza carta)  
**Meta:**
- label: "TinyFish"
- description: "Search + Fetch in un'API. Parametro 'purpose' unico."
- free_quota: "12.000/giorno"
- signup_url: "https://agent.tinyfish.ai/api-keys"
- docs_url: "https://docs.tinyfish.ai/search-api"
- default_max_results: 10
- default_timeout_ms: 10000

**Endpoint:** `GET https://api.search.tinyfish.ai?query=<query>`

**Headers:**
```
X-API-Key: <TINYFISH_API_KEY>
```

**Query parameters:**
- `query` (required): stringa di ricerca
- `location`: country code (es. "US", "IT")
- `language`: codice lingua (es. "en", "it")
- `purpose`: descrizione libera del perché si cerca (migliora i risultati!)
- `recency_minutes`: int 1..5256000 (filtra per freschezza)
- `include_domains`: lista separata da virgola
- `exclude_domains`: lista separata da virgola

**Response:**
```json
{
  "query": "string",
  "results": [
    {
      "position": 1,
      "site_name": "string",
      "title": "string",
      "snippet": "string",
      "url": "string",
      "date": "string"
    }
  ],
  "total_results": 10,
  "page": 0
}
```

**Bonus — TinyFish Fetch** (opzionale, da usare come fetch provider): `POST https://api.fetch.tinyfish.ai` con body `{"urls": [...], "format": "markdown"}`. Free 1000 URLs/giorno.

### 9.6 Brave Search (`brave`)

**Tier:** Paid (richiede carta)  
**Meta:**
- label: "Brave Search"
- description: "Indice indipendente, snippet LLM-ready. Premium quality."
- free_quota: "$5/mese (richiede carta)"
- signup_url: "https://api-dashboard.search.brave.com"
- docs_url: "https://api-dashboard.search.brave.com/app/documentation"
- default_max_results: 10
- default_timeout_ms: 10000

**Endpoint (consigliato per LLM):** `GET https://api.search.brave.com/res/v1/llm/context?q=<query>`

**Endpoint classico:** `GET https://api.search.brave.com/res/v1/web/search?q=<query>`

**Headers:**
```
X-Subscription-Token: <BRAVE_API_KEY>
Accept: application/json
```

**Query parameters (LLM context):**
- `q`: query
- `count`: numero risultati (max 30 per default, era 60)
- `maximum_number_of_tokens`: budget di token (default 8192, range 1024-32768)
- `freshness`: filtro temporale ("pd" = past day, "pw" = past week, "pm" = past month)

**Response (LLM context, semplificato):**
```json
{
  "results": [
    {
      "title": "string",
      "url": "string",
      "excerpts": ["string"],  // passaggi pre-estratti rilevanti
      "age": "string"
    }
  ],
  "summary": "string"  // sintesi opzionale
}
```

**Note:**
- Rate limit free tier: 1 richiesta/secondo (rigoroso!)
- Il plugin deve rispettarlo (sleep 1.1s tra richieste o batchare)
- Il parametro `maximum_number_of_tokens` è la killer feature: ricevi solo i passaggi rilevanti, non pagine intere

### 9.7 Jina Reader (`jina`) — Fetch only

**Tier:** Free (signup senza carta)  
**Meta:**
- label: "Jina Reader"
- description: "Fetch HTTP pulito. Markdown estratto, no JS."
- free_quota: "1M tokens/mese"
- signup_url: "https://jina.ai/reader/"
- docs_url: "https://jina.ai/reader/"
- default_max_results: 1
- default_timeout_ms: 15000

**Endpoint:** `POST https://r.jina.ai/<url>` (keyless, rate-limited)  
oppure `POST https://r.jina.ai/<url>` con `Authorization: Bearer <JINA_API_KEY>` (1M tokens/mese)

**Response:** testo markdown puro

**Note:** è SOLO un fetch provider, non fa search. Da accoppiare con un search provider (es. Brave per qualità, Tavily keyless per zero-config).

### 9.8 Local Fetch (`local`) — Fallback

**Tier:** Self-hosted (built-in)  
**Meta:**
- label: "Local Fetch (trafilatura)"
- description: "Estrazione contenuto HTML in locale. Zero dipendenze esterne."
- free_quota: "Illimitato"
- signup_url: ""
- docs_url: "https://trafilatura.readthedocs.io"
- default_max_results: 1
- default_timeout_ms: 20000

**Implementazione:** usa `trafilatura` (Python) o `readability-lxml` + `@mozilla/readability` (Node.js) per estrarre il testo pulito da una pagina HTML.

**Note:** è il fallback di default per Brave/SearXNG quando Jina non è configurato.

---

## 10. Schema UI

### 10.1 Settings Page

Path: `Settings → Web Search Stack`

**Status banner in cima** (mostra sempre lo stato corrente del plugin, vedi RF-8):

```
┌─────────────────────────────────────────────────────────────────┐
│  Web Search Stack                                          [×]  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  🟢 Plugin ATTIVO — 2 provider abilitati                  │  │
│  │  Fallback: Tavily → Parallel MCP                          │  │
│  │  [Test tutto] [Vedi log]                                  │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  Multi-provider web search for your local agent.                 │
│  Choose up to 6 providers, set your fallback order, and you're  │
│  ready to go. No account needed to start.                       │
│                                                                 │
│  ── Modalità plugin ─────────────────────────────────────────  │
│                                                                 │
│  (●) Usa il seguente fallback chain di provider                │
│  ( ) Nessun provider (plugin disattivato, usa DSH default)      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Quando "Nessun provider" è selezionato**, la UI mostra solo questo messaggio e nasconde tutto il resto:

```
┌─────────────────────────────────────────────────────────────────┐
│  Web Search Stack                                          [×]  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  ⚪ Plugin DISATTIVATO                                    │  │
│  │  Il tool web_search userà il provider di default di DSH. │  │
│  │  Per riattivare il plugin, seleziona un provider qui     │  │
│  │  sotto e mettilo in fallback chain.                      │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ── Modalità plugin ─────────────────────────────────────────  │
│                                                                 │
│  ( ) Usa il seguente fallback chain di provider                │
│  (●) Nessun provider (plugin disattivato, usa DSH default)      │
│                                                                 │
│  ── Provider disponibili (per riattivare il plugin) ──────────  │
│                                                                 │
│  [Sezione provider compressa: clicca per espandere]             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Quando almeno un provider è attivo**, la UI mostra il picker completo:

```
┌─────────────────────────────────────────────────────────────────┐
│  Web Search Stack                                          [×]  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  🟢 Plugin ATTIVO — 2 provider abilitati                  │  │
│  │  Fallback: Tavily → Parallel MCP                          │  │
│  │  [Test tutto] [Vedi log]                                  │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ── Modalità plugin ─────────────────────────────────────────  │
│                                                                 │
│  (●) Usa il seguente fallback chain di provider                │
│  ( ) Nessun provider (plugin disattivato, usa DSH default)      │
│                                                                 │
│  ── Provider — Keyless (zero account, parte subito) ─────────  │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  🟢 Tavily                          [ON ●] [Settings ⚙]   │  │
│  │  AI-native search, keyless mode.                          │  │
│  │  Free: 1000/mese (no carta)         ℹ️ [Docs] [Signup]    │  │
│  │  No auth required · 5 results · 10s timeout               │  │
│  │  [Test connection]                                         │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  🟢 Parallel (MCP)                  [ON ●] [Settings ⚙]   │  │
│  │  Remote MCP server, search + fetch in one tool.           │  │
│  │  Free: $5/mese (se firmi)          ℹ️ [Docs] [Signup]    │  │
│  │  No auth required · 5 results · 15s timeout               │  │
│  │  [Test connection]                                         │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ── Self-hosted (zero dipendenze esterne) ────────────────────  │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  🟢 SearXNG (self-hosted)           [OFF ○] [Settings ⚙]  │  │
│  │  Metasearch locale, 100% privacy.                         │  │
│  │  Free: Illimitato                    ℹ️ [Docker setup]    │  │
│  │  URL: [http://localhost:8080        ]  [Test]            │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ── Provider — Free (signup gratuito, no carta) ─────────────  │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  🔵 Exa                              [OFF ○] [Settings ⚙] │  │
│  │  Neural/semantic search. For complex queries.             │  │
│  │  Free: $10 signup + $10/mese         ℹ️ [Docs] [Signup]   │  │
│  │  API key: [••••••••••••••••]         [Test]              │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  🔵 TinyFish                         [OFF ○] [Settings ⚙] │  │
│  │  Search + Fetch. Unique 'purpose' parameter.              │  │
│  │  Free: 12.000/giorno                ℹ️ [Docs] [Signup]   │  │
│  │  API key: [••••••••••••••••]         [Test]              │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ── Provider — Paid (richiede carta) ────────────────────────  │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  🟠 Brave Search                     [OFF ○] [Settings ⚙] │  │
│  │  Independent index, LLM-ready snippets.                   │  │
│  │  Free: $5/mese (richiede carta)     ℹ️ [Docs] [Signup]   │  │
│  │  API key: [••••••••••••••••]         [Test]              │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ── Fetch provider (per il tool web_fetch) ──────────────────  │
│                                                                 │
│  Default fetch provider: [▼ Local (trafilatura)        ]        │
│                                                                 │
│  ── Fallback order ───────────────────────────────────────────  │
│                                                                 │
│  Trascina per riordinare:                                       │
│    1. Tavily (keyless)                                          │
│    2. Parallel MCP (keyless)                                    │
│    3. ... (altri provider ON)                                   │
│                                                                 │
│  ── Comportamento di default ─────────────────────────────────  │
│                                                                 │
│  (●) First available  ( ) Merge all  ( ) Chiedi conferma        │
│                                                                 │
│  ── Opzioni globali ──────────────────────────────────────────  │
│                                                                 │
│  Max results per query:    [5        ]                           │
│  Timeout per query (ms):   [10000    ]                           │
│  Cache results (seconds):  [60       ]                           │
│                                                                 │
│                                                                  │
│  [Cancel]                                       [Save]           │
└─────────────────────────────────────────────────────────────────┘
```

### 10.2 Provider Card — dettaglio interazione

Per ogni provider card:
- **Toggle ON/OFF** (in alto a destra): attiva/disattiva il provider
  - Quando ON: card con sfondo leggermente colorato (verde/blu/ambra a seconda del tier)
  - Quando OFF: card grigia, "spenta"
- **Settings ⚙**: apre un menu a tendina con opzioni specifiche del provider (max results, timeout, lingua, location, purpose default)
- **Test connection**: bottone che esegue una query `test` e mostra toast con esito (ok + latency, oppure errore + messaggio)
- **Link Docs/Signup**: si aprono in nuova tab
- **API key field** (solo per provider che richiedono key): input mascherato, con link "Get a key" che porta al signup_url

### 10.3 Banner di stato

Il banner in cima cambia colore e contenuto in base allo stato (RF-8):

| Stato | Colore | Messaggio | Azione |
|-------|--------|-----------|--------|
| **Attivo** | 🟢 Verde scuro | "Plugin ATTIVO — N provider abilitati" + ordine fallback | [Test tutto] [Vedi log] |
| **Disattivato** | ⚪ Grigio | "Plugin DISATTIVATO — web_search usa provider DSH di default" | (nessuna azione) |
| **Errore config** | 🟡 Giallo | "Configurazione incompleta: N provider richiedono API key" | [Vedi config] |
| **Tutti falliscono** | 🔴 Rosso (temporaneo 5s) | "Tutti i provider hanno fallito, controlla la config" | [Vedi log] |

### 10.4 Error states per provider

- **Provider keyless non disponibile temporaneamente**: card grigia con messaggio "Currently unavailable, will retry on next query"
- **Provider con key invalida**: card con badge rosso "Auth failed", bottone "Re-test"
- **SearXNG non raggiungibile**: card con messaggio "Cannot reach http://localhost:8080 — is the container running?"

### 10.5 UX per la transizione "Nessun provider"

Quando l'utente seleziona "Nessun provider":
1. Conferma con un modal: "Sei sicuro? Il tool `web_search` userà il provider DSH di default (DeepSeek nativo, se configurato)"
2. Bottone "Conferma disattivazione" + "Annulla"
3. Dopo conferma: il banner diventa grigio, le card provider si comprimono
4. Quando l'utente vuole riattivare: espande la sezione, mette ON un provider, il banner torna verde

Questa UX esplicita previene il caso "ho disattivato per sbaglio e non capisco perché la search non funziona più".

---

## 11. Schema del package.json

```json
{
  "name": "dsh-websearch-stack",
  "version": "0.1.0",
  "description": "Multi-provider web search stack for DeepSeek Harness. 6 ToS-compliant providers with keyless defaults, fallback chain, and self-hosted SearXNG option.",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "lint": "eslint src --ext .ts,.tsx",
    "test": "vitest",
    "prepublishOnly": "npm run build && npm test"
  },
  "keywords": [
    "dsh-plugin",
    "deepseek-harness",
    "web-search",
    "ai-agent",
    "tavily",
    "brave-search",
    "exa",
    "tinyfish",
    "searxng",
    "parallel-mcp"
  ],
  "author": "your-name",
  "license": "MIT",
  "peerDependencies": {
    "@deepseek-ai/dsh": "^0.1.2-alpha.2"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/react": "^18.2.0",
    "typescript": "^5.3.0",
    "vitest": "^1.0.0",
    "eslint": "^8.0.0"
  },
  "dependencies": {
    "trafilatura": "^1.0.0",
    "@mozilla/readability": "^0.4.4",
    "jsdom": "^23.0.0"
  },
  "dsh": {
    "plugin": true,
    "profiles": ["web"],
    "min-dsh-version": "0.1.2"
  }
}
```

---

## 12. Schema del cordis.patch.yml

Il plugin, quando installato, deve applicare questo patch:

```yaml
# ~/.dsh/profiles/web/cordis.patch.yml
plugins:
  dsh-websearch-stack:
    enabled: true
    config:
      enabled_providers:        # ordine = fallback order
        - tavily                # keyless, default
        - parallel-mcp          # keyless
        - searxng               # se configurato
        # - exa                # se key inserita
        # - tinyfish           # se key inserita
        # - brave              # se key inserita
      fetch_provider: local     # 'jina' | 'local' | 'tinyfish'
      searxng_url: null         # 'http://localhost:8080' se usato
      behavior: first-available # 'first-available' | 'merge-all' | 'ask-user'
      default_max_results: 5
      default_timeout_ms: 10000
      cache_ttl_seconds: 60
      # Le key sono salvate separatamente in ~/.dsh/.credentials.yaml
      # e referenziate per id. NON metterle qui.
```

**Esempio di `cordis.patch.yml` con SearXNG attivo e due key:**

```yaml
plugins:
  dsh-websearch-stack:
    enabled: true
    config:
      enabled_providers:
        - searxng           # self-hosted, priorità
        - tavily            # keyless fallback
        - parallel-mcp
        - tinyfish          # con key
        - exa               # con key
      fetch_provider: jina
      searxng_url: 'http://localhost:8080'
      behavior: first-available
      default_max_results: 8
      default_timeout_ms: 12000
      cache_ttl_seconds: 120
```

**Esempio di `.credentials.yaml` (solo ID, mai valori in chiaro in patch):**

```yaml
# ~/.dsh/.credentials.yaml
credentials:
  dsh-websearch-stack/tinyfish:
    type: api-key
    value: <encrypted>
  dsh-websearch-stack/exa:
    type: api-key
    value: <encrypted>
  dsh-websearch-stack/brave:
    type: api-key
    value: <encrypted>
  dsh-websearch-stack/jina:
    type: api-key
    value: <encrypted>
```

---

## 13. Flusso di Esecuzione

### 13.1 Flusso `web_search(query)`

```
[Agente chiama web_search("query")]
        │
        ▼
[DSH tool-web] cerca provider su ctx.web
        │
        ▼
[dsh-websearch-stack] riceve la chiamata
        │
        ├─ Controlla stato plugin (RF-7)
        │   │
        │   ├─ Disattivato (nessun provider ON)
        │   │   └─ Non intercetta, lascia passare al provider DSH di default
        │   │
        │   └─ Attivo → continua
        │
        ├─ Controlla cache (se abilitata)
        │   └─ HIT → ritorna risultati cached
        │
        ├─ Itera sui provider abilitati in ordine:
        │   │
        │   ├─ tavily (keyless, no setup)
        │   │   └─ search(query) → ok? return : next
        │   │
        │   ├─ parallel-mcp
        │   │   └─ callTool('web_search', {query}) → ok? return : next
        │   │
        │   ├─ searxng (se URL configurato)
        │   │   └─ fetch(searxng_url + search?q=...) → ok? return : next
        │   │
        │   ├─ exa (se key presente)
        │   │   └─ search(query) → ok? return : next
        │   │
        │   ├─ tinyfish (se key presente)
        │   │   └─ search(query) → ok? return : next
        │   │
        │   └─ brave (se key presente)
        │       └─ search(query) → ok? return : next
        │
        ├─ Se behavior == 'merge-all':
        │   └─ Chiama tutti in parallelo, dedupa per URL, return
        │
        └─ Se tutti falliscono:
            └─ Return WebError con fallback_attempts[]
```

### 13.2 Flusso `web_fetch(url)`

```
[Agente chiama web_fetch("https://...")]
        │
        ▼
[dsh-websearch-stack] riceve la chiamata
        │
        ├─ fetch_provider = 'jina':
        │   └─ POST https://r.jina.ai/<url> → markdown
        │
        ├─ fetch_provider = 'tinyfish':
        │   └─ POST https://api.fetch.tinyfish.ai {urls: [url]} → markdown
        │
        └─ fetch_provider = 'local':
            └─ fetch HTML → trafilatura/readability → testo pulito
```

### 13.3 Test di un provider

```
[User click "Test connection" su provider card]
        │
        ▼
[Plugin esegue una query di test specifica per provider]
        │
        ├─ tavily → POST {query: "test", max_results: 1} → verifica 200 + results.length > 0
        ├─ parallel-mcp → callTool('web_search', {query: 'test'}) → verifica ok
        ├─ searxng → GET {url}/search?q=test&format=json → verifica 200 + JSON valido
        ├─ exa → POST {query: "test", numResults: 1} → verifica 200 + results.length > 0
        ├─ tinyfish → GET ?query=test → verifica 200 + results[]
        └─ brave → GET ?q=test&count=1 → verifica 200
        │
        ▼
[Toast con esito: ✅ ok in 234ms oppure ❌ errore: <msg>]
```

---

## 14. Gestione Errori

### 14.1 Errori per provider

Ogni provider wrappa gli errori HTTP in errori strutturati:

```typescript
type ProviderError =
  | { kind: 'auth-failed'; provider: ProviderId; message: string }      // 401/403
  | { kind: 'rate-limited'; provider: ProviderId; retryAfter?: number } // 429
  | { kind: 'quota-exhausted'; provider: ProviderId; message: string }  // 402, body says so
  | { kind: 'network-error'; provider: ProviderId; cause: string }      // fetch failed
  | { kind: 'timeout'; provider: ProviderId; timeoutMs: number }
  | { kind: 'bad-request'; provider: ProviderId; message: string }      // 400
  | { kind: 'server-error'; provider: ProviderId; status: number; body: string } // 5xx
  | { kind: 'parse-error'; provider: ProviderId; body: string }         // JSON invalido
  | { kind: 'not-configured'; provider: ProviderId }                    // manca key o URL
```

### 14.2 Fallback policy

- `auth-failed`: passa al prossimo (la key è sbagliata, inutile riprovare)
- `rate-limited`: passa al prossimo (rispetta `Retry-After` solo se l'utente ha un solo provider)
- `quota-exhausted`: passa al prossimo e marca il provider come "temporaneamente disabilitato" fino al reset
- `network-error`, `timeout`: passa al prossimo
- `bad-request`: log errore, passa al prossimo (la query è sbagliata per quel provider)
- `server-error`: passa al prossimo
- `parse-error`: log errore, passa al prossimo
- `not-configured`: salta silenziosamente (non è un errore, solo non configurato)

### 14.3 Error response finale

Se tutti i provider falliscono:

```typescript
{
  error: {
    kind: 'all-failed',
    attempts: [
      { provider: 'tavily', error: { kind: 'rate-limited', ... } },
      { provider: 'parallel-mcp', error: { kind: 'server-error', status: 503, ... } },
      ...
    ],
    message: 'All configured providers failed. Check Settings → Web Search Stack.'
  }
}
```

---

## 15. Testing

### 15.1 Unit test

Per ogni provider:
- `test()` ritorna `ok: true` con API valida
- `test()` ritorna `ok: false` con key invalida
- `test()` ritorna `ok: false` con network error (mock fetch failure)
- `search()` normalizza correttamente la risposta
- `search()` gestisce tutti i codici di errore HTTP
- Timeout: `search()` ritorna errore `timeout` entro il timeout configurato

### 15.2 Integration test

- Install del plugin in una DSH di test
- `web_search("deepseek harness")` ritorna ≥ 3 risultati da Tavily keyless
- Cambio provider in UI, nuova query usa il nuovo provider
- Toggle SearXNG con URL invalido → test fallisce con messaggio chiaro
- Disabilitazione di tutti i provider → query ritorna errore strutturato

### 15.3 Manual smoke test

| Step | Azione | Risultato atteso |
|------|--------|------------------|
| 1 | Install plugin | `dsh plugin list` mostra dsh-websearch-stack |
| 2 | Restart DSH | `web_search` appare nella tool list |
| 3 | Query da chat | Risultati visibili in <5s |
| 4 | Apri Settings | Page "Web Search Stack" visibile |
| 5 | Click "Test" su Tavily | Toast "✅ ok in 234ms" |
| 6 | Toggle SearXNG + URL `http://invalid` | Test fallisce con messaggio chiaro |
| 7 | Inserisci key Exa | Toggle ON, Test ok |
| 8 | Disabilita tutti | Query ritorna errore "all-failed" |

---

## 16. Roadmap di Sviluppo

### Settimana 1 — MVP funzionante

- [ ] Setup repo, package.json, tsconfig
- [ ] `types.ts` con tutte le interfacce
- [ ] Provider `Tavily` (con keyless mode) — il più importante
- [ ] Provider `Parallel MCP` (con client MCP custom)
- [ ] Entry point `index.ts` con registrazione su `ctx.web`
- [ ] Patch `cordis.patch.yml`
- [ ] Test locale con `dsh web` e query da chat

### Settimana 2 — UI e configurazione

- [ ] Settings page React con raggruppamento per tier
- [ ] ProviderCard component (con toggle, test, key input)
- [ ] Drag-to-reorder per fallback chain
- [ ] Persistenza config in `cordis.patch.yml`
- [ ] Provider `SearXNG` (con test URL)
- [ ] Provider `LocalFetch` (trafilatura/readability)
- [ ] Test E2E: install, config, query

### Settimana 3 — Provider restanti e polish

- [ ] Provider `Exa`
- [ ] Provider `TinyFish` (search + fetch)
- [ ] Provider `Brave` (con gestione rate limit 1/sec)
- [ ] Provider `Jina` (fetch)
- [ ] Cache layer (in-memory con TTL)
- [ ] Error handling completo con tipi strutturati
- [ ] Logging debug (opt-in)

### Settimana 4 — Release

- [ ] README con screenshot, setup, esempi
- [ ] Test su 3 modelli diversi (Qwen 9B, LFM2.5-1.2B, BTL-4 Compact)
- [ ] Publish su GitHub con topic `dsh-plugin`
- [ ] Submit a `awesome-deepseek-harness` se esiste
- [ ] Release notes v0.1.0
- [ ] Issue template per bug report

### Future (v0.2+)

- Provider aggiuntivi: Kagi, You.com, Serper, Firecrawl
- Rate limit globale configurabile (es. max 60 query/minuto totali)
- Statistiche di utilizzo per provider (quante query, latenza media, errori)
- Esport/import configurazione
- Plugin mode "research" (multi-step search → read → synth)
- Provider "search + curate" con rerank locale (all-MiniLM-L6-v2)

---

## 17. Note per l'LLM Implementatore

### 17.1 Cosa assumere come noto

- DSH è basato su Cordis (Node.js framework)
- I tool si registrano con `ctx.web.registerSearchProvider(provider)`
- Le key sono salvate in `~/.dsh/.credentials.yaml` con API `ctx.credentials.set(id, value)`
- La web UI è React, registrata con `ctx.ui.registerPage(id, component)`
- Il `cordis.patch.yml` viene applicato all'avvio del profile

### 17.2 Decisioni di design già prese

- **Tier visualizzati**: keyless (verde) → self-hosted (verde scuro) → free (blu) → paid (ambra)
- **Default order**: `tavily → parallel-mcp → searxng` se attivo
- **Cache TTL default**: 60 secondi
- **Max results default**: 5
- **Timeout default**: 10 secondi
- **Behavior default**: `first-available` (non merge-all, troppo costoso)
- **Fetch provider default**: `local` (trafilatura, zero dipendenze)

### 17.3 Vincoli non negoziabili

- **ToS-compliance**: nessun provider che faccia scraping vietato
- **No telemetria**: il plugin non manda dati a server nostri
- **Open source**: licenza MIT, codice su GitHub pubblico
- **No dipendenze native pesanti**: se serve Python, è un optional
- **Compatibilità DSH 0.1.2 alpha train** (richiesto dall'ecosistema)

### 17.4 File da creare

```
dsh-websearch-stack/
├── package.json
├── tsconfig.json
├── README.md
├── LICENSE (MIT)
├── .gitignore
├── cordis.patch.yml
├── src/
│   ├── index.ts                        # entry point Cordis
│   ├── types.ts                        # tutte le interfacce
│   ├── providers/
│   │   ├── base.ts                     # classe base astratta
│   │   ├── tavily.ts
│   │   ├── parallel-mcp.ts
│   │   ├── searxng.ts
│   │   ├── exa.ts
│   │   ├── tinyfish.ts
│   │   ├── brave.ts
│   │   ├── jina-fetch.ts
│   │   └── local-fetch.ts
│   ├── ui/
│   │   ├── SettingsPage.tsx
│   │   ├── ProviderCard.tsx
│   │   ├── KeyInput.tsx
│   │   ├── TestButton.tsx
│   │   ├── FallbackChain.tsx
│   │   └── styles.css
│   ├── utils/
│   │   ├── cache.ts                    # cache in-memory con TTL
│   │   ├── errors.ts                   # tipi di errore e normalizzazione
│   │   ├── http.ts                     # fetch wrapper con timeout e retry
│   │   └── normalize.ts                # normalizza risposte provider
│   └── config.ts                       # legge/salva cordis.patch.yml
├── tests/
│   ├── providers/
│   │   ├── tavily.test.ts
│   │   ├── parallel-mcp.test.ts
│   │   └── ...
│   └── integration.test.ts
└── docs/
    ├── screenshot-settings.png
    ├── screenshot-results.png
    └── ARCHITECTURE.md
```

### 17.5 Test iniziale suggerito

Dopo aver implementato il provider Tavily, testalo manualmente con:

```bash
# 1. Build
cd dsh-websearch-stack && npm install && npm run build

# 2. Link locale
npm link

# 3. Nella directory DSH
cd ../deepseek-harness
npm link dsh-websearch-stack

# 4. Avvia
pnpm dsh web

# 5. Apri http://localhost:3080, vai in Settings → Web Search Stack
# 6. Verifica che la card Tavily sia visibile
# 7. Click "Test connection" → deve dare ✅ ok
# 8. Torna in chat, chiedi "cerca DeepSeek Harness su GitHub"
# 9. Verifica che il tool web_search viene chiamato e ritorna risultati
```

### 17.6 Prossimi passi dopo la lettura

1. Leggi attentamente sezione 8 (Architettura) e 9 (Provider)
2. Conferma la struttura file in 17.4
3. Inizia con il provider Tavily (sezione 9.1) — è il default
4. Testa con `dsh web` in locale prima di passare al prossimo
5. Aggiungi provider uno alla volta, testando dopo ognuno
6. La UI viene DOPO che almeno 2-3 provider funzionano

---

**Fine del documento.** Le sezioni 1-9 sono requisiti. Le sezioni 10-14 sono specifiche di design. Le sezioni 15-17 sono guida all'implementazione. Il LLM implementatore può procedere con questa specifica senza ulteriori domande.
