export type CommandHandler<TInput, TOutput> = (payload: TInput) => Promise<TOutput>;

export class InProcessCommandService {
  private readonly handlers = new Map<string, CommandHandler<unknown, unknown>>();

  register<TInput, TOutput>(commandName: string, handler: CommandHandler<TInput, TOutput>): void {
    if (this.handlers.has(commandName)) {
      return;
    }

    this.handlers.set(commandName, handler as CommandHandler<unknown, unknown>);
  }

  async run<TInput, TOutput>(commandName: string, payload: TInput): Promise<TOutput> {
    const handler = this.handlers.get(commandName);
    if (!handler) {
      throw new Error(`Command not registered: ${commandName}`);
    }

    return (await handler(payload as unknown)) as TOutput;
  }
}

export const commandService = new InProcessCommandService();
