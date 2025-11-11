import fetch from 'node-fetch';
import sharp from 'sharp';
import type { IRNode, ImageSource } from '../../ir';
import { CONFIG } from './config.js';

const MAX_IMAGE_DIMENSION = 4096; // Figma hard limit

interface ProcessingResult {
  success: boolean;
  buffer?: Buffer;
  originalFormat?: string;
  convertedFormat?: string;
  error?: string;
}

export interface ProcessingStats {
  totalImages: number;
  inlineImages: number;
  streamedImages: number;
  failedImages: number;
  totalBytesProcessed: number;
}

export class ImageProcessor {
  private stats: ProcessingStats = {
    totalImages: 0,
    inlineImages: 0,
    streamedImages: 0,
    failedImages: 0,
    totalBytesProcessed: 0
  };

  async processImageForNode(
    node: IRNode & { imageSource?: ImageSource }
  ): Promise<{ buffer: Buffer; shouldStream: boolean } | null> {
    if (!node.imageSource?.resolvedUrl) {
      console.warn(`Node ${node.id} missing image source`);
      return null;
    }

    this.stats.totalImages += 1;

    const result = await this.fetchAndConvert(node.imageSource.resolvedUrl);

    if (!result.success || !result.buffer) {
      this.stats.failedImages += 1;
      node.imageProcessing = {
        originalFormat: result.originalFormat || 'unknown',
        wasConverted: false,
        processingError: result.error
      };
      return null;
    }

    node.imageProcessing = {
      originalFormat: result.originalFormat || 'unknown',
      convertedFormat: result.convertedFormat,
      wasConverted: (result.originalFormat || 'unknown') !== result.convertedFormat
    };

    this.stats.totalBytesProcessed += result.buffer.length;

    const shouldStream = result.buffer.length >= CONFIG.IMAGE_SIZE_THRESHOLD;
    if (shouldStream) {
      this.stats.streamedImages += 1;
    } else {
      this.stats.inlineImages += 1;
    }

    return { buffer: result.buffer, shouldStream };
  }

  private async fetchAndConvert(imageUrl: string): Promise<ProcessingResult> {
    if (imageUrl.startsWith('data:')) {
      return this.fromDataUrl(imageUrl);
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), CONFIG.IMAGE_TIMEOUT_MS);

      const response = await fetch(imageUrl, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; Web2Figma/1.0)',
          'Accept': 'image/webp,image/png,image/jpeg,image/*;q=0.8'
        }
      });

      clearTimeout(timeout);

      if (!response.ok) {
        return {
          success: false,
          error: `HTTP ${response.status}: ${response.statusText}`
        };
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      const contentType = response.headers.get('content-type') || '';
      const detectedFormat = await this.detectFormat(buffer, contentType);
      const processed = await this.convertIfNeeded(buffer, detectedFormat);

      return {
        success: true,
        buffer: processed.buffer,
        originalFormat: detectedFormat,
        convertedFormat: processed.converted ? 'png' : detectedFormat
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  private async fromDataUrl(dataUrl: string): Promise<ProcessingResult> {
    const commaIndex = dataUrl.indexOf(',');
    if (commaIndex === -1) {
      return { success: false, error: 'Invalid data URL' };
    }

    const header = dataUrl.substring(0, commaIndex);
    const data = dataUrl.substring(commaIndex + 1);
    const isBase64 = header.includes(';base64');

    try {
      const buffer = Buffer.from(data, isBase64 ? 'base64' : 'utf8');
      const format = this.detectFormatFromDataUrl(header) || 'unknown';
      const processed = await this.convertIfNeeded(buffer, format);

      return {
        success: true,
        buffer: processed.buffer,
        originalFormat: format,
        convertedFormat: processed.converted ? 'png' : format
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown data URL error'
      };
    }
  }

  private async detectFormat(buffer: Buffer, contentType: string): Promise<string> {
    if (contentType.includes('png')) return 'png';
    if (contentType.includes('jpeg') || contentType.includes('jpg')) return 'jpeg';
    if (contentType.includes('gif')) return 'gif';
    if (contentType.includes('webp')) return 'webp';
    if (contentType.includes('svg')) return 'svg';

    if (buffer[0] === 0x89 && buffer[1] === 0x50) return 'png';
    if (buffer[0] === 0xff && buffer[1] === 0xd8) return 'jpeg';
    if (buffer[0] === 0x47 && buffer[1] === 0x49) return 'gif';
    if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46) {
      if (buffer[8] === 0x57 && buffer[9] === 0x45) return 'webp';
    }

    return 'unknown';
  }

  private detectFormatFromDataUrl(header: string): string | undefined {
    const match = header.match(/data:image\/([^;,]+)/i);
    if (match && match[1]) {
      const value = match[1].toLowerCase();
      if (value === 'jpg') return 'jpeg';
      return value;
    }
    return undefined;
  }

  private async convertIfNeeded(
    buffer: Buffer,
    format: string
  ): Promise<{ buffer: Buffer; converted: boolean }> {
    const needsConversion = ['webp', 'avif', 'unknown'].includes(format);

    try {
      const image = sharp(buffer);
      const metadata = await image.metadata();

      const needsResize =
        (metadata.width && metadata.width > MAX_IMAGE_DIMENSION) ||
        (metadata.height && metadata.height > MAX_IMAGE_DIMENSION);

      if (needsConversion || needsResize) {
        let pipeline = sharp(buffer);

        if (needsResize) {
          pipeline = pipeline.resize(MAX_IMAGE_DIMENSION, MAX_IMAGE_DIMENSION, {
            fit: 'inside',
            withoutEnlargement: true
          });
        }

        const convertedBuffer = await pipeline.png().toBuffer();
        return { buffer: convertedBuffer, converted: true };
      }

      return { buffer, converted: false };
    } catch (error) {
      console.error('Sharp processing failed:', error);
      return { buffer, converted: false };
    }
  }

  getStats(): ProcessingStats {
    return { ...this.stats };
  }

  resetStats(): void {
    this.stats = {
      totalImages: 0,
      inlineImages: 0,
      streamedImages: 0,
      failedImages: 0,
      totalBytesProcessed: 0
    };
  }
}
