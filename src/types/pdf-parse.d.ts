declare module 'pdf-parse' {
  export interface PDFParseResult {
    text: string
    numpages: number
    info: Record<string, unknown>
    metadata: Record<string, unknown>
    version: string
  }

  function pdfParse(dataBuffer: Buffer | Uint8Array): Promise<PDFParseResult>
  export = pdfParse
}

declare module 'pdf-parse/lib/pdf-parse.js' {
  export * from 'pdf-parse'
  import pdfParse from 'pdf-parse'
  export default pdfParse
}
