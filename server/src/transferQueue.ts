/**
 * Runs tasks strictly one after another. The node enforces the exact next
 * nonce per sender, so two faucet transfers in flight at once would sign the
 * same nonce and one of them would be rejected.
 */
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private count = 0;

  /** Tasks queued or running. */
  get pending(): number {
    return this.count;
  }

  run<T>(task: () => Promise<T>): Promise<T> {
    this.count++;
    const result = this.tail.then(task);
    // The chain must survive a failed task, otherwise every later transfer
    // would reject with the first error.
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result.finally(() => {
      this.count--;
    });
  }
}
