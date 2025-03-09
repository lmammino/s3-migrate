import { Transform, type TransformOptions } from 'node:stream'

// AWS recommends at least 64 KB chunks for optimal performance
// (ref: https://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-streaming.html)
// We are OK to allocate 2 MB per chunk by default (to avoid too many small chunks)
const RECOMMENDED_CHUNK_SIZE = 2 * 1024 * 1024
const MIN_CHUNK_SIZE = 8 * 1024

export class ChunkSizeTransform extends Transform {
  private buffer: Buffer = Buffer.alloc(0)
  private chunkSize: number

  constructor(chunkSize = RECOMMENDED_CHUNK_SIZE, options?: TransformOptions) {
    super(options)
    this.chunkSize = Math.max(chunkSize, MIN_CHUNK_SIZE)
  }

  override _transform(chunk: Buffer, _encoding: string, cb: () => void) {
    // Append the new chunk to the buffer
    this.buffer = Buffer.concat([this.buffer, chunk])

    // If the buffer is larger than or equal to chunkSize, push exactly chunkSize
    while (this.buffer.length >= this.chunkSize) {
      this.push(this.buffer.subarray(0, this.chunkSize))
      this.buffer = this.buffer.subarray(this.chunkSize)
    }

    cb()
  }

  override _flush(cb: () => void) {
    // Push any remaining data in the buffer (last chunk can be smaller than 8kb)
    if (this.buffer.length > 0) {
      this.push(this.buffer)
    }
    cb()
  }
}
