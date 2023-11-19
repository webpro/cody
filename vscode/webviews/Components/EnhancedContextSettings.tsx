import * as React from 'react'

import { VSCodeButton, VSCodeCheckbox } from '@vscode/webview-ui-toolkit/react'
import classNames from 'classnames'

import { PopupFrame } from '../Popups/Popup'

import popupStyles from '../Popups/Popup.module.css'
import styles from './EnhancedContextSettings.module.css'

interface EnhancedContextSettingsProps {}

export type ContextProvider = EmbeddingsProvider | GraphProvider | SearchProvider

type EmbeddingsProvider = IndeterminateEmbeddingsProvider | LocalEmbeddingsProvider | RemoteEmbeddingsProvider

interface IndeterminateEmbeddingsProvider {
    kind: 'embeddings'
    type: 'indeterminate'
    state: 'indeterminate'
}

interface RemoteEmbeddingsProvider {
    kind: 'embeddings'
    type: 'remote'
    state: 'ready' | 'no-match'
    // The host name of the provider. This is displayed to the user *and*
    // used to construct a URL to the settings page.
    origin: string
    // The name of the repository in the remote provider. For example the
    // context group may be "~/projects/frobbler" but the remote name is
    // "host.example/universal/frobbler".
    remoteName: string
}

interface LocalEmbeddingsProvider {
    kind: 'embeddings'
    type: 'local'
    state: 'unconsented' | 'indexing' | 'ready'
}

interface SearchProvider {
    kind: 'search'
    state: 'indeterminate' | 'indexing' | 'ready'
}

interface GraphProvider {
    kind: 'graph'
    state: 'indeterminate' | 'indexing' | 'ready'
}

interface ContextGroup {
    name: string
    providers: ContextProvider[]
}

export interface EnhancedContextContextT {
    enabled: boolean
    groups: ContextGroup[]
}

export function defaultEnhancedContextContext(): EnhancedContextContextT {
    return {
        enabled: false,
        groups: [],
    }
}

export const EnhancedContextContext: React.Context<EnhancedContextContextT> = React.createContext(
    defaultEnhancedContextContext()
)

export const EnhancedContextEventHandlers: React.Context<EnhancedContextEventHandlersT> = React.createContext({
    onConsentToEmbeddings: (_): void => {},
    onEnabledChange: (_): void => {},
})

export interface EnhancedContextEventHandlersT {
    onConsentToEmbeddings: (provider: LocalEmbeddingsProvider) => void
    onEnabledChange: (enabled: boolean) => void
}

export function useEnhancedContextContext(): EnhancedContextContextT {
    return React.useContext(EnhancedContextContext)
}

export function useEnhancedContextEventHandlers(): EnhancedContextEventHandlersT {
    return React.useContext(EnhancedContextEventHandlers)
}

const ContextGroupComponent: React.FunctionComponent<{ group: ContextGroup }> = ({ group }): React.ReactNode => {
    return (
        <>
            <dt>
                <i className="codicon codicon-folder" /> {group.name}
            </dt>
            <dd>
                {group.providers.map(provider => (
                    <div key={provider.kind}>
                        <ContextProviderComponent provider={provider} />
                    </div>
                ))}
            </dd>
        </>
    )
}

function labelFor(kind: string): string {
    // All our context providers are single words; just convert them to title
    // case
    return kind[0].toUpperCase() + kind.slice(1)
}

const EmbeddingsConsentComponent: React.FunctionComponent<{ provider: LocalEmbeddingsProvider }> = ({
    provider,
}): React.ReactNode => {
    const events = useEnhancedContextEventHandlers()
    const onClick = (): void => {
        events.onConsentToEmbeddings(provider)
    }
    return (
        <>
            <p>
                The repository&apos;s contents will be uploaded to OpenAI&apos;s Embeddings API and then stored locally.
                To exclude files, set up a <a href="about:blank#TODO">Cody ignore file.</a>
            </p>
            <VSCodeButton onClick={onClick}>Enable Embeddings</VSCodeButton>
        </>
    )
}

function contextProviderState(provider: ContextProvider): React.ReactNode {
    switch (provider.state) {
        case 'indeterminate':
        case 'ready':
            if (provider.kind === 'embeddings' && provider.type === 'remote') {
                return <p>Inherited {provider.remoteName}</p>
            }
            return <></>
        case 'indexing':
            return <>&mdash; Indexing&hellip;</>
        case 'unconsented':
            return <EmbeddingsConsentComponent provider={provider} />
        case 'no-match':
            return (
                <p>
                    No repository matching {provider.remoteName} on <a href="about:blank#TODO">{provider.origin}</a>
                </p>
            )
        default:
            return ''
    }
}

const ContextProviderComponent: React.FunctionComponent<{ provider: ContextProvider }> = ({ provider }) => {
    let stateIcon
    switch (provider.state) {
        case 'indeterminate':
        case 'indexing':
            stateIcon = <i className="codicon codicon-loading codicon-modifier-spin" />
            break
        case 'unconsented':
            stateIcon = <i className="codicon codicon-circle-outline" />
            break
        case 'ready':
            stateIcon = <i className="codicon codicon-check" />
            break
        case 'no-match':
            stateIcon = <i className="codicon codicon-circle-slash" />
            break
        default:
            stateIcon = '?'
            break
    }
    return (
        <>
            {stateIcon} {labelFor(provider.kind)} {contextProviderState(provider)}
        </>
    )
}

export const EnhancedContextSettings: React.FunctionComponent<EnhancedContextSettingsProps> = (): React.ReactNode => {
    const events = useEnhancedContextEventHandlers()
    const context = useEnhancedContextContext()
    // TODO: Don't default to true here; open by default for rapid development.
    const [isOpen, setOpen] = React.useState(true)
    const enabledChanged = (): void => {
        events.onEnabledChange(!context.enabled)
    }
    return (
        <div className={classNames(popupStyles.popupHost)}>
            <PopupFrame
                isOpen={isOpen}
                onDismiss={() => setOpen(!isOpen)}
                classNames={[popupStyles.popupTrail, styles.enhancedContextSettingsPopup]}
            >
                <div>
                    {
                        // TODO: Two problems with the VScode checkbox:
                        // - It's hard to see on this background in many themes.
                        // - The checkbox and label are one component, so
                        //   aligning the following content with the label is
                        //   tedious.
                    }
                    <VSCodeCheckbox onChange={enabledChanged} checked={context.enabled}>
                        {' '}
                        <h1>Enhanced Context ✨</h1>
                    </VSCodeCheckbox>
                    <p>
                        Automatically include additional context about your code.{' '}
                        <a href="about:blank#TODO">Learn more</a>
                    </p>
                    <dl>
                        {context.groups.map(group => (
                            <ContextGroupComponent key={group.name} group={group} />
                        ))}
                    </dl>
                </div>
            </PopupFrame>
            <VSCodeButton
                className={classNames(popupStyles.popupHost)}
                appearance="icon"
                type="button"
                onClick={() => setOpen(!isOpen)}
                title="Configure Enhanced Context"
            >
                <i className="codicon codicon-settings" />
            </VSCodeButton>
        </div>
    )
}
