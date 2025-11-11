interface ChunkBuffer {
  nodeId: string;
  chunks: Map<number, Uint8Array>;
  totalChunks: number;
  receivedChunks: number;
  createdAt: number;
}

export class ImageAssembler {
  private readonly buffers = new Map<string, ChunkBuffer>();
  private readonly TIMEOUT_MS = 30000;

  addChunk(nodeId: string, chunkIndex: number, data: number[], totalChunks: number): void {
    if (!this.buffers.has(nodeId)) {
      this.buffers.set(nodeId, {
        nodeId,
        chunks: new Map(),
        totalChunks,
        receivedChunks: 0,
        createdAt: Date.now()
      });
    }

    const buffer = this.buffers.get(nodeId)!;
    const uint8Array = new Uint8Array(data);
    if (!buffer.chunks.has(chunkIndex)) {
      buffer.chunks.set(chunkIndex, uint8Array);
      buffer.receivedChunks += 1;
    }
  }

  isComplete(nodeId: string): boolean {
    const buffer = this.buffers.get(nodeId);
    if (!buffer) return false;
    return buffer.receivedChunks === buffer.totalChunks;
  }

  assemble(nodeId: string): Uint8Array | null {
    const buffer = this.buffers.get(nodeId);
    if (!buffer || !this.isComplete(nodeId)) {
      return null;
    }

    const totalSize = Array.from(buffer.chunks.values()).reduce((acc, chunk) => acc + chunk.length, 0);
    const assembled = new Uint8Array(totalSize);
    let offset = 0;

    for (let index = 0; index < buffer.totalChunks; index += 1) {
      const chunk = buffer.chunks.get(index);
      if (!chunk) {
        console.error(`Missing chunk ${index} for node ${nodeId}`);
        return null;
      }
      assembled.set(chunk, offset);
      offset += chunk.length;
    }

    this.buffers.delete(nodeId);
    return assembled;
  }

  cleanupTimedOut(): string[] {
    const now = Date.now();
    const timedOut: string[] = [];

    for (const [nodeId, buffer] of this.buffers.entries()) {
      if (now - buffer.createdAt > this.TIMEOUT_MS) {
        timedOut.push(nodeId);
        this.buffers.delete(nodeId);
      }
    }

    return timedOut;
  }

  getStatus(): { nodeId: string; progress: string; age: number }[] {
    const now = Date.now();
    return Array.from(this.buffers.entries()).map(([nodeId, buffer]) => ({
      nodeId,
      progress: `${buffer.receivedChunks}/${buffer.totalChunks}`,
      age: now - buffer.createdAt
    }));
  }
}
