/**
 * Обёртка над localStorage: любая ошибка (приватный режим, квота, запрет) — тихий переход
 * на хранилище в памяти, чтобы игра работала всегда.
 */
export interface KV {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

class MemoryKV implements KV {
  private readonly map = new Map<string, string>();
  get(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  set(key: string, value: string): void {
    this.map.set(key, value);
  }
  remove(key: string): void {
    this.map.delete(key);
  }
}

class SafeKV implements KV {
  private readonly memory = new MemoryKV();
  private broken = false;

  private ls(): Storage | null {
    if (this.broken) return null;
    try {
      return typeof localStorage !== 'undefined' ? localStorage : null;
    } catch {
      this.broken = true;
      return null;
    }
  }

  get(key: string): string | null {
    const ls = this.ls();
    if (ls) {
      try {
        return ls.getItem(key) ?? this.memory.get(key);
      } catch {
        this.broken = true;
      }
    }
    return this.memory.get(key);
  }

  set(key: string, value: string): void {
    this.memory.set(key, value);
    const ls = this.ls();
    if (!ls) return;
    try {
      ls.setItem(key, value);
    } catch {
      // Квота или запрет — остаёмся в памяти.
    }
  }

  remove(key: string): void {
    this.memory.remove(key);
    const ls = this.ls();
    if (!ls) return;
    try {
      ls.removeItem(key);
    } catch {
      // игнорируем
    }
  }
}

export const storage: KV = new SafeKV();
export { MemoryKV };
