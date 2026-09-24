import { readFile } from 'node:fs/promises';
// pdf-parse has no bundled types config exercised by its own package.json
// "main"; @types/pdf-parse covers the default export shape used here.
import pdfParse from 'pdf-parse';
import { ValidationError } from '../../core/errors';

export interface DocumentRef {
  documentId: string;
  caseId: string;
  blobPath: string;
  mimeType: string;
}

export interface ExtractedPage {
  pageNumber: number;
  text: string;
}

export interface ExtractionResult {
  text: string;
  pages: ExtractedPage[];
}

/**
 * `IDocumentProcessor` per IMPLEMENTATION-DECISIONS.md (D7). MVP has two
 * concrete implementations (PDF, plain text); the interface is the
 * preserved extension point for scanned/OCR and Hindi/multilingual
 * processors mentioned in the same decision, without document-intelligence
 * consumers (case-platform, brain) needing to change.
 */
export interface IDocumentProcessor {
  supportedMimeTypes: string[];
  /**
   * MVP no-op: evidence-store already wrote+hashed the blob on upload (the
   * one authoritative ingestion path — see SOURCE-OF-TRUTH.md #1). This
   * exists so the interface matches D7 exactly and a future processor
   * (e.g. OCR) has a real hook to pre-process a file before `extract`.
   */
  ingest(ref: DocumentRef): Promise<DocumentRef>;
  extract(ref: DocumentRef): Promise<ExtractionResult>;
}

class PlainTextProcessor implements IDocumentProcessor {
  supportedMimeTypes = ['text/plain'];

  async ingest(ref: DocumentRef): Promise<DocumentRef> {
    return ref;
  }

  async extract(ref: DocumentRef): Promise<ExtractionResult> {
    const buffer = await readFile(ref.blobPath);
    const text = buffer.toString('utf-8');
    return { text, pages: [{ pageNumber: 1, text }] };
  }
}

class PdfTextProcessor implements IDocumentProcessor {
  supportedMimeTypes = ['application/pdf'];

  async ingest(ref: DocumentRef): Promise<DocumentRef> {
    return ref;
  }

  async extract(ref: DocumentRef): Promise<ExtractionResult> {
    const buffer = await readFile(ref.blobPath);
    const pages: ExtractedPage[] = [];

    // pdf-parse's pagerender hook fires once per page during parsing —
    // capturing text there is how we preserve page numbers (D7: "preserve
    // page information where possible"), since the default `.text` output
    // is the whole document concatenated with no page boundaries.
    // PDF.js expects typed-array copy semantics; Node Buffer.slice() returns
    // shared views and can corrupt its cross-reference parsing. Pass an owned
    // Uint8Array. pdf-parse's old declarations incorrectly restrict this to Buffer.
    const result = await pdfParse(new Uint8Array(buffer) as unknown as Buffer, {
      pagerender: async (pageData: {
        getTextContent: () => Promise<{ items: Array<{ str: string; transform?: number[] }> }>;
        pageNumber: number;
      }) => {
        const content = await pageData.getTextContent();
        let lastY: number | undefined;
        const pageText = content.items.map((item, index) => {
          const y = item.transform?.[5];
          const separator = index === 0 ? '' : lastY !== undefined && y !== undefined && y !== lastY ? '\n' : ' ';
          lastY = y;
          return separator + item.str;
        }).join('');
        pages.push({ pageNumber: pageData.pageNumber, text: pageText });
        return pageText;
      },
    });

    pages.sort((a, b) => a.pageNumber - b.pageNumber);

    return {
      text: pages.length > 0 ? pages.map((p) => p.text).join('\n') : result.text,
      pages: pages.length > 0 ? pages : [{ pageNumber: 1, text: result.text }],
    };
  }
}

const processors: IDocumentProcessor[] = [new PdfTextProcessor(), new PlainTextProcessor()];

/** Registry lookup by mimeType — the extension point future processors (OCR, Hindi) plug into. */
export function getDocumentProcessor(mimeType: string): IDocumentProcessor {
  const processor = processors.find((p) => p.supportedMimeTypes.includes(mimeType));
  if (!processor) {
    throw new ValidationError(`No document processor registered for mime type: ${mimeType}`);
  }
  return processor;
}
