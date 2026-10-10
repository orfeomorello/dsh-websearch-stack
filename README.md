# dsh-websearch-stack

Multi-provider web search for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh). The plugin registers one search provider on the `ctx.web` seam. That provider runs an ordered fallback chain over the backends you enable.

> **Stato**: versione 0.1.0, MVP. Sei backend sono implementati (Tavily, Parallel MCP, SearXNG, Brave, TinyFish, Exa) e testati con mock. Verificati contro il servizio reale: **Tavily keyless** e **Parallel MCP**. Gli altri richiedono una chiave o un'istanza e non sono ancora verificati: vedi [Limiti noti](#limiti-noti).

## Installazione

Il plugin si installa direttamente da GitHub. `lib/` è committato, quindi non serve alcun passo di build.

```bash
dsh plugin --profile web add github:<owner>/dsh-websearch-stack
```

Per un profilo di prova prima di toccare quello principale:

```bash
dsh --profile web --dump-config > before.txt
dsh plugin --profile web add github:<owner>/dsh-websearch-stack
dsh --profile web --dump-config > after.txt
```

## Configurazione

Le opzioni vivono nella sezione `websearch-stack` del config del profilo.

| Opzione | Default | Significato |
|---|---|---|
| `enabled_providers` | `['tavily', 'parallel-mcp']` | Catena di fallback, in ordine. Valori: `tavily`, `parallel-mcp`, `searxng`, `brave`, `tinyfish`, `exa`. Lista vuota = plugin disattivato. |
| `searxng_url` | — | URL base di un'istanza SearXNG, es. `http://localhost:8080`. Necessario per `searxng`. |
| `default_max_results` | `5` | Numero massimo di fonti per query (1–20). |
| `default_timeout_ms` | `10000` | Timeout per singolo backend (1 000–60 000 ms). |
| `cache_ttl_seconds` | `60` | TTL della cache per query identiche. `0` la disattiva. |

Esempio con SearXNG in testa alla catena:

La forma esatta della riga `config:` nel patch del profilo non è ancora verificata con `dsh --dump-config` su un profilo con il plugin installato. Prima di usarla, controlla con `dsh --profile web --dump-config`. La guida (`docs/PLUGIN-GUIDE.md`, sezione `cordis.patch.yml`) indica che una riga può avere `config:`:

```yaml
- insert:
    - id: websearch-stack
      name: dsh-websearch-stack
      config:
        enabled_providers: [searxng, tavily, parallel-mcp]
        searxng_url: http://localhost:8080
```

### SearXNG

Serve un'istanza con il formato JSON abilitato. Nel `settings.yml` di SearXNG:

```yaml
search:
  formats:
    - html
    - json
```

## Backend

| Id | Chiave | Note |
|---|---|---|
| `tavily` | `TAVILY_API_KEY` (opzionale) | Senza chiave invia l'header `x-tavily-access-mode: keyless` (verificato live). Con chiave, `Bearer`. |
| `parallel-mcp` | no | JSON-RPC `tools/call` su `web_search` (argomenti `objective` e `search_queries`), senza credenziali. Verificato live. |
| `searxng` | no | Istanza self-hosted, richiede `searxng_url`. Non verificato (serve un'istanza). |
| `brave` | `BRAVE_SEARCH_API_KEY` | `X-Subscription-Token`. Non verificato con chiave reale. |
| `tinyfish` | `TINYFISH_API_KEY` | Header `X-API-Key`. Non verificato con chiave reale. |
| `exa` | `EXA_API_KEY` | Header `x-api-key`, `POST /search`. Non verificato con chiave reale. |

Le chiavi vengono lette dalle variabili d'ambiente indicate. Il config YAML non contiene segreti.

### Pagina impostazioni (client web)

Il plugin include anche una scheda di configurazione per il client web di DSH (`dsh.client.platform: "web"`). Appare sulla pagina **Plugins**, nel dettaglio del bundle `dsh-websearch-stack`, e gestisce le quattro chiavi tramite il servizio `credentials` del Host:

- lo stato mostra solo se una chiave è configurata (`describe`), mai il valore;
- il valore scritto non passa da nessun documento di impostazioni (`set` nel credentials store del Host, es. `$DSH_HOME/.credentials.yaml`);
- un campo lasciato vuoto non cancella la chiave esistente.

La `TAVILY_API_KEY` configurata dalla pagina sovrascrive solo il valore del Host: se l'ambiente ne esporta una diversa, quella dell'ambiente resta il valore effettivo (livello `read-only` e preminente). Il salvataggio delle chiavi di Brave, TinyFish ed Exa ha lo stesso comportamento.

> **Stato UI**: la scheda è implementata e coperta da smoke test del bundle, ma non è ancora stata provata a runtime dentro il web client (serve un client in esecuzione). Non è inclusa nella verifica del MVP.

### Convivenza con il provider DeepSeek nativo

Il profilo `web` di DSH include già `web-search-deepseek`. Quel provider è utilizzabile solo se è configurata una chiave (`DEEPSEEK_API_KEY`). Il seam `ctx.web` accetta un solo provider utilizzabile quando non ne è pinnato uno, quindi:

- **Senza `DEEPSEEK_API_KEY`**: il provider DeepSeek non è utilizzabile e lo stack è l'unico candidato. Nessuna configurazione extra.
- **Con `DEEPSEEK_API_KEY`**: i due provider sono entrambi utilizzabili e il seam risponde `WEB_PROVIDER_AMBIGUOUS`. Devi scegliere il provider nel config del servizio `web`, impostando `searchProvider: websearch-stack` (campo di `WebRuntimeConfig`, non di questo plugin). Non è possibile farlo da questo plugin, perché `apply` riceve solo la propria configurazione.

## Come funziona il fallback

Il seam `ctx.web` accetta un solo provider di ricerca utilizzabile quando non ne è configurato uno. Per questo il plugin registra un unico provider, `websearch-stack`, che prova i backend in ordine:

- un errore recuperabile (rete, timeout, rate limit, risposta non valida) passa al backend successivo;
- un errore terminale (es. annullamento) interrompe la catena e viene rilanciato;
- se tutti falliscono, l'errore elenca i tentativi.

## Sviluppo

```bash
npm install
npm run typecheck   # tsc --noEmit
npm test            # test unitari e di integrazione (node:test)
npm run build       # rigenera lib/ da src/
```

`lib/` è committato. Dopo ogni modifica a `src/` esegui `npm run build` e committa anche `lib/`.

## Limiti noti

- **Servizi reali parzialmente verificati.** Tavily keyless e Parallel MCP sono verificati live. Brave, TinyFish, Exa e SearXNG non lo sono ancora: richiedono chiavi o un'istanza.
- **UI non verificata a runtime.** La scheda impostazioni esiste (chiavi via `credentials`), ma non è mai stata esercitata dentro il web client; la configurazione dei backend resta via YAML.
- **Convivenza con DeepSeek.** Con `DEEPSEEK_API_KEY` impostata serve `searchProvider` nel servizio `web` (vedi sopra).
- **Nessun fetch.** Il fetch di pagine è gestito dal provider `dsh-web-fetch-http` di DSH, non da questo plugin.
- **Il plugin non è sandbox.** Il codice gira nel processo host con i suoi privilegi, come ogni plugin DSH.

## Licenza

MIT, vedi [LICENSE](LICENSE).
