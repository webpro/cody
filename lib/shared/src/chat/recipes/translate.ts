import { MAX_RECIPE_INPUT_TOKENS } from '../../prompt/constants'
import { truncateText } from '../../prompt/truncation'
import { type Interaction } from '../transcript/interaction'

import { newInteraction } from './helpers'
import { languageMarkdownID, languageNames } from './langs'
import { type Recipe, type RecipeContext, type RecipeID } from './recipe'

export class TranslateToLanguage implements Recipe {
    public id: RecipeID = 'translate-to-language'
    public title = 'Translate Code to Language'

    public static options = languageNames

    public async getInteraction(_humanChatInput: string, context: RecipeContext): Promise<Interaction | null> {
        const source = this.id
        const selection = context.editor.getActiveTextEditorSelectionOrEntireFile()
        if (!selection) {
            await context.editor.showWarningMessage('No code selected. Please select some code and try again.')
            return null
        }

        const toLanguage = await context.editor.showQuickPick(languageNames)
        if (!toLanguage) {
            // TODO: Show the warning within the Chat UI.
            // editor.showWarningMessage('Must pick a language to translate to.')
            return null
        }

        const truncatedSelectedText = truncateText(selection.selectedText, MAX_RECIPE_INPUT_TOKENS)

        const promptMessage = `Translate the following code into ${toLanguage}\n\`\`\`\n${truncatedSelectedText}\n\`\`\``
        const displayText = `Translate the following code into ${toLanguage}\n\`\`\`\n${selection.selectedText}\n\`\`\``

        const markdownID = languageMarkdownID[toLanguage] || ''
        const assistantResponsePrefix = `Here is the code translated to ${toLanguage}:\n\`\`\`${markdownID}\n`

        return newInteraction({
            text: promptMessage,
            displayText,
            source,
            assistantPrefix: assistantResponsePrefix,
            assistantText: assistantResponsePrefix,
        })
    }
}
