type ConcatSinkOptions = {
  preventAbort?: boolean;

  preventClose?: boolean;
};

class ConcatSink<T> implements UnderlyingSink<T> {
  readonly #gen:
    | Iterable<WritableStream<T>>
    | AsyncIterable<WritableStream<T>>
    | (() => Generator<WritableStream<T>>)
    | (() => AsyncGenerator<WritableStream<T>>);

  readonly #options: ConcatSinkOptions | undefined;

  #iter:
    | Iterator<WritableStream<T>>
    | AsyncIterator<WritableStream<T>>
    | undefined;

  #writer: WritableStreamDefaultWriter<T> | undefined;

  constructor(
    gen:
      | Iterable<WritableStream<T>>
      | AsyncIterable<WritableStream<T>>
      | (() => Generator<WritableStream<T>>)
      | (() => AsyncGenerator<WritableStream<T>>),
    options?: ConcatSinkOptions,
  ) {
    this.#gen = gen;
    this.#options = options;
  }

  async start() {
    if (Symbol.iterator in this.#gen) {
      this.#iter = this.#gen[Symbol.iterator]();
    } else if (Symbol.asyncIterator in this.#gen) {
      this.#iter = this.#gen[Symbol.asyncIterator]();
    } else {
      this.#iter = this.#gen();
    }

    await this.next();
  }

  async write(chunk: T) {
    if (!this.#writer) {
      throw new TypeError("Writer is undefined");
    }

    try {
      await this.#writer.ready;
      await this.#writer.write(chunk);
    } catch (err: unknown) {
      const nextWriter = await this.next(err);
      await nextWriter.ready;
      await nextWriter.write(chunk);
    }
  }

  async close() {
    await this.#iter?.return?.(undefined);

    if (!this.#options?.preventClose) {
      await this.#writer?.close();
    }

    this.#writer?.releaseLock();
  }

  async abort(reason?: unknown) {
    try {
      await this.#iter?.throw?.(reason);
    } catch {
      // noop
    }

    if (!this.#options?.preventAbort) {
      await this.#writer?.abort(reason);
    }

    this.#writer?.releaseLock();
  }

  private async next(reason?: unknown): Promise<WritableStreamDefaultWriter> {
    if (!this.#iter) {
      throw new TypeError("Iterator is undefined");
    }

    const result = await this.#iter.next(reason);
    if (result.done) {
      throw new RangeError("Writable stream iterator has ended");
    }

    // if (!this.#options?.preventClose) {
    //   await this.#writer?.close();
    // }

    this.#writer?.releaseLock();

    this.#writer = result.value.getWriter();
    return this.#writer;
  }
}

export type ConcatWritableStreamOptions = ConcatSinkOptions;

export class ConcatWritableStream<T> extends WritableStream<T> {
  constructor(
    streams:
      | Iterable<WritableStream<T>>
      | AsyncIterable<WritableStream<T>>
      | (() => Generator<WritableStream<T>>)
      | (() => AsyncGenerator<WritableStream<T>>),
    options?: ConcatWritableStreamOptions,
  ) {
    super(new ConcatSink<T>(streams, options));
  }
}

export function concatWritableStreams<T>(
  streams:
    | Iterable<WritableStream<T>>
    | AsyncIterable<WritableStream<T>>
    | (() => Generator<WritableStream<T>>)
    | (() => AsyncGenerator<WritableStream<T>>),
  options?: ConcatWritableStreamOptions,
) {
  return new ConcatWritableStream<T>(streams, options);
}
