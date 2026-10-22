# @client-compose/express

Express adapter for the [Client Compose](https://github.com/client-compose/client-compose)
composer. Serves `POST …/screens/{screen}` and `POST …/actions/{action}` wherever you mount it.

Tier: **core** · Protocol: **v0** · Express 5 · Node 20+

```sh
npm install @client-compose/composer @client-compose/express
```

```ts
import express from "express";
import { createComposer } from "@client-compose/composer";
import { composerHandler } from "@client-compose/express";

const composer = createComposer<Ctx, express.Request>({
  screens,
  actions,
  context: (req) => ({ viewer: req.user }), // whatever your middleware put on the request
});

const app = express();
app.use(passport.session());
app.use("/compose", composerHandler(composer));
```

- `context` receives the Express request, so sessions, `req.user` and anything else your middleware
  sets reach every island and action.
- It works with or without `express.json()` in front of it. If that parser rejects a composer
  request's body, the app still gets the protocol's 400 `bad_request`, not Express's error page.
- Other paths under the mount go to the next handler; other methods get 405.
