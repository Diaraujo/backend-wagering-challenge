export class InboxMessage {
  private constructor(
    public readonly messageId: string,
    public readonly consumerName: string,
    public readonly payloadHash: string,
    public readonly receivedAt: Date,
    private _processedAt?: Date,
  ) {}

  static receive(props: { messageId: string; consumerName: string; payloadHash: string }): InboxMessage {
    return new InboxMessage(props.messageId, props.consumerName, props.payloadHash, new Date());
  }

  static rehydrate(state: {
    messageId: string;
    consumerName: string;
    payloadHash: string;
    receivedAt: Date;
    processedAt?: Date;
  }): InboxMessage {
    return new InboxMessage(state.messageId, state.consumerName, state.payloadHash, state.receivedAt, state.processedAt);
  }

  get processedAt(): Date | undefined { return this._processedAt; }
  isProcessed(): boolean { return Boolean(this._processedAt); }
  markProcessed(at: Date): void { this._processedAt = at; }
}
