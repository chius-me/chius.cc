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
