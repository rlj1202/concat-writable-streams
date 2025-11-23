import { describe, expect, it } from "vitest";
import { concatWritableStreams } from "../index.js";

describe("concat-writable-streams", () => {
  it("should concatenate all writable streams", async () => {
    const a = new InMemoryWritableStream<string>();
    const b = new InMemoryWritableStream<string>();
    const c = new InMemoryWritableStream<string>();
    const d = new InMemoryWritableStream<string>();

    await toReadableStream(["A", "B", "C", "D", "E", "F", "G"]).pipeTo(
      concatWritableStreams([
        new LimitedWritableStream(2, a),
        new LimitedWritableStream(2, b),
        new LimitedWritableStream(2, c),
        new LimitedWritableStream(2, d),
      ]),
    );

    expect(a.data).toStrictEqual(["A", "B"]);
    expect(b.data).toStrictEqual(["C", "D"]);
    expect(c.data).toStrictEqual(["E", "F"]);
    expect(d.data).toStrictEqual(["G"]);

    expect(a.locked).toBeFalsy();
    expect(b.locked).toBeFalsy();
    expect(c.locked).toBeFalsy();
    expect(d.locked).toBeFalsy();
  });

  it("should throw a range error when writable streams are exhausted", async () => {
    const promise = toReadableStream(function* () {
      for (let i = 0; i < 10; i++) {
        yield `${i}`;
      }
    }).pipeTo(
      concatWritableStreams([
        new LimitedWritableStream(2, new InMemoryWritableStream()),
        new LimitedWritableStream(2, new InMemoryWritableStream()),
        new LimitedWritableStream(2, new InMemoryWritableStream()),
      ]),
    );

    await expect(promise).rejects.toThrow(RangeError);
  });

  it("should ensure fianlly block inside a generator to be executed", async () => {
    let cnt: number = 0;

    await toReadableStream(function* () {
      for (let i = 0; i < 10; i++) {
        yield `${i}`;
      }
    }).pipeTo(
      concatWritableStreams(function* () {
        for (let i = 0; i < 3; i++) {
          try {
            yield new LimitedWritableStream(5, new InMemoryWritableStream());
          } finally {
            cnt++;
          }
        }
      }),
    );

    expect(cnt).toStrictEqual(2);
  });
});

function toReadableStream<T>(
  iterable:
    | Iterable<T>
    | AsyncIterable<T>
    | (() => Generator<T>)
    | (() => AsyncGenerator<T>),
): ReadableStream<T> {
  return new ReadableStream({
    start: async (controller) => {
      let iter: Iterator<T> | AsyncIterator<T>;
      if (Symbol.iterator in iterable) {
        iter = iterable[Symbol.iterator]();
      } else if (Symbol.asyncIterator in iterable) {
        iter = iterable[Symbol.asyncIterator]();
      } else {
        iter = iterable();
      }

      let result = await iter.next();
      while (!result.done) {
        controller.enqueue(result.value);
        result = await iter.next();
      }

      controller.close();
    },
  });
}

class LimitedWritableStream<T> extends WritableStream<T> {
  #read = 0;

  constructor(
    size: number,
    writable: WritableStream<T>,
    options?: { preventAbort?: boolean; preventClose?: boolean },
  ) {
    let writer: WritableStreamDefaultWriter<T> | undefined;

    super({
      start: () => {
        writer = writable.getWriter();
      },

      write: async (chunk) => {
        if (this.#read + 1 > size) {
          if (!options?.preventClose) {
            writer?.close();
          }
          writer?.releaseLock();
          throw new RangeError(`Exceeded chunk limit of '${size}'`);
        }

        this.#read++;

        await writer?.ready;
        await writer?.write(chunk);
      },

      abort: async (reason) => {
        if (!options?.preventAbort) {
          await writer?.abort(reason);
        }

        writer?.releaseLock();
      },

      close: async () => {
        if (!options?.preventClose) {
          await writer?.close();
        }

        writer?.releaseLock();
      },
    });
  }
}

class InMemoryWritableStream<T> extends WritableStream<T> {
  #buffer: T[] = [];

  constructor() {
    super({
      write: (chunk) => {
        this.#buffer.push(chunk);
      },
    });
  }

  get data(): T[] {
    return this.#buffer;
  }
}
