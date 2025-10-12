# Forgejo Domestic Blog Deployment Design

## Goal

Add a second deployment path for this Hugo blog that is driven by Forgejo Actions and serves `https://blog.tamochi.cn/` from a Docker host using an `nginx` static-site container, while keeping the existing `main -> GitHub -> Cloudflare Pages -> blog.chius.cc` path unchanged.

## Current State

- The repository has no existing Forgejo workflow files.
- `hugo.toml` sets `baseURL = "https://blog.chius.cc/"` and that value must stay in source control for the GitHub and Cloudflare Pages deployment.
- The repo already ignores `public/`, so CI can build static output without polluting git status.
- The site uses the `PaperMod` theme via git submodule, so CI must initialize submodules before building.

## Constraints

- Do not change the tracked `baseURL` in `main` to the domestic domain.
- Prefer Forgejo Actions variables over secrets whenever the value is not sensitive.
- Use `docker compose` on the Docker server.
- Keep the deployment path simple to operate and easy to roll back.

## Recommended Architecture

### Build Path

1. A push to `main` triggers `.forgejo/workflows/integrate.yml`.
2. The workflow checks out the repository and initializes submodules.
3. The workflow installs a pinned Hugo Extended release that is new enough for the current `PaperMod` theme.
4. Hugo builds the site with a runtime override: `--baseURL https://blog.tamochi.cn/`.
5. The workflow validates that `public/index.html` exists.
6. The workflow targets an existing Forgejo runner label such as `ubuntu` and expects the Forgejo runner to expose a usable Docker daemon into the job container.
7. A Docker image is built from `nginx`, copying the generated `public/` directory into the container.
8. The image is tagged as both `latest` and `sha-<short-commit>` and pushed to the Forgejo Container Registry.

### Deploy Path

1. `integrate.yml` calls `.forgejo/workflows/deploy.yml` as a reusable workflow after the image push succeeds.
2. `deploy.yml` connects to the Docker server over SSH.
3. The workflow uploads `deploy/compose.yaml` and a generated `.env` file into the remote deployment directory.
4. The server runs `docker compose pull` and `docker compose up -d` to update the blog container.
5. The workflow waits for the container health check to report `healthy` and fails otherwise.
6. Caddy on the VPS reverse proxies `blog.tamochi.cn` to the Docker server's published port.

## File Layout

- Add `.forgejo/workflows/integrate.yml` for build and registry push.
- Add `.forgejo/workflows/deploy.yml` as a reusable deployment workflow.
- Add `Dockerfile` to package the generated site into `nginx`.
- Add `deploy/nginx/default.conf` for the container's `nginx` config.
- Add `deploy/compose.yaml` as the remote compose file.
- Add `deploy/.env.example` to document the expected runtime variables.

## Configuration Model

### Forgejo Variables

Use repository or owner variables for non-sensitive values:

- `BLOG_DOMAIN`
- `HUGO_VERSION`
- `REGISTRY_HOST`
- `DEPLOY_HOST`
- `DEPLOY_PORT`
- `DEPLOY_USER`
- `DEPLOY_HOST_KEY`
- `DEPLOY_PATH`
- `CONTAINER_NAME`
- `SERVICE_PORT`

### Forgejo Secrets

Only keep truly sensitive data in secrets:

- `SSH_PRIVATE_KEY`

`DEPLOY_HOST_KEY` should be stored as a variable in full `known_hosts` format so the deployment does not trust a freshly scanned host key during the same run.

The Docker server should be manually logged into the Forgejo registry once so the remote host does not need a registry password secret in CI.

The Forgejo runner that executes `integrate.yml` must be configured to share Docker access with the job container, for example via `container.docker_host: automount` when this is an internally trusted runner.

## Rollback Strategy

Each deployment uses the immutable `sha-<short-commit>` tag instead of `latest`.

Rollback procedure:

1. SSH into the Docker server.
2. Edit `${DEPLOY_PATH}/.env` and replace `IMAGE_REF` with a previous `sha-*` tag.
3. Run `docker compose --env-file .env -f compose.yaml pull`.
4. Run `docker compose --env-file .env -f compose.yaml up -d`.

This keeps rollback operationally simple and avoids rebuilding old content.

## Failure Handling

- If Hugo build fails, no image is produced and deployment does not run.
- If image push fails, deployment does not run.
- If deployment fails after the image is pushed, the previous running container remains available until `docker compose up -d` replaces it.
- If the updated container never reaches `healthy`, the workflow fails and the operator can roll back to the previous immutable tag.
- CI concurrency should prevent overlapping deployments to the same branch.

## Verification

Local and CI verification should cover:

- `hugo --baseURL https://blog.tamochi.cn/ --destination public`
- `test -f public/index.html`
- `docker build` using the generated `public/`
- image health check startup in a local container
- `docker compose config` for the deployment template when Docker is available

## Scope Boundaries

This work adds the Forgejo build and deployment path plus the container packaging needed for it.

This work does not configure the VPS Caddy reverse proxy itself, change DNS records, or remove the GitHub and Cloudflare Pages deployment.
