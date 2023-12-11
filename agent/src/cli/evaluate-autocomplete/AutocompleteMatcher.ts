import * as vscode from 'vscode'
import Parser, { Tree } from 'web-tree-sitter'

import { getParseLanguage, SupportedLanguage } from '../../../../vscode/src/tree-sitter/grammars'
import { createParser } from '../../../../vscode/src/tree-sitter/parser'

import { EvaluationDocument, EvaluationDocumentParams } from './EvaluationDocument'
import { Queries } from './Queries'

export type AutocompleteMatchKind = 'if_statement' | 'call_expression' | 'assignment_statement' | 'function_declaration'
export interface AutocompleteMatch {
    kind: AutocompleteMatchKind
    newText: string
    removedText: string
    removedRange: vscode.Range
    requestPosition: vscode.Position
}
export class AutocompleteMatcher {
    public parser: Parser | undefined
    public originalTree: Tree | undefined
    public originalTreeIsFreeOfErrrors: boolean | undefined
    constructor(
        public readonly params: EvaluationDocumentParams,
        public readonly queries: Queries
    ) {}
    private ifSyntax(language: SupportedLanguage): string {
        switch (language) {
            case SupportedLanguage.Go:
                return 'if  '
            default:
                return 'if ()'
        }
    }
    public async matches(text: string): Promise<AutocompleteMatch[] | undefined> {
        const language = getParseLanguage(this.params.languageid)
        if (!language) {
            return undefined
        }
        const parser = await createParser({ language })
        if (!parser) {
            return undefined
        }
        this.parser = parser

        const query = await this.queries.loadQuery(this.parser, language, 'context')
        if (!query) {
            return
        }
        this.originalTree = this.parser.parse(text)
        this.originalTreeIsFreeOfErrrors = !this.originalTree.rootNode.hasError()
        const result: AutocompleteMatch[] = []
        const document = new EvaluationDocument(this.params, text, vscode.Uri.file(this.params.filepath))
        for (const queryMatch of query.matches(this.originalTree.rootNode)) {
            for (const capture of queryMatch.captures) {
                if (capture.name === 'if_statement') {
                    const ifSyntax = this.ifSyntax(language)

                    const newText = [
                        text.slice(0, capture.node.startIndex),
                        ifSyntax,
                        text.slice(capture.node.endIndex),
                    ]
                    result.push({
                        kind: 'if_statement',
                        newText: newText.join(''),
                        removedText: capture.node.text,
                        removedRange: new vscode.Range(
                            document.textDocument.positionAt(capture.node.startIndex),
                            document.textDocument.positionAt(capture.node.endIndex)
                        ),
                        requestPosition: document.textDocument.positionAt(
                            capture.node.startIndex + ifSyntax.length - 1
                        ),
                    })
                } else if (capture.name === 'function_declaration') {
                    const openParen = queryMatch.captures.find(c => c.name === 'opening_paren')?.node
                    if (!openParen) {
                        throw new Error('Missing capture group @opening_paren for @function_declaration')
                    }
                    const newText = [text.slice(0, openParen.startIndex), '()', text.slice(capture.node.endIndex)]
                    result.push({
                        kind: 'function_declaration',
                        newText: newText.join(''),
                        removedText: capture.node.text,
                        removedRange: new vscode.Range(
                            document.textDocument.positionAt(capture.node.startIndex),
                            document.textDocument.positionAt(capture.node.endIndex)
                        ),
                        requestPosition: document.textDocument.positionAt(openParen.startIndex + '('.length),
                    })
                } else if (capture.name === 'call_expression') {
                    const openParenPosition = queryMatch.captures.find(c => c.name === 'opening_paren')?.node.startIndex
                    const closeParenPosition = queryMatch.captures.find(c => c.name === 'closing_paren')?.node.endIndex
                    if (openParenPosition && closeParenPosition) {
                        const openParenSyntax = text.charAt(openParenPosition) ?? '('
                        const closeParenSyntax = text.charAt(closeParenPosition - 1) ?? ')'
                        if (
                            closeParenSyntax !== ')' &&
                            closeParenSyntax !== '}' &&
                            closeParenSyntax !== ']' &&
                            closeParenSyntax !== '>'
                        ) {
                            throw new Error(
                                `Invalid close paren syntax. ${JSON.stringify({
                                    params: this.params,
                                    closeParenSyntax,
                                })}`
                            )
                        }
                        const newText = [
                            text.slice(0, openParenPosition),
                            openParenSyntax,
                            closeParenSyntax,
                            text.slice(closeParenPosition),
                        ]
                        result.push({
                            kind: 'call_expression',
                            newText: newText.join(''),
                            removedText: text.slice(openParenPosition, closeParenPosition),
                            removedRange: new vscode.Range(
                                document.textDocument.positionAt(openParenPosition),
                                document.textDocument.positionAt(closeParenPosition)
                            ),
                            requestPosition: document.textDocument.positionAt(
                                openParenPosition + openParenSyntax.length
                            ),
                        })
                        continue
                    } else {
                        throw new Error(
                            'Missing @opening_paren and/or @closing_parent captures for node: ' + capture.node.text
                        )
                    }
                } else if (capture.name === 'assignment_statement') {
                    const equalSign = queryMatch.captures.find(c => c.name === 'equal_sign')?.node
                    if (equalSign) {
                        const startIndex = equalSign.startIndex
                        const endIndex =
                            text.at(capture.node.endIndex) === ';' ? capture.node.endIndex + 1 : capture.node.endIndex
                        const newText = [text.slice(0, startIndex), text.slice(endIndex)]
                        result.push({
                            kind: 'assignment_statement',
                            newText: newText.join(''),
                            removedText: text.slice(startIndex, endIndex),
                            removedRange: new vscode.Range(
                                document.textDocument.positionAt(startIndex),
                                document.textDocument.positionAt(endIndex)
                            ),
                            requestPosition: document.textDocument.positionAt(startIndex - 1),
                        })
                        continue
                    } else {
                        throw new Error('Missing @equal_sign capture for node: ' + capture.node.text)
                    }
                }
            }
        }

        return result
    }
}
