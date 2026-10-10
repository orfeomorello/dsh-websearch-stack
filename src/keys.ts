/**
 * API keys, resolved from the Host credentials service and read
 * synchronously by the backends.
 *
 * A provider's `available()` must be local and free of I/O, so a key is
 * resolved once at startup and re-resolved when the Host reports its reference
 * changed; the backend then reads it per operation through `of()`, which is
 * what lets a rotated key land on the next request.
 */

/** Credential references the key-backed backends resolve, by environment name. */
export const KEY_REFERENCES = ['TAVILY_API_KEY', 'BRAVE_SEARCH_API_KEY', 'TINYFISH_API_KEY', 'EXA_API_KEY'] as const
export type KeyReference = (typeof KEY_REFERENCES)[number]

/** The face of the Host credentials service the store resolves through. */
export interface CredentialsLike {
  resolve(ref: string): Promise<{ value?: unknown } | undefined>
}

/** Emit event the Host publishes when one credential reference changes. */
export const REFERENCE_UPDATED_EVENT = 'credentials/reference-updated'

export class KeyStore {
  private readonly values = new Map<KeyReference, string | undefined>()

  /**
   * @param credentials - the Host credentials service, or undefined when this
   * deployment does not serve one: keys then come from the environment only.
   */
  constructor(private readonly credentials: CredentialsLike | undefined) {}

  /** Resolve every reference once: the credentials service first, the
   * environment as the fallback. */
  async sync(): Promise<void> {
    for (const ref of KEY_REFERENCES) {
      this.values.set(ref, this.withFallback(await this.fromService(ref), ref))
    }
  }

  /** Re-read one reference after the Host reports it changed. */
  async refresh(ref: KeyReference): Promise<void> {
    this.values.set(ref, this.withFallback(await this.fromService(ref), ref))
  }

  /** The key one backend reads as it builds a request. */
  of(ref: KeyReference): string | undefined {
    return this.values.get(ref)
  }

  /** The credentials service owns precedence; the environment is the fallback. */
  private withFallback(fromService: string | undefined, ref: KeyReference): string | undefined {
    return fromService ?? process.env[ref]
  }

  private async fromService(ref: KeyReference): Promise<string | undefined> {
    if (this.credentials === undefined) return undefined
    try {
      const hit = await this.credentials.resolve(ref)
      const value = (hit as { value?: unknown } | undefined)?.value
      return typeof value === 'string' && value.length > 0 ? value : undefined
    } catch {
      return undefined
    }
  }
}
