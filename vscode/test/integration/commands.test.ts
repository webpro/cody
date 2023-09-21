import * as assert from 'assert'

import * as vscode from 'vscode'

import { afterIntegrationTest, beforeIntegrationTest, getTranscript, waitUntil } from './helpers'

suite('Commands', function () {
    this.beforeEach(() => beforeIntegrationTest())
    this.afterEach(() => afterIntegrationTest())

    test('Explain Code', async () => {
        // Open Main.java
        assert.ok(vscode.workspace.workspaceFolders)
        const mainJavaUri = vscode.Uri.parse(`${vscode.workspace.workspaceFolders[0].uri.toString()}/Main.java`)
        const textEditor = await vscode.window.showTextDocument(mainJavaUri)

        // Select the "main" method
        textEditor.selection = new vscode.Selection(5, 0, 7, 0)

        // Run the "explain" command
        await vscode.commands.executeCommand('cody.command.explain-code')

        // Check the chat transcript contains markdown
        const humanMessage = await getTranscript(0)
        assert.match(humanMessage.text || '', /Explain what the selected code does/)

        await waitUntil(async () => /^hello from the assistant$/.test((await getTranscript(1)).displayText || ''))
    })

    test('Code Smell', async () => {
        // Open Main.java
        assert.ok(vscode.workspace.workspaceFolders)
        const mainJavaUri = vscode.Uri.parse(`${vscode.workspace.workspaceFolders[0].uri.toString()}/Main.java`)
        const textEditor = await vscode.window.showTextDocument(mainJavaUri)

        // Select the "main" method
        textEditor.selection = new vscode.Selection(5, 0, 7, 0)

        // Run the "explain" command
        await vscode.commands.executeCommand('cody.command.smell-code')

        // Check the chat transcript contains markdown
        const humanMessage = await getTranscript(0)
        assert.match(humanMessage.text || '', /If no issues found/)
    })

    test('Document Code', async () => {
        // Open Main.java
        assert.ok(vscode.workspace.workspaceFolders)
        const uri = vscode.Uri.parse(`${vscode.workspace.workspaceFolders[0].uri.toString()}/template.py`)
        const textEditor = await vscode.window.showTextDocument(uri)

        // Select the "main" method
        textEditor.selection = new vscode.Selection(24, 10, 24, 10)

        // Run the "doc" command
        await vscode.commands.executeCommand('cody.command.document-code')

        // Check the chat transcript contains markdown
        const humanMessage = await getTranscript(0)
        assert.match(humanMessage.text || '', /Generate a comment documenting/)

        await waitUntil(async () => /^Generate a comment documenting$/.test((await getTranscript(1)).text || ''))
    })
})
