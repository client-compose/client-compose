// Use the Client Compose packages straight from this repo. In your own app, install them from npm
// and use the default Expo Metro config instead.
const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const repo = path.resolve(__dirname, "../../..");
const config = getDefaultConfig(__dirname);

const aliases = {
  "@client-compose/react": path.join(repo, "clients/typescript/react/src/index.ts"),
  "@client-compose/client": path.join(repo, "clients/typescript/core/src/index.ts"),
  "@client-compose/client/proxy": path.join(repo, "clients/typescript/core/src/proxy.ts"),
  "@client-compose/protocol": path.join(repo, "shared/typescript/protocol/src/index.ts"),
};

config.watchFolders = [path.join(repo, "clients/typescript"), path.join(repo, "shared/typescript")];
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (aliases[moduleName]) {
    return { type: "sourceFile", filePath: aliases[moduleName] };
  }
  // The repo sources import siblings as "./file.ts" (the published packages use ".js"); Metro wants
  // them without the extension.
  if (moduleName.startsWith(".") && moduleName.endsWith(".ts")) {
    return context.resolveRequest(context, moduleName.slice(0, -3), platform);
  }
  // Bare imports from the repo sources (e.g. `react`) resolve from this app, so there's one copy of React.
  const fromOutside = !context.originModulePath.startsWith(__dirname + path.sep);
  const origin = fromOutside
    ? { ...context, originModulePath: path.join(__dirname, "index.ts") }
    : context;
  return context.resolveRequest(origin, moduleName, platform);
};

module.exports = config;
