# Hugo Container Deployment Design

## Goal

Replace the current Jenkins workflow that builds Hugo static files and rsyncs them to a Caddy server. The new workflow builds a container image, pushes it to Harbor, and deploys it on the Docker host.

## Current State

- Source repository: `ssh://git@10.0.0.131:2222/chius/hugo.git`
- Jenkins currently checks out `main`, initializes Hugo theme submodules, downloads Hugo `0.157.0`, runs `hugo --minify --gc --cleanDestinationDir`, and rsyncs `public/` to a Caddy web root.
- No existing Dockerfile or Compose file is present in the repository.

## Target Architecture

Jenkins remains the build and deployment coordinator. It checks out the Hugo repository, builds a Docker image, pushes the image to Harbor, uploads a Compose file to the Docker host, and starts the service there.

The runtime image is based on nginx. Hugo-generated static files are copied into nginx's document root, so the final container only serves static assets and does not need Hugo installed.

## Image Build

Use a multi-stage Docker build:

- Builder stage: use Hugo extended `0.157.0` to build the site from the repository and submodules.
- Runtime stage: use `nginx:alpine` and copy the generated `public/` files to `/usr/share/nginx/html`.

The image repository is:

```text
10.0.0.134/main/hugo
```

Jenkins should push an immutable tag derived from the build, such as the Git commit short SHA or Jenkins build number. It may also update `latest` for convenience.

## Jenkins Credentials

The following existing Jenkins credentials are relevant:

- `gitea-ssh-key`: checkout from Gitea.
- `harbor-robot-creds`: login and push to Harbor project `main`.
- `homelab-root`: SSH deployment to `10.0.0.135`.

Credential secret values are not required in the repository and must stay in Jenkins.

The Jenkinsfile should follow the existing credential style used by other pipelines:

- Wrap Harbor login and push in `withCredentials([usernamePassword(credentialsId: 'harbor-robot-creds', passwordVariable: 'HARBOR_PWD', usernameVariable: 'HARBOR_USER')])`.
- Wrap remote deployment in `withCredentials([sshUserPrivateKey(credentialsId: 'homelab-root', keyFileVariable: 'SSH_KEY', usernameVariable: 'SSH_USER')])`.
- Pipe `HARBOR_PWD` to `docker login --password-stdin` instead of interpolating secrets into command arguments.

## Deployment Host

Deployment target:

```text
10.0.0.135
```

The deployment host must not clone the full Hugo repository. Jenkins will create or update `/opt/hugo`, upload only the Compose file needed to run the service, then execute Docker Compose commands over SSH.

The container exposes nginx port `80` as host port `3000`:

```text
3000:80
```

## Compose Flow

The repository will contain `docker-compose.yml` for versioned deployment configuration. During deployment, Jenkins uploads this file to:

```text
/opt/hugo/docker-compose.yml
```

Then Jenkins runs:

```bash
docker compose pull
docker compose up -d
docker compose ps
```

The Compose file references `${IMAGE_TAG}`. Jenkins writes `/opt/hugo/.env` with `IMAGE_TAG=<selected tag>` before running Compose, so the same Compose file can deploy each new image without being rewritten.

## Required Repository Changes

- Add `Dockerfile` for the Hugo-to-nginx multi-stage image.
- Add `.dockerignore` to keep local build artifacts and Git metadata out of Docker context.
- Add `docker-compose.yml` for the runtime service.
- Update `Jenkinsfile` to build and push the image, upload Compose to `10.0.0.135`, and run `docker compose` remotely.

## Verification

Jenkins should fail fast if any of these steps fail:

- Gitea checkout and submodule initialization.
- Docker image build.
- Harbor login and push.
- SSH upload to `10.0.0.135`.
- Remote `docker compose pull` and `docker compose up -d`.

After deployment, Jenkins should verify the service with:

```bash
docker compose ps
curl -fsS http://127.0.0.1:3000/
```

## Out Of Scope

- Changing the public DNS or external reverse proxy routing.
- Moving Harbor, Jenkins, Gitea, or the Docker host.
- Storing any secrets in the repository.
