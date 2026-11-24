// ============================================================
// cache.js — Cache TTL en memoria (sin dependencias externas)
// ============================================================
// Estructura:
//   Map<key, { value, expiresAt }>
//
// Funciona para una sola instancia. Para multi-instancia se necesitaría
// Redis u otra cache distribuida (fuera del alcance de este MVP).

export class TtlCache {
  constructor(ttlSeconds = 60) {
    this.ttl = ttlSeconds * 1000;
    this.store = new Map();
    // Limpieza periódica de entradas expiradas
    this._gcInterval = setInterval(() => this._gc(), 60_000).unref?.();
  }

  _gc() {
    const now = Date.now();
    for (const [k, v] of this.store) {
      if (v.expiresAt < now) this.store.delete(k);
    }
  }

  get(key) {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key, value, ttlOverrideMs) {
    const expiresAt = Date.now() + (ttlOverrideMs ?? this.ttl);
    this.store.set(key, { value, expiresAt });
  }

  has(key) {
    return this.get(key) !== undefined;
  }

  delete(key) {
    this.store.delete(key);
  }

  clear() {
    this.store.clear();
  }

  size() {
    return this.store.size;
  }
}
