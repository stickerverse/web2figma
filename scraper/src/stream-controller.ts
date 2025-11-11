import { WebSocket } from 'ws';
import type {
  CompleteMessage,
  IRNode,
  ImageChunkMessage,
  StreamMessage
} from '../../ir';
import { ImageProcessor } from './image-processor.js';
import type { ProcessingStats } from './image-processor.js';
import { CONFIG } from './config.js';

export interface StreamPayload {
  nodes: IRNode[];
  fonts?: any[];
  tokens?: any;
}

export class StreamController {
  private sequenceNumber = 0;
  private readonly imageProcessor = new ImageProcessor();
  private totalNodes = 0;

  constructor(private readonly ws: WebSocket) {}

  async streamExtractedPage(payload: StreamPayload): Promise<void> {
    const { nodes, fonts = [], tokens } = payload;

    try {
      this.totalNodes = nodes.length;
      this.attachImageSources(nodes);
      await this.processAllImages(nodes);

      if (tokens) {
        this.send({
          type: 'TOKENS',
          payload: tokens,
          sequenceNumber: this.sequenceNumber++
        });
      }

      if (fonts.length > 0) {
        this.send({
          type: 'FONTS',
          payload: fonts,
          sequenceNumber: this.sequenceNumber++
        });
      }

      await this.streamNodes(nodes);
      await this.streamImageChunks(nodes);
      this.sendComplete();
    } catch (error) {
      this.sendError(error instanceof Error ? error.message : 'Unknown streaming error');
    }
  }

  private attachImageSources(nodes: IRNode[]): void {
    nodes.forEach((node) => {
      if (node.type !== 'IMAGE') return;
      const image = node.image;
      if (!image?.url) return;

      node.imageSource = {
        originalUrl: image.url,
        resolvedUrl: image.url,
        sourceType: image.sourceType || 'img',
        naturalWidth: image.naturalWidth,
        naturalHeight: image.naturalHeight,
        format: image.format
      };
    });
  }

  private async processAllImages(nodes: IRNode[]): Promise<void> {
    const imageNodes = nodes.filter((node) => node.type === 'IMAGE' && node.imageSource);

    if (imageNodes.length === 0) return;

    const concurrency = Math.max(1, CONFIG.MAX_CONCURRENT_IMAGES);

    for (let i = 0; i < imageNodes.length; i += concurrency) {
      const batch = imageNodes.slice(i, i + concurrency);

      await Promise.all(
        batch.map(async (node) => {
          const result = await this.imageProcessor.processImageForNode(node);
          if (!result) {
            return;
          }

          const { buffer, shouldStream } = result;

          if (shouldStream) {
            Object.assign(node, {
              imageChunkRef: {
                totalSize: buffer.length,
                totalChunks: Math.ceil(buffer.length / CONFIG.IMAGE_CHUNK_SIZE),
                chunkSize: CONFIG.IMAGE_CHUNK_SIZE,
                isStreamed: true as const
              }
            });

            (node as any)._imageBuffer = buffer;
            if (node.image) {
              delete node.image.data;
            }
          } else {
            const uint8Array = new Uint8Array(buffer);
            node.imageData = Array.from(uint8Array);
            if (node.image) {
              delete node.image.data;
            }
          }
        })
      );

      const processed = Math.min(i + concurrency, imageNodes.length);
      this.sendProgress({
        stage: 'processing_images',
        current: processed,
        total: imageNodes.length
      });
    }
  }

  private async streamNodes(nodes: IRNode[]): Promise<void> {
    const BATCH_SIZE = 50;

    for (let i = 0; i < nodes.length; i += BATCH_SIZE) {
      const batch = nodes.slice(i, i + BATCH_SIZE).map((node) => this.cloneForTransport(node));

      const message: StreamMessage = {
        type: 'NODES',
        payload: { nodes: batch },
        sequenceNumber: this.sequenceNumber++
      };

      this.send(message);
      await this.sleep(50);
    }
  }

  private async streamImageChunks(nodes: IRNode[]): Promise<void> {
    const streamedNodes = nodes.filter((node) => node.imageChunkRef?.isStreamed);

    if (streamedNodes.length === 0) {
      return;
    }

    for (const node of streamedNodes) {
      const buffer = (node as any)._imageBuffer as Buffer | undefined;
      if (!buffer) continue;

      const totalChunks = node.imageChunkRef!.totalChunks;

      for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
        const start = chunkIndex * CONFIG.IMAGE_CHUNK_SIZE;
        const end = Math.min(start + CONFIG.IMAGE_CHUNK_SIZE, buffer.length);
        const chunkBuffer = buffer.slice(start, end);

        const message: ImageChunkMessage = {
          type: 'IMAGE_CHUNK',
          nodeId: node.id,
          chunkIndex,
          totalChunks,
          data: Array.from(chunkBuffer),
          sequenceNumber: this.sequenceNumber++,
          timestamp: Date.now()
        };

        this.send(message);
        await this.sleep(10);
      }

      delete (node as any)._imageBuffer;

      this.sendProgress({
        stage: 'streaming_images',
        current: streamedNodes.indexOf(node) + 1,
        total: streamedNodes.length
      });
    }
  }

  private cloneForTransport(node: IRNode): IRNode {
    const cloned = JSON.parse(JSON.stringify(node)) as IRNode;
    return cloned;
  }

  private sendComplete(): void {
    const stats: ProcessingStats = this.imageProcessor.getStats();
    const message: CompleteMessage = {
      type: 'COMPLETE',
      totalNodes: this.totalNodes,
      totalImages: stats.totalImages,
      inlineImages: stats.inlineImages,
      streamedImages: stats.streamedImages,
      sequenceNumber: this.sequenceNumber++
    };

    this.send(message);
  }

  private sendProgress(data: any): void {
    const message: StreamMessage = {
      type: 'PROGRESS',
      payload: data,
      sequenceNumber: this.sequenceNumber++
    };

    this.send(message);
  }

  private sendError(error: string): void {
    const message: StreamMessage = {
      type: 'ERROR',
      payload: { message: error },
      sequenceNumber: this.sequenceNumber++
    };

    this.send(message);
  }

  private send(message: StreamMessage | ImageChunkMessage | CompleteMessage): void {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
