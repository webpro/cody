import { URI } from 'vscode-uri'

/**
 * A file URI.
 *
 * It is helpful to use the {@link FileURI} type instead of just {@link URI} or {@link vscode.Uri}
 * when the URI is known to be `file`-scheme-only.
 */
export type FileURI = URI & { scheme: 'file' }

declare module 'vscode-uri' {
    export class URI {
        static file(fsPath: string): FileURI
    }
}
