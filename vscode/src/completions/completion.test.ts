import dedent from 'dedent'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as vscode from 'vscode'
import { URI } from 'vscode-uri'

import {
    CompletionParameters,
    CompletionResponse,
} from '@sourcegraph/cody-shared/src/sourcegraph-api/completions/types'

import { vsCodeMocks } from '../testutils/mocks'

import { CodyCompletionItemProvider } from '.'
import { CompletionsCache } from './cache'
import { History } from './history'
import { createProviderConfig } from './providers/anthropic'

vi.mock('vscode', () => ({
    ...vsCodeMocks,
    InlineCompletionTriggerKind: {
        Invoke: 0,
        Automatic: 1,
    },
    workspace: {
        ...vsCodeMocks.workspace,
        asRelativePath(path: string) {
            return path
        },
        onDidChangeTextDocument() {
            return null
        },
    },
    window: {
        ...vsCodeMocks.window,
        visibleTextEditors: [],
        tabGroups: { all: [] },
    },
}))

vi.mock('./context-embeddings.ts', () => ({
    getContextFromEmbeddings: () => [],
}))

function createCompletionResponse(completion: string): CompletionResponse {
    return {
        completion,
        stopReason: 'unknown',
    }
}

const noopStatusBar = {
    startLoading: () => () => {},
} as any

const CURSOR_MARKER = '🔥'

describe('Cody completions', () => {
    /**
     * A test helper to trigger a completion request. The code example must include
     * a pipe character to denote the current cursor position.
     *
     * @example
     *   complete(`
     * async function foo() {
     *   ${CURSOR_MARKER}
     * }`)
     */
    let complete: (
        code: string,
        responses?: CompletionResponse[] | 'stall',
        languageId?: string,
        context?: vscode.InlineCompletionContext,
        triggerMoreEagerly?: boolean
    ) => Promise<{
        requests: CompletionParameters[]
        completions: vscode.InlineCompletionItem[]
    }>
    beforeEach(() => {
        const cache = new CompletionsCache()
        complete = async (
            code: string,
            responses?: CompletionResponse[] | 'stall',
            languageId: string = 'typescript',
            context: vscode.InlineCompletionContext = { triggerKind: 1, selectedCompletionInfo: undefined },
            triggerMoreEagerly = true
        ): Promise<{
            requests: CompletionParameters[]
            completions: vscode.InlineCompletionItem[]
        }> => {
            const requests: CompletionParameters[] = []
            let requestCounter = 0
            const completionsClient: any = {
                complete(params: CompletionParameters): Promise<CompletionResponse> {
                    requests.push(params)
                    if (responses === 'stall') {
                        // Creates a stalling request that never responds
                        return new Promise(() => {})
                    }
                    return Promise.resolve(responses?.[requestCounter++] || { completion: '', stopReason: 'unknown' })
                },
            }
            const providerConfig = createProviderConfig({
                completionsClient,
                contextWindowTokens: 2048,
            })
            const completionProvider = new CodyCompletionItemProvider({
                providerConfig,
                statusBar: noopStatusBar,
                history: new History(),
                codebaseContext: null as any,
                disableTimeouts: true,
                triggerMoreEagerly,
                cache,
            })

            if (!code.includes(CURSOR_MARKER)) {
                throw new Error('The test code must include a | to denote the cursor position')
            }

            const cursorIndex = code.indexOf(CURSOR_MARKER)
            const prefix = code.slice(0, cursorIndex)
            const suffix = code.slice(cursorIndex + CURSOR_MARKER.length)

            const codeWithoutCursor = prefix + suffix

            const token: any = {
                onCancellationRequested() {
                    return null
                },
            }
            const document: any = {
                filename: 'test.ts',
                uri: URI.parse('file:///test.ts'),
                languageId,
                lineAt(position: vscode.Position) {
                    const split = codeWithoutCursor.split('\n')
                    const content = split[position.line - 1]
                    return {
                        range: {
                            end: { line: position.line, character: content.length },
                        },
                    }
                },
                offsetAt(): number {
                    return 0
                },
                positionAt(): any {
                    const split = codeWithoutCursor.split('\n')
                    return { line: split.length, character: split[split.length - 1].length }
                },
                getText(range?: vscode.Range): string {
                    if (!range) {
                        return codeWithoutCursor
                    }
                    if (range.start.line === 0 && range.start.character === 0) {
                        return prefix
                    }
                    return suffix
                },
            }

            const splitPrefix = prefix.split('\n')
            const position: any = { line: splitPrefix.length, character: splitPrefix[splitPrefix.length - 1].length }

            const completions = await completionProvider.provideInlineCompletionItems(
                document,
                position,
                context,
                token
            )

            return {
                requests,
                completions: 'items' in completions ? completions.items : completions,
            }
        }
    })

    it('uses a more complex prompt for larger files', async () => {
        const { requests } = await complete(dedent`
            class Range {
                public startLine: number
                public startCharacter: number
                public endLine: number
                public endCharacter: number
                public start: Position
                public end: Position

                constructor(startLine: number, startCharacter: number, endLine: number, endCharacter: number) {
                    this.startLine = ${CURSOR_MARKER}
                    this.startCharacter = startCharacter
                    this.endLine = endLine
                    this.endCharacter = endCharacter
                    this.start = new Position(startLine, startCharacter)
                    this.end = new Position(endLine, endCharacter)
                }
            }
        `)

        expect(requests).toHaveLength(1)
        const messages = requests[0].messages
        expect(messages[messages.length - 1]).toMatchInlineSnapshot(`
            {
              "speaker": "assistant",
              "text": "Here is the code: <CODE5711>constructor(startLine: number, startCharacter: number, endLine: number, endCharacter: number) {
                    this.startLine =",
            }
        `)
        expect(requests[0].stopSequences).toEqual(['\n\nHuman:', '</CODE5711>', '\n\n'])
    })

    it('makes a request when in the middle of a word when triggerMoreEagerly is true', async () => {
        const { requests } = await complete(
            `foo${CURSOR_MARKER}`,
            [createCompletionResponse('()')],
            undefined,
            undefined,
            true
        )
        expect(requests).toHaveLength(1)
    })

    it('does not make a request when in the middle of a word when triggerMoreEagerly is false', async () => {
        const { requests } = await complete(`foo${CURSOR_MARKER}`, undefined, undefined, undefined, false)
        expect(requests).toHaveLength(0)
    })

    it('completes a single-line at the end of a sentence', async () => {
        const { completions } = await complete(`foo = ${CURSOR_MARKER}`, [createCompletionResponse("'bar'")])

        expect(completions[0].insertText).toBe("'bar'")
    })

    it('only complete one line in single line mode', async () => {
        const { completions } = await complete(
            `
        function test() {
            console.log(1);
            ${CURSOR_MARKER}
        }
        `,
            [createCompletionResponse('if (true) {\n        console.log(3);\n    }\n    console.log(4);')]
        )

        expect(completions[0].insertText).toBe('if (true) {')
    })

    it('completes a single-line at the middle of a sentence', async () => {
        const { completions } = await complete(`function bubbleSort(${CURSOR_MARKER})`, [
            createCompletionResponse('array) {'),
            createCompletionResponse('items) {'),
        ])

        expect(completions[0].insertText).toBe('array) {')
        expect(completions[1].insertText).toBe('items) {')
    })

    it('marks the rest of the line as to be replaced so closing characters in the same line suffix are properly merged', async () => {
        const { completions } = await complete(`function bubbleSort(${CURSOR_MARKER})`, [
            createCompletionResponse('array) {'),
        ])

        expect(completions[0].range).toMatchInlineSnapshot(`
          Range {
            "end": {
              "character": 21,
              "line": 1,
            },
            "start": {
              "character": 20,
              "line": 1,
            },
          }
        `)
    })

    it('does not make a request when context has a selectedCompletionInfo', async () => {
        const { requests } = await complete(`foo = ${CURSOR_MARKER}`, undefined, undefined, {
            selectedCompletionInfo: {
                range: {} as any,
                text: 'something',
            },
            triggerKind: 0,
        })

        expect(requests).toHaveLength(0)
    })

    it('preserves leading whitespace when prefix has no trailing whitespace', async () => {
        const { completions } = await complete(`const isLocalHost = window.location.host${CURSOR_MARKER}`, [
            createCompletionResponse(" === 'localhost'"),
        ])
        expect(completions[0].insertText).toBe(" === 'localhost'")
    })

    it('collapses leading whitespace when prefix has trailing whitespace', async () => {
        const { completions } = await complete(`const x = ${CURSOR_MARKER}`, [createCompletionResponse('\t7')])
        expect(completions[0].insertText).toBe('7')
    })

    it('should not trigger a request if there is text in the suffix for the same line', async () => {
        const { requests } = await complete(`foo: ${CURSOR_MARKER} = 123;`)
        expect(requests).toHaveLength(0)
    })

    it('should trigger a request if the suffix of the same line is only special tags', async () => {
        const { requests } = await complete(`if(${CURSOR_MARKER}) {`)
        expect(requests).toHaveLength(3)
    })

    describe('bad completion starts', () => {
        it.each([
            ['➕     1', '1'],
            ['\u200B   1', '1'],
            ['.      1', '1'],
            ['+  1', '1'],
            ['-  1', '1'],
        ])('fixes %s to %s', async (completion, expected) => {
            const { completions } = await complete(CURSOR_MARKER, [createCompletionResponse(completion)])
            expect(completions[0].insertText).toBe(expected)
        })
    })

    describe('odd indentation', () => {
        it('filters out odd indentation in single-line completions', async () => {
            const { completions } = await complete(`const foo = ${CURSOR_MARKER}`, [createCompletionResponse(' 1')])
            expect(completions[0].insertText).toBe('1')
        })
    })

    describe('multi-line completions', () => {
        it('honors a leading new line in the completion', async () => {
            const { completions } = await complete(
                dedent`
            describe('bubbleSort', () => {
                it('bubbleSort test case', () => {${CURSOR_MARKER}

                })
            })
            `,
                [
                    createCompletionResponse(`  \n        const unsortedArray = [4,3,78,2,0,2]
        const sortedArray = bubbleSort(unsortedArray)
        expect(sortedArray).toEqual([0,2,2,3,4,78])
    })
})`),
                ]
            )

            expect(completions[0].insertText).toMatchInlineSnapshot(`
              "
                      const unsortedArray = [4,3,78,2,0,2]
                      const sortedArray = bubbleSort(unsortedArray)
                      expect(sortedArray).toEqual([0,2,2,3,4,78])"
            `)
        })

        it('cuts-off redundant closing brackets on the start indent level', async () => {
            const { completions } = await complete(
                dedent`
            describe('bubbleSort', () => {
                it('bubbleSort test case', () => {${CURSOR_MARKER}

                })
            })
            `,
                [
                    createCompletionResponse(dedent`
                    const unsortedArray = [4,3,78,2,0,2]
                            const sortedArray = bubbleSort(unsortedArray)
                            expect(sortedArray).toEqual([0,2,2,3,4,78])
                        })
                    })`),
                ]
            )

            expect(completions[0].insertText).toMatchInlineSnapshot(`
              "const unsortedArray = [4,3,78,2,0,2]
                      const sortedArray = bubbleSort(unsortedArray)
                      expect(sortedArray).toEqual([0,2,2,3,4,78])"
            `)
        })

        it('keeps the closing bracket', async () => {
            const { completions } = await complete(`function printHello(${CURSOR_MARKER})`, [
                createCompletionResponse(" {\n    console.log('Hello');\n}"),
            ])

            expect(completions[0].insertText).toBe(" {\n    console.log('Hello');\n}")
        })

        it('triggers a multi-line completion at the start of a block', async () => {
            const { requests } = await complete(`function bubbleSort() {\n  ${CURSOR_MARKER}`)

            expect(requests).toHaveLength(3)
            expect(requests[0].stopSequences).not.toContain('\n')
        })

        it('uses an indentation based approach to cut-off completions', async () => {
            const { completions } = await complete(
                dedent`
                class Foo {
                    constructor() {
                        ${CURSOR_MARKER}
                    }
                }`,
                [
                    createCompletionResponse(dedent`
                    console.log('foo')
                        }

                        add() {
                            console.log('bar')
                        }`),
                    createCompletionResponse(dedent`
                    if (foo) {
                                console.log('foo1');
                            }
                        }

                        add() {
                            console.log('bar')
                        }`),
                ]
            )

            expect(completions[0].insertText).toBe("if (foo) {\n            console.log('foo1');\n        }")
            expect(completions[1].insertText).toBe("console.log('foo')")
        })

        it('cuts-off the whole completions when suffix is very similar to suffix line', async () => {
            const { completions } = await complete(
                dedent`
                function() {
                    ${CURSOR_MARKER}
                    console.log('bar')
                }`,
                [
                    createCompletionResponse(dedent`
                    console.log('foo')
                        console.log('bar')
                    }`),
                ]
            )

            expect(completions.length).toBe(0)
        })

        it('does not support multi-line completion on unsupported languages', async () => {
            const { requests } = await complete(`function looksLegit() {\n  ${CURSOR_MARKER}`, undefined, 'elixir')

            expect(requests).toHaveLength(1)
            expect(requests[0].stopSequences).toContain('\n\n')
        })

        it('requires an indentation to start a block', async () => {
            const { requests } = await complete(`function bubbleSort() {\n${CURSOR_MARKER}`)

            expect(requests).toHaveLength(1)
            expect(requests[0].stopSequences).toContain('\n\n')
        })

        it('works with python', async () => {
            const { completions, requests } = await complete(
                dedent`
                for i in range(11):
                    if i % 2 == 0:
                        ${CURSOR_MARKER}`,
                [
                    createCompletionResponse(dedent`
                    print(i)
                        elif i % 3 == 0:
                            print(f"Multiple of 3: {i}")
                        else:
                            print(f"ODD {i}")

                    for i in range(12):
                        print("unrelated")`),
                ],
                'python'
            )

            expect(requests).toHaveLength(3)
            expect(requests[0].stopSequences).not.toContain('\n')
            expect(completions[0].insertText).toMatchInlineSnapshot(`
                "print(i)
                    elif i % 3 == 0:
                        print(f\\"Multiple of 3: {i}\\")
                    else:
                        print(f\\"ODD {i}\\")"
            `)
        })

        it('works with java', async () => {
            const { completions, requests } = await complete(
                dedent`
                for (int i = 0; i < 11; i++) {
                    if (i % 2 == 0) {
                        ${CURSOR_MARKER}`,
                [
                    createCompletionResponse(dedent`
                    System.out.println(i);
                        } else if (i % 3 == 0) {
                            System.out.println("Multiple of 3: " + i);
                        } else {
                            System.out.println("ODD " + i);
                        }
                    }

                    for (int i = 0; i < 12; i++) {
                        System.out.println("unrelated");
                    }`),
                ],
                'java'
            )

            expect(requests).toHaveLength(3)
            expect(requests[0].stopSequences).not.toContain('\n')
            expect(completions[0].insertText).toMatchInlineSnapshot(`
                "System.out.println(i);
                    } else if (i % 3 == 0) {
                        System.out.println(\\"Multiple of 3: \\" + i);
                    } else {
                        System.out.println(\\"ODD \\" + i);
                    }"
            `)
        })

        // TODO: Detect `}\nelse\n{` pattern for else skip logic
        it('works with csharp', async () => {
            const { completions, requests } = await complete(
                dedent`
                for (int i = 0; i < 11; i++) {
                    if (i % 2 == 0)
                    {
                        ${CURSOR_MARKER}`,
                [
                    createCompletionResponse(dedent`
                    Console.WriteLine(i);
                        }
                        else if (i % 3 == 0)
                        {
                            Console.WriteLine("Multiple of 3: " + i);
                        }
                        else
                        {
                            Console.WriteLine("ODD " + i);
                        }

                    }

                    for (int i = 0; i < 12; i++)
                    {
                        Console.WriteLine("unrelated");
                    }`),
                ],
                'csharp'
            )

            expect(requests).toHaveLength(3)
            expect(requests[0].stopSequences).not.toContain('\n')
            expect(completions[0].insertText).toMatchInlineSnapshot(`
                "Console.WriteLine(i);
                    }"
            `)
        })

        it('works with c++', async () => {
            const { completions, requests } = await complete(
                dedent`
                for (int i = 0; i < 11; i++) {
                    if (i % 2 == 0) {
                        ${CURSOR_MARKER}`,
                [
                    createCompletionResponse(dedent`
                    std::cout << i;
                        } else if (i % 3 == 0) {
                            std::cout << "Multiple of 3: " << i;
                        } else  {
                            std::cout << "ODD " << i;
                        }
                    }

                    for (int i = 0; i < 12; i++) {
                        std::cout << "unrelated";
                    }`),
                ],
                'cpp'
            )

            expect(requests).toHaveLength(3)
            expect(requests[0].stopSequences).not.toContain('\n')
            expect(completions[0].insertText).toMatchInlineSnapshot(`
                "std::cout << i;
                    } else if (i % 3 == 0) {
                        std::cout << \\"Multiple of 3: \\" << i;
                    } else  {
                        std::cout << \\"ODD \\" << i;
                    }"
            `)
        })

        it('works with c', async () => {
            const { completions, requests } = await complete(
                dedent`
                for (int i = 0; i < 11; i++) {
                    if (i % 2 == 0) {
                        ${CURSOR_MARKER}`,
                [
                    createCompletionResponse(dedent`
                    printf("%d", i);
                        } else if (i % 3 == 0) {
                            printf("Multiple of 3: %d", i);
                        } else {
                            printf("ODD %d", i);
                        }
                    }

                    for (int i = 0; i < 12; i++) {
                        printf("unrelated");
                    }`),
                ],
                'c'
            )

            expect(requests).toHaveLength(3)
            expect(requests[0].stopSequences).not.toContain('\n')
            expect(completions[0].insertText).toMatchInlineSnapshot(`
                "printf(\\"%d\\", i);
                    } else if (i % 3 == 0) {
                        printf(\\"Multiple of 3: %d\\", i);
                    } else {
                        printf(\\"ODD %d\\", i);
                    }"
            `)
        })

        it('skips over empty lines', async () => {
            const { completions } = await complete(
                dedent`
                class Foo {
                    constructor() {
                        ${CURSOR_MARKER}
                    }
                }`,
                [
                    createCompletionResponse(dedent`
                    console.log('foo')

                            console.log('bar')

                            console.log('baz')`),
                ]
            )

            expect(completions[0].insertText).toMatchInlineSnapshot(`
              "console.log('foo')

                      console.log('bar')

                      console.log('baz')"
            `)
        })

        it('skips over else blocks', async () => {
            const { completions } = await complete(
                dedent`
                if (check) {
                    ${CURSOR_MARKER}
                }`,
                [
                    createCompletionResponse(dedent`
                    console.log('one')
                    } else {
                        console.log('two')
                    }`),
                ]
            )

            expect(completions[0].insertText).toMatchInlineSnapshot(`
              "console.log('one')
              } else {
                  console.log('two')"
            `)
        })

        it('includes closing parentheses in the completion', async () => {
            const { completions } = await complete(
                dedent`
                if (check) {
                    ${CURSOR_MARKER}
                `,
                [
                    createCompletionResponse(dedent`
                    console.log('one')
                    }`),
                ]
            )

            expect(completions[0].insertText).toMatchInlineSnapshot(`
              "console.log('one')
              }"
            `)
        })

        it('stops when the next non-empty line of the suffix matches', async () => {
            const { completions } = await complete(
                dedent`
                function myFunction() {
                    ${CURSOR_MARKER}
                    console.log('three')
                }
                `,
                [
                    createCompletionResponse(dedent`
                    console.log('one')
                        console.log('two')
                        console.log('three')
                        console.log('four')
                    }`),
                ]
            )

            expect(completions.length).toBe(0)
        })

        it('stops when the next non-empty line of the suffix matches exactly with one line completion', async () => {
            const { completions } = await complete(
                dedent`
                function myFunction() {
                    console.log('one')
                    ${CURSOR_MARKER}
                    console.log('three')
                }
                `,
                [
                    createCompletionResponse(dedent`
                    console.log('three')
                    }`),
                ]
            )

            expect(completions.length).toBe(0)
        })

        it('cuts off a matching line with the next line even if the completion is longer', async () => {
            const { completions } = await complete(
                dedent`
            function bubbleSort() {
                ${CURSOR_MARKER}
                do {
                    swapped = false;
                    for (let i = 0; i < array.length - 1; i++) {
                        if (array[i] > array[i + 1]) {
                            let temp = array[i];
                            array[i] = array[i + 1];
                            array[i + 1] = temp;
                            swapped = true;
                        }
                    }
                } while (swapped);
            }
            `,
                [
                    createCompletionResponse(dedent`
                    let swapped;
                    do {
                        swapped = false;
                        for (let i = 0; i < array.length - 1; i++) {
                            if (array[i] > array[i + 1]) {
                                let temp = array[i];
                                array[i] = array[i + 1];
                                array[i + 1] = temp;
                                swapped = true;
                            }
                        }
                    } while (swapped);
                `),
                ]
            )

            expect(completions[0].insertText).toBe('let swapped;')
        })

        describe('stops when the next non-empty line of the suffix matches partially', () => {
            it('simple example', async () => {
                const { completions } = await complete(
                    dedent`
                          path: $GITHUB_WORKSPACE/vscode/.vscod-etest/${CURSOR_MARKER}
                          key: {{ runner.os }}-pnpm-store-{{ hashFiles('**/pnpm-lock.yaml') }}`,
                    [
                        createCompletionResponse(dedent`
                                    pnpm-store
                                        key: {{ runner.os }}-pnpm-{{ steps.pnpm-cache.outputs.STORE_PATH }}
                                    }`),
                    ]
                )

                expect(completions[0].insertText).toBe('pnpm-store')
            })

            it('example with return', async () => {
                const { completions } = await complete(
                    dedent`
                          console.log('<< stop completion: ${CURSOR_MARKER}')
                          return []
                    `,
                    [
                        createCompletionResponse(dedent`
                                    lastChange was delete')
                                    return []
                        `),
                    ]
                )

                expect(completions[0].insertText).toBe("lastChange was delete')")
            })

            it('example with inline comment', async () => {
                const { completions } = await complete(
                    dedent`
                    // ${CURSOR_MARKER}
                    const currentFilePath = path.normalize(document.fileName)
                    `,
                    [
                        createCompletionResponse(dedent`
                            Get the file path
                            const filePath = normalize(document.fileName)
                        `),
                    ]
                )

                expect(completions[0].insertText).toBe('Get the file path')
            })
        })

        it('ranks results by number of lines', async () => {
            const { completions } = await complete(
                dedent`
                function test() {
                    ${CURSOR_MARKER}`,
                [
                    createCompletionResponse(dedent`
                    console.log('foo')
                        console.log('foo')
                    `),
                    createCompletionResponse(dedent`
                    console.log('foo')
                        console.log('foo')
                        console.log('foo')
                        console.log('foo')
                        console.log('foo')`),
                    createCompletionResponse(dedent`
                    console.log('foo')
                    `),
                ]
            )

            expect(completions[0].insertText).toMatchInlineSnapshot(`
              "console.log('foo')
                  console.log('foo')
                  console.log('foo')
                  console.log('foo')
                  console.log('foo')"
            `)
            expect(completions[1].insertText).toMatchInlineSnapshot(`
              "console.log('foo')
                  console.log('foo')"
            `)
            expect(completions[2].insertText).toBe("console.log('foo')")
        })

        it('dedupes duplicate results', async () => {
            const { completions } = await complete(
                dedent`
                function test() {
                    ${CURSOR_MARKER}`,
                [
                    createCompletionResponse('return true'),
                    createCompletionResponse('return true'),
                    createCompletionResponse('return true'),
                ]
            )

            expect(completions.length).toBe(1)
            expect(completions[0].insertText).toBe('return true')
        })

        it('handles tab/newline interop in completion truncation', async () => {
            const { completions } = await complete(
                dedent`
                class Foo {
                    constructor() {
                        ${CURSOR_MARKER}`,
                [
                    createCompletionResponse(
                        "console.log('foo')\n\t\tif (yes) {\n\t\t    sure()\n\t\t}\n\t}\n\n\tadd() {\n"
                    ),
                ]
            )

            expect(completions[0].insertText).toMatchInlineSnapshot(`
                "console.log('foo')
                \t\tif (yes) {
                \t\t    sure()
                \t\t}
                \t}"
            `)
        })

        it('does not include block end character if there is already content in the block', async () => {
            const { completions } = await complete(
                dedent`
                if (check) {
                    ${CURSOR_MARKER}
                    console.log('two')
                `,
                [
                    createCompletionResponse(dedent`
                    console.log('one')
                    }`),
                ]
            )

            expect(completions.length).toBe(0)
        })

        it('normalizes Cody responses starting with an empty line and following the exact same indentation as the start line', async () => {
            const { completions } = await complete(
                `function test() {
                    ${CURSOR_MARKER}`,
                [createCompletionResponse("\n    console.log('foo')")]
            )

            expect(completions[0].insertText).toBe("console.log('foo')")
        })
    })

    describe('completions cache', () => {
        it('synthesizes a completion from a prior request', async () => {
            await complete(`console.${CURSOR_MARKER}`, [createCompletionResponse("log('Hello, world!');")])

            const { completions } = await complete(`console.log(${CURSOR_MARKER}`, 'stall')

            expect(completions[0].insertText).toBe("'Hello, world!');")
        })
    })
})