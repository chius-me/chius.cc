pipeline {
    agent any

    environment {
        HUGO_VERSION = '0.157.0' 
    }

    stages {
        stage('克隆代码 (Checkout)') {
            steps {
                git branch: 'main', 
                    credentialsId: 'gitea-ssh-key', 
                    url: 'ssh://git@10.0.0.131:2222/chius/hugo.git'
                sh 'git submodule update --init --recursive'
            }
        }

        stage('配置 Hugo 环境 (Setup)') {
            steps {
                sh '''
                    # 定义缓存目录 (存放在 Jenkins 用户的家目录下，跨越多次构建保留)
                    CACHE_DIR="$HOME/.hugo_cache/v${HUGO_VERSION}"
                    
                    # 检查缓存是否存在
                    if [ ! -f "${CACHE_DIR}/hugo" ]; then
                        echo "未找到本地缓存，开始下载 Hugo 扩展版 v${HUGO_VERSION}..."
                        mkdir -p "${CACHE_DIR}"
                        wget -q -O hugo.tar.gz https://github.com/gohugoio/hugo/releases/download/v${HUGO_VERSION}/hugo_extended_${HUGO_VERSION}_Linux-64bit.tar.gz
                        tar -xzf hugo.tar.gz -C "${CACHE_DIR}"
                        chmod +x "${CACHE_DIR}/hugo"
                    else
                        echo "⚡ 命中缓存！直接使用已下载的 Hugo v${HUGO_VERSION}"
                    fi
                    
                    # 将缓存的 hugo 复制到当前工作区，供下一步构建使用
                    cp "${CACHE_DIR}/hugo" ./hugo
                    ./hugo version
                '''
            }
        }

        stage('构建博客 (Build)') {
            steps {
                sh './hugo --minify --gc --cleanDestinationDir'
            }
        }

        stage('部署到 Caddy (Deploy)') {
            steps {
                withCredentials([sshUserPrivateKey(credentialsId: 'homelab-root', keyFileVariable: 'SSH_KEY')]) {
                    sh '''
                        echo "开始同步静态文件到 Caddy 服务器 (10.0.0.104)..."
                        rsync -avz --delete -e "ssh -i $SSH_KEY -o StrictHostKeyChecking=no" public/ root@10.0.0.104:/var/www/html/
                    '''
                }
            }
        }
    }
    
    post {
        always {
            cleanWs()
        }
        success {
            echo '🎉 博客已经成功发布到 Caddy 啦！'
        }
        failure {
            mail to: 'chius.me@outlook.com',
                 subject: "构建失败: ${env.JOB_NAME} [${env.BUILD_NUMBER}]",
                 body: "你的博客流水线跑挂了，快去 Jenkins 看看日志吧！"
        }
    }
}