declare module 'mammoth' {
  interface ConversionResult {
    value: string;
    messages: Array<{ type: string; message: string; error?: Error }>;
  }

  interface ConversionOptions {
    buffer?: Buffer;
    path?: string;
  }

  export function extractRawText(options: ConversionOptions): Promise<ConversionResult>;
  export function convertToHtml(options: ConversionOptions): Promise<ConversionResult>;
}
