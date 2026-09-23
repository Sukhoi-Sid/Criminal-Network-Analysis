import { randomUUID } from 'node:crypto';

export interface DomainEvent {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  timestamp: number;
}

export interface DomainEventHandler<T extends DomainEvent = DomainEvent> {
  handle(event: T): Promise<void>;
}

export class DomainEventBus {
  private handlers = new Map<string, DomainEventHandler[]>();

  subscribe<T extends DomainEvent>(type: string, handler: DomainEventHandler<T>): void {
    const key = type;
    if (!this.handlers.has(key)) {
      this.handlers.set(key, []);
    }
    this.handlers.get(key)!.push(handler as DomainEventHandler<DomainEvent>);
  }

  async publish<T extends DomainEvent>(event: T): Promise<void> {
    const key = event.type;
    const handlers = this.handlers.get(key);
    if (!handlers) {
      return;
    }
    for (const handler of handlers) {
      await handler.handle(event as never);
    }
  }

  generateId(): string {
    return randomUUID();
  }
}

export const eventBus = new DomainEventBus();
