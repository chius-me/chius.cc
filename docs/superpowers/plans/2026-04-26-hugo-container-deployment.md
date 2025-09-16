# Hugo Container Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Hugo blog into an nginx container image, push it to Harbor, and deploy it to `10.0.0.135` with Docker Compose on host port `3000`.

**Architecture:** Jenkins remains the coordinator. The repository gains a multi-stage `Dockerfile`, a runtime `docker-compose.yml`, and a deployment-focused `Jenkinsfile`; Jenkins builds and pushes `10.0.0.134/main/hugo`, uploads only Compose metadata to `/opt/hugo`, then runs `docker compose` remotely over SSH.

**Tech Stack:** Hugo extended `0.157.0`, nginx Alpine, Docker, Docker Compose, Jenkins Pipeline, Harbor, SSH.

---

## File Structure

- Create: `Dockerfile` - multi-stage image build from Hugo source to nginx static runtime.
- Create: `.dockerignore` - keep generated output, local logs, Git metadata, and docs-only planning artifacts out of Docker context.
- Create: `docker-compose.yml` - runtime service definition for the blog container on `3000:80`, using `${IMAGE_TAG}`.
- Modify: `Jenkinsfile` - replace Hugo download plus rsync deployment with Docker build, Harbor push, Compose upload, and remote deployment.

## Implementation Tasks

### Task 1: Add Docker Build Definition

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`

- [ ] **Step 1: Create the multi-stage Dockerfile**

Create `Dockerfile` with this exact content:

```dockerfile
ARG HUGO_VERSION=0.157.0

FROM floryn90/hugo:${HUGO_VERSION}-ext AS builder

WORKDIR /src

COPY . .

RUN hugo --minify --gc --cleanDestinationDir

FROM nginx:1.27-alpine

COPY --from=builder /src/public/ /usr/share/nginx/html/
```

- [ ] **Step 2: Create Docker ignore rules**

Create `.dockerignore` with this exact content:

```gitignore
.git
.gitignore
.env
.env.*
*.key
*.pem
credentials*
docs/superpowers
public
resources
hugo.log
.hugo_build.lock
```

- [ ] **Step 3: Verify Dockerfile can parse**

Run:

```bash
docker build --pull=false -t hugo-blog-plan-check:local .
```

Expected: Docker completes all stages and creates `hugo-blog-plan-check:local`. If the base image is missing locally and the network cannot reach Docker Hub, the command may fail while pulling `floryn90/hugo:0.157.0-ext` or `nginx:1.27-alpine`; report that exact pull failure instead of changing the Dockerfile.

- [ ] **Step 4: Remove the local test image**

Run:

```bash
docker rmi hugo-blog-plan-check:local || true
```

Expected: image is removed, or Docker reports it did not exist.

- [ ] **Step 5: Commit this task if commits are approved**

Run only if the user explicitly approved commits:

```bash
git add Dockerfile .dockerignore
git commit -m "添加 Hugo 博客容器构建配置"
```

### Task 2: Add Compose Runtime Definition

**Files:**
- Create: `docker-compose.yml`

- [ ] **Step 1: Create Compose file**

Create `docker-compose.yml` with this exact content:

```yaml
services:
  hugo-blog:
    image: 10.0.0.134/main/hugo:${IMAGE_TAG:-latest}
    container_name: hugo-blog
    restart: unless-stopped
    ports:
      - "3000:80"
```

- [ ] **Step 2: Validate Compose config locally**

Run:

```bash
IMAGE_TAG=plan-check docker compose config
```

Expected: command prints normalized Compose config with image `10.0.0.134/main/hugo:plan-check` and port mapping `3000:80`.

- [ ] **Step 3: Commit this task if commits are approved**

Run only if the user explicitly approved commits:

```bash
git add docker-compose.yml
git commit -m "添加博客容器 Compose 部署配置"
```

### Task 3: Replace Jenkins Static Deploy With Image Deploy

**Files:**
- Modify: `Jenkinsfile`

- [ ] **Step 1: Replace Jenkinsfile content**

Replace `Jenkinsfile` with this exact content:

```groovy
pipeline {
    agent any

    environment {
        HARBOR_REGISTRY = '10.0.0.134'
        HARBOR_PROJECT = 'main'
        IMAGE_NAME = 'hugo'
        FULL_IMAGE_NAME = "${HARBOR_REGISTRY}/${HARBOR_PROJECT}/${IMAGE_NAME}"

        DEPLOY_HOST = '10.0.0.135'
        DEPLOY_DIR = '/opt/hugo'
        HUGO_VERSION = '0.157.0'
    }

    stages {
        stage('克隆代码 (Checkout)') {
            steps {
                git branch: 'main',
                    credentialsId: 'gitea-ssh-key',
                    url: 'ssh://git@10.0.0.131:2222/chius/hugo.git'
                sh 'git submodule update --init --recursive'
                script {
                    env.IMAGE_TAG = sh(script: 'git rev-parse --short=12 HEAD', returnStdout: true).trim()
                }
            }
        }

        stage('构建 Docker 镜像 (Build Image)') {
            steps {
                echo "开始构建 Docker 镜像 ${FULL_IMAGE_NAME}:${IMAGE_TAG}..."
                sh 'docker build --build-arg HUGO_VERSION=${HUGO_VERSION} -t ${FULL_IMAGE_NAME}:${IMAGE_TAG} -t ${FULL_IMAGE_NAME}:latest .'
            }
        }

        stage('推送到 Harbor (Push Image)') {
            steps {
                echo '开始推送镜像到 Harbor...'
                withCredentials([usernamePassword(credentialsId: 'harbor-robot-creds', passwordVariable: 'HARBOR_PWD', usernameVariable: 'HARBOR_USER')]) {
                    sh 'echo "$HARBOR_PWD" | docker login ${HARBOR_REGISTRY} -u "$HARBOR_USER" --password-stdin'
                    sh 'docker push ${FULL_IMAGE_NAME}:${IMAGE_TAG}'
                    sh 'docker push ${FULL_IMAGE_NAME}:latest'
                }
            }
        }

        stage('部署到 Docker 主机 (Deploy)') {
            steps {
                echo "通过 SSH 部署到 ${DEPLOY_HOST}:${DEPLOY_DIR}..."
                withCredentials([
                    sshUserPrivateKey(credentialsId: 'homelab-root', keyFileVariable: 'SSH_KEY', usernameVariable: 'SSH_USER'),
                    usernamePassword(credentialsId: 'harbor-robot-creds', passwordVariable: 'HARBOR_PWD', usernameVariable: 'HARBOR_USER')
                ]) {
                    sh '''
                        set -eu

                        ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "$SSH_USER@$DEPLOY_HOST" "mkdir -p '$DEPLOY_DIR'"
                        scp -i "$SSH_KEY" -o StrictHostKeyChecking=no docker-compose.yml "$SSH_USER@$DEPLOY_HOST:$DEPLOY_DIR/docker-compose.yml"
                        printf '%s\n' "$HARBOR_PWD" | ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "$SSH_USER@$DEPLOY_HOST" "docker login '$HARBOR_REGISTRY' -u '$HARBOR_USER' --password-stdin"

                        ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "$SSH_USER@$DEPLOY_HOST" /bin/sh <<EOF
set -eu
cd '$DEPLOY_DIR'
trap "docker logout '$HARBOR_REGISTRY' >/dev/null 2>&1 || true" EXIT
printf 'IMAGE_TAG=%s\n' '$IMAGE_TAG' > .env
docker compose pull
docker compose up -d
docker compose ps
curl --retry 10 --retry-connrefused --retry-delay 2 -fsS http://127.0.0.1:3000/ >/dev/null
EOF
                    '''
                }
            }
        }
    }

    post {
        always {
            echo '清理本地 Docker 登录状态和镜像缓存...'
            sh 'docker logout ${HARBOR_REGISTRY} || true'
            sh 'docker rmi ${FULL_IMAGE_NAME}:${IMAGE_TAG} || true'
            sh 'docker rmi ${FULL_IMAGE_NAME}:latest || true'

            echo '清理 Jenkins 工作区...'
            cleanWs()
        }
        success {
            echo "博客已成功发布到 ${DEPLOY_HOST}:3000，镜像标签：${IMAGE_TAG}"
        }
        failure {
            mail to: 'chius.me@outlook.com',
                 subject: "构建失败: ${env.JOB_NAME} [${env.BUILD_NUMBER}]",
                 body: '博客容器发布流水线失败，请检查 Jenkins 控制台日志。'
        }
    }
}
```

- [ ] **Step 2: Check Jenkinsfile for obvious secret interpolation mistakes**

Run:

```bash
grep -n "RCON_PASSWORD\|REDIS_PASSWORD\|ACCESS_TOKEN\|CLIENT_TOKEN" Jenkinsfile || true
```

Expected: no output. The Hugo blog pipeline should not contain unrelated app secrets copied from the reference pipeline.

- [ ] **Step 3: Check that required credential IDs are present**

Run:

```bash
grep -n "gitea-ssh-key\|harbor-robot-creds\|homelab-root" Jenkinsfile
```

Expected: output includes all three credential IDs.

- [ ] **Step 4: Commit this task if commits are approved**

Run only if the user explicitly approved commits:

```bash
git add Jenkinsfile
git commit -m "改为容器化发布 Hugo 博客"
```

### Task 4: Final Local Verification

**Files:**
- Read: `Dockerfile`
- Read: `.dockerignore`
- Read: `docker-compose.yml`
- Read: `Jenkinsfile`

- [ ] **Step 1: Show working tree changes**

Run:

```bash
git status --short
```

Expected: changed files include `Dockerfile`, `.dockerignore`, `docker-compose.yml`, `Jenkinsfile`, and planning docs unless they were committed.

- [ ] **Step 2: Validate Compose after all edits**

Run:

```bash
IMAGE_TAG=final-check docker compose config
```

Expected: command succeeds and prints image `10.0.0.134/main/hugo:final-check`.

- [ ] **Step 3: Build final image locally if Docker is available**

Run:

```bash
docker build -t 10.0.0.134/main/hugo:final-check .
```

Expected: Docker build succeeds. If base images cannot be pulled due to network restrictions, report the pull failure and keep the file changes unchanged.

- [ ] **Step 4: Clean local final-check image**

Run:

```bash
docker rmi 10.0.0.134/main/hugo:final-check || true
```

Expected: image is removed, or Docker reports it did not exist.

- [ ] **Step 5: Do not run deployment from local shell**

Do not SSH into `10.0.0.135` or run `docker compose up` outside Jenkins unless the user explicitly asks for a manual deployment. The implementation changes should be validated locally; actual deployment should happen through Jenkins.

## Self-Review Notes

- Spec coverage: the plan covers Docker image build, Harbor path `10.0.0.134/main/hugo`, Jenkins credential use, no repository clone on `10.0.0.135`, Compose upload to `/opt/hugo`, host port `3000`, and post-deploy checks.
- Placeholder scan: no deferred implementation language is present.
- Type and name consistency: image name is consistently `hugo`, service/container name is `hugo-blog`, deploy directory is `/opt/hugo`, and Compose uses `${IMAGE_TAG:-latest}` matching Jenkins-written `.env`.
