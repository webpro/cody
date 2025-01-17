export const LOCAL_APP_LOCATIONS: LocalAppPaths = {
    darwin: [
        {
            dir: '/Applications/',
            file: 'Cody.app',
        },
        {
            dir: '~/Library/Application Support/com.sourcegraph.cody/',
            file: 'site.config.json',
        },
        {
            dir: '~/Library/Application Support/com.sourcegraph.cody/',
            file: 'app.json',
        },
    ],
    linux: [
        {
            dir: '~/.local/share/com.sourcegraph.cody/',
            file: 'app.json',
        },
    ],
}

interface LocalAppPaths {
    [os: string]: {
        dir: string
        file: string
    }[]
}
