# Forgejo Domestic Blog Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Forgejo-driven domestic deployment path that builds the Hugo site for `blog.tamochi.cn`, packages it in `nginx`, pushes it to Forgejo Container Registry, and deploys it to a Docker host with `docker compose`.

**Architecture:** `integrate.yml` builds the Hugo output with a runtime `baseURL` override and pushes a static `nginx` image to Forgejo Container Registry. It then calls `deploy.yml`, which uploads the compose assets to the Docker host and rolls the service forward using an immutable image tag.

**Tech Stack:** Hugo, Forgejo Actions, Docker, Docker Compose, nginx, SSH

---

### Task 1: Add container packaging files

**Files:**
- Create: `Dockerfile`
- Create: `deploy/nginx/default.conf`
- Create: `deploy/compose.yaml`
- Create: `deploy/.env.example`

- [ ] **Step 1: Write the container packaging files**

```dockerfile
FROM nginx:1.27-alpine
COPY deploy/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY public/ /usr/share/nginx/html/
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD wget -qO- http://127.0.0.1/index.html >/dev/null || exit 1
```

```nginx
server {
    listen 80;
    server_name _;
    root /usr/share/nginx/html;
    index index.html;

    location / {
        try_files $uri $uri/ =404;
    }

    location ~* \.(?:css|js|mjs|png|jpg|jpeg|gif|svg|ico|webp|woff2?)$ {
        expires 30d;
        access_log off;
    }
}
```

```yaml
services:
  blog:
    image: ${IMAGE_REF}
    container_name: ${CONTAINER_NAME}
    restart: unless-stopped
    ports:
      - "${SERVICE_PORT}:80"
```

```dotenv
IMAGE_REF=registry.example.com/owner/hugo:sha-0123456789ab
CONTAINER_NAME=blog-tamochi
SERVICE_PORT=8080
```

- [ ] **Step 2: Verify the compose template is valid**

Run: `docker compose -f deploy/compose.yaml --env-file deploy/.env.example config`
Expected: compose file renders without syntax errors

### Task 2: Add Forgejo integration workflow

**Files:**
- Create: `.forgejo/workflows/integrate.yml`

- [ ] **Step 1: Write the workflow to build and push the image**

```yaml
name: Integrate Domestic Blog

on:
  push:
    branches:
      - main

concurrency:
  group: integrate-${{ forgejo.ref }}
  cancel-in-progress: true

jobs:
  build-and-push:
    runs-on: ubuntu
    outputs:
      image_ref: ${{ steps.image.outputs.image_ref }}
    steps:
      - uses: actions/checkout@v4
      - run: git submodule update --init --recursive
      - run: apt-get update && apt-get install -y --no-install-recommends curl docker.io ca-certificates
      - run: curl -fsSL -o /tmp/hugo.tar.gz "https://github.com/gohugoio/hugo/releases/download/v${{ vars.HUGO_VERSION }}/hugo_extended_${{ vars.HUGO_VERSION }}_linux-amd64.tar.gz" && tar -xzf /tmp/hugo.tar.gz -C /tmp && install -m 0755 /tmp/hugo /usr/local/bin/hugo && hugo version
      - run: docker info >/dev/null && docker version
      - run: hugo --minify --baseURL "https://${{ vars.BLOG_DOMAIN }}/" --destination public
      - run: test -f public/index.html
      - id: image
        run: |
          short_sha="$(printf '%s' '${{ forgejo.sha }}' | cut -c1-12)"
          repo_path="$(printf '%s' '${{ forgejo.repository }}' | tr '[:upper:]' '[:lower:]')"
          image_base="${{ vars.REGISTRY_HOST }}/$repo_path"
          echo "image_ref=$image_base:sha-$short_sha" >> "$FORGEJO_OUTPUT"
      - run: printf '%s' "$FORGEJO_TOKEN" | docker login "${{ vars.REGISTRY_HOST }}" -u "${{ forgejo.actor }}" --password-stdin
      - run: docker build -t "${{ steps.image.outputs.image_ref }}" -t "${{ vars.REGISTRY_HOST }}/$(printf '%s' '${{ forgejo.repository }}' | tr '[:upper:]' '[:lower:]'):latest" .
      - run: docker push "${{ steps.image.outputs.image_ref }}"
      - run: docker push "${{ vars.REGISTRY_HOST }}/$(printf '%s' '${{ forgejo.repository }}' | tr '[:upper:]' '[:lower:]'):latest"

  deploy:
    needs:
      - build-and-push
    uses: ./.forgejo/workflows/deploy.yml
    with:
      image_ref: ${{ needs.build-and-push.outputs.image_ref }}
      deploy_host: ${{ vars.DEPLOY_HOST }}
      deploy_port: ${{ vars.DEPLOY_PORT }}
      deploy_user: ${{ vars.DEPLOY_USER }}
      deploy_host_key: ${{ vars.DEPLOY_HOST_KEY }}
      deploy_path: ${{ vars.DEPLOY_PATH }}
      container_name: ${{ vars.CONTAINER_NAME }}
      service_port: ${{ vars.SERVICE_PORT }}
    secrets:
      ssh_private_key: ${{ secrets.SSH_PRIVATE_KEY }}
```

- [ ] **Step 2: Verify the YAML structure manually and with repository reads**

Run: `grep -n "workflow_call\|uses:\|FORGEJO_OUTPUT\|docker login" .forgejo/workflows/integrate.yml`
Expected: expected workflow sections and outputs are present

### Task 3: Add Forgejo deploy workflow

**Files:**
- Create: `.forgejo/workflows/deploy.yml`

- [ ] **Step 1: Write the reusable deployment workflow**

```yaml
name: Deploy Domestic Blog

on:
  workflow_call:
    inputs:
      image_ref:
        required: true
        type: string
      deploy_host:
        required: true
        type: string
      deploy_port:
        required: true
        type: string
      deploy_user:
        required: true
        type: string
      deploy_host_key:
        required: true
        type: string
      deploy_path:
        required: true
        type: string
      container_name:
        required: true
        type: string
      service_port:
        required: true
        type: string
    secrets:
      ssh_private_key:
        required: true

concurrency:
  group: deploy-${{ inputs.deploy_path }}
  cancel-in-progress: false

jobs:
  deploy:
    runs-on: ubuntu
    steps:
      - uses: actions/checkout@v4
      - run: apt-get update && apt-get install -y --no-install-recommends openssh-client
      - run: |
          install -d -m 700 ~/.ssh
          printf '%s\n' "${{ secrets.ssh_private_key }}" > ~/.ssh/id_ed25519
          chmod 600 ~/.ssh/id_ed25519
          printf '%s\n' "${{ inputs.deploy_host_key }}" >> ~/.ssh/known_hosts
      - run: |
          cat > deploy/runtime.env <<EOF
          IMAGE_REF=${{ inputs.image_ref }}
          CONTAINER_NAME=${{ inputs.container_name }}
          SERVICE_PORT=${{ inputs.service_port }}
          EOF
      - run: ssh -p "${{ inputs.deploy_port }}" "${{ inputs.deploy_user }}@${{ inputs.deploy_host }}" "mkdir -p '${{ inputs.deploy_path }}'"
      - run: scp -P "${{ inputs.deploy_port }}" deploy/compose.yaml deploy/runtime.env "${{ inputs.deploy_user }}@${{ inputs.deploy_host }}:${{ inputs.deploy_path }}/"
      - run: |
          ssh -p "${{ inputs.deploy_port }}" "${{ inputs.deploy_user }}@${{ inputs.deploy_host }}" \
            "mv '${{ inputs.deploy_path }}/runtime.env' '${{ inputs.deploy_path }}/.env' && \
             docker compose --env-file '${{ inputs.deploy_path }}/.env' -f '${{ inputs.deploy_path }}/compose.yaml' pull && \
             docker compose --env-file '${{ inputs.deploy_path }}/.env' -f '${{ inputs.deploy_path }}/compose.yaml' up -d"
      - run: |
          ssh -p "${{ inputs.deploy_port }}" "${{ inputs.deploy_user }}@${{ inputs.deploy_host }}" '
            set -eu
            for attempt in $(seq 1 30); do
              health_state=$(docker inspect -f "{{if .State.Health}}{{.State.Health.Status}}{{else}}no-healthcheck{{end}}" "${{ inputs.container_name }}")
              if [ "$health_state" = healthy ]; then
                exit 0
              fi
              if [ "$health_state" = unhealthy ]; then
                docker logs "${{ inputs.container_name }}"
                exit 1
              fi
              sleep 2
            done
            docker logs "${{ inputs.container_name }}"
            exit 1
          '
```

- [ ] **Step 2: Verify the deployment workflow references only one secret**

Run: `grep -n "secret\|ssh_private_key\|inputs\." .forgejo/workflows/deploy.yml`
Expected: only the SSH key is declared as a secret and other settings flow through inputs

### Task 4: Verify the whole flow locally where possible

**Files:**
- Modify: generated local build output only

- [ ] **Step 1: Build the site for the domestic domain**

Run: `hugo --minify --baseURL https://blog.tamochi.cn/ --destination public`
Expected: build succeeds and writes `public/index.html`

- [ ] **Step 2: Validate the container image build**

Run: `docker build -t local/hugo-domestic:test .`
Expected: image builds successfully with the generated static files

- [ ] **Step 3: Verify the image health check works**

Run: `docker run -d --rm --name local-hugo-domestic -p 18080:80 local/hugo-domestic:test && docker inspect -f '{{.State.Health.Status}}' local-hugo-domestic`
Expected: container reports `starting` or `healthy`, and becomes `healthy` shortly after startup

- [ ] **Step 4: Validate compose rendering**

Run: `docker compose -f deploy/compose.yaml --env-file deploy/.env.example config`
Expected: compose renders successfully
