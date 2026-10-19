# @client-compose/protocol

TypeScript wire types for the [Client Compose](https://github.com/client-compose/client-compose)
protocol: server-composed screens made of client-owned islands.

Tier: **core** · Protocol: **v0**

```sh
npm install @client-compose/protocol
```

Exports `ScreenRequest`, `ScreenResponse`, `IslandEntry`, `IslandError`, `IslandDescriptor`,
`IslandManifest`, `Capabilities`, `ClientContext` and `PROTOCOL_VERSION`.

You usually don't need this directly: [`@client-compose/client`](https://www.npmjs.com/package/@client-compose/client),
[`@client-compose/react`](https://www.npmjs.com/package/@client-compose/react) and
[`@client-compose/composer`](https://www.npmjs.com/package/@client-compose/composer) depend on it.

The normative definition is the [protocol spec](https://github.com/client-compose/client-compose/blob/main/spec/PROTOCOL.md).
