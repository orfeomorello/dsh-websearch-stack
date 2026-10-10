# dsh-websearch-stack

Multi-provider web search for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh). The plugin registers one search provider on the `ctx.web` seam. That provider runs an ordered fallback chain over the backends you enable.

> **Stato**: versione 0.1.0, MVP. Tavily, Parallel MCP e SearXNG sono implementati e testati con mock e con un server HTTP locale. I servizi reali non sono ancora stati verificati end-to-end: vedi [Limiti noti](#limiti-noti).

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
| `enabled_providers` | `['tavily', 'parallel-mcp']` | Catena di fallback, in ordine. Lista vuota = plugin disattivato, `web_search` ricade sul provider DSH. |
| `searxng_url` | — | URL base di un'istanza SearXNG, es. `http://localhost:8080`. Necessario per `searxng`. |
| `default_max_results` | `5` | Numero massimo di fonti per query (1–20). |
| `default_timeout_ms` | `10000` | Timeout per singolo backend (1 000–60 000 ms). |
| `cache_ttl_seconds` | `60` | TTL della cache per query identiche. `0` la disattiva. |

Esempio con SearXNG in testa alla catena:

```yaml
plugins:
  - id: websearch-stack
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
| `tavily` | opzionale | Senza chiave invia l'header `x-tavily-access-mode: keyless`. Con chiave, `Bearer`. |
| `parallel-mcp` | no | JSON-RPC `tools/call` su `web_search`, senza credenziali. |
| `searxng` | no | Istanza self-hosted, richiede `searxng_url`. |

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

- **Servizi reali non verificati.** Gli header e il formato di Tavily e di Parallel MCP sono implementati dal brief di progetto, non confermati contro il servizio live. Prima della 0.1.0 vanno testati con chiamate reali.
- **Nessuna UI.** La pagina di configurazione è rinviata a una fase successiva: la configurazione avviene solo tramite YAML.
- **Nessun fetch.** Il fetch di pagine è gestito dal provider `dsh-web-fetch-http` di DSH, non da questo plugin.
- **Il plugin non è sandbox.** Il codice gira nel processo host con i suoi privilegi, come ogni plugin DSH.

## Licenza

MIT, vedi [LICENSE](LICENSE).
