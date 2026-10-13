# Copal as a GitHub App (one-click install)

The Action (`actions/program`) runs Copal inside the customer's CI. The GitHub App is the one-click alternative: install it on an organization and every pull request is checked, with no workflow file. It runs `packages/git-app` (`server.ts`) as a hosted service.

## Register the app (owner, once)

1. Deploy `packages/git-app` (the repository's `Dockerfile` / `render.yaml`) and note its URL.
2. In `manifest.json`, replace `YOUR-COPAL-SERVER` with that URL.
3. Go to **GitHub → Settings → Developer settings → GitHub Apps → New GitHub App**, or post the manifest with the [manifest flow](https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest).
4. Store the app's ID, private key and webhook secret as the server's `GITHUB_APP_ID`, `GITHUB_PRIVATE_KEY` and `GITHUB_WEBHOOK_SECRET`.
5. Put the install link (`https://github.com/apps/copal/installations/new`) on the pricing and start pages.

## Privacy choice for customers

- **GitHub App:** fastest start; the hosted server reads the diff of each pull request.
- **Action:** code never leaves the customer's CI. Recommended for regulated teams.
