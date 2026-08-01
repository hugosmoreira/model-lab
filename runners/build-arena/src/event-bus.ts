/**
 * Minimal async event bus: push events in, consume via `for await`, plus
 * synchronous subscribe() side-taps (e.g. persistence, SSE fan-out).
 * Single async-iterator consumer semantics; buffered until consumed.
 */
export class EventBus<T> implements AsyncIterable<T> {
  private buffer: T[] = [];
  private waiters: Array<(result: IteratorResult<T>) => void> = [];
  private listeners = new Set<(event: T) => void>();
  private closed = false;

  emit(event: T): void {
    if (this.closed) return;
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // subscriber errors never break the stream
      }
    }
    const waiter = this.waiters.shift();
    if (waiter !== undefined) {
      waiter({ value: event, done: false });
    } else {
      this.buffer.push(event);
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const waiter of this.waiters) {
      waiter({ value: undefined as never, done: true });
    }
    this.waiters = [];
  }

  /** Returns an unsubscribe function. */
  subscribe(listener: (event: T) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: (): Promise<IteratorResult<T>> => {
        const buffered = this.buffer.shift();
        if (buffered !== undefined) {
          return Promise.resolve({ value: buffered, done: false });
        }
        if (this.closed) {
          return Promise.resolve({ value: undefined as never, done: true });
        }
        return new Promise<IteratorResult<T>>((resolve) => {
          this.waiters.push(resolve);
        });
      },
    };
  }
}
