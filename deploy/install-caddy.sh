#!/usr/bin/env bash
# ============================================================
# 在 ECS 上一键安装 Caddy 并为 Vocabulario 启用 HTTPS
#
# 用法（在服务器上，从项目根目录执行，默认域名 youngyy.me）：
#   sudo bash deploy/install-caddy.sh            # 使用默认域名 youngyy.me
#   sudo bash deploy/install-caddy.sh 新域名     # 也可传参数覆盖域名
#
# 前提：
#   1. 域名 A 记录已解析到本机公网 IP
#   2. ECS 安全组已放行 80 / 443 端口
#   3. 后端 PM2 进程（vocabulario-server，3001 端口）已正常运行
#
# 说明：
#   - Caddy 自动申请/续期 Let's Encrypt 证书，HTTPS 永久免费
#   - 安装后配置写入 /etc/caddy/Caddyfile
# ============================================================
set -e

DOMAIN="${1:-youngyy.me}"

if [ -f /etc/os-release ]; then . /etc/os-release; fi

echo "===== 1. 安装 Caddy ====="
if [[ "$ID" == "ubuntu" || "$ID_LIKE" == *"debian"* ]]; then
  sudo apt-get update -y
  sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list > /dev/null
  sudo apt-get update -y
  sudo apt-get install -y caddy
elif [[ "$ID" == "alinux" || "$ID" == "alios" || "$ID_LIKE" == *"rhel"* || "$ID" == "centos" || "$ID" == "fedora" ]]; then
  sudo dnf install -y 'dnf-command(copr)'
  sudo dnf copr enable -y '@caddy/caddy'
  sudo dnf install -y caddy
else
  echo "不支持的系统: $ID，请手动安装 Caddy: https://caddyserver.com/docs/install"
  exit 1
fi

echo "===== 2. 写入 Caddyfile ====="
sudo mkdir -p /etc/caddy /var/log/caddy
sudo tee /etc/caddy/Caddyfile > /dev/null <<EOF
# Vocabulario 生产 HTTPS 反向代理（由 install-caddy.sh 生成）
${DOMAIN} {
    encode zstd gzip
    reverse_proxy 127.0.0.1:3001
    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
        X-Content-Type-Options "nosniff"
        X-Frame-Options "DENY"
        Referrer-Policy "no-referrer"
    }
    log {
        output file /var/log/caddy/vocabulario.log {
            roll_size 10MiB
            roll_keep 5
            roll_keep_for 720h
        }
    }
}
EOF

echo "===== 3. 启动 Caddy 并设置开机自启 ====="
sudo systemctl enable caddy
sudo systemctl restart caddy
sleep 2
sudo systemctl status caddy --no-pager || true

echo ""
echo "======================================================"
echo "✅ 完成！请访问 https://${DOMAIN}"
echo ""
echo "⚠️  确认清单："
echo "   - 域名 ${DOMAIN} 的 A 记录已解析到本机公网 IP"
echo "   - ECS 安全组已放行 80 (HTTP) 和 443 (HTTPS) 端口"
echo "   - PM2 进程 (3001) 正常运行: pm2 status"
echo "   - 首次申请证书需 1-2 分钟，期间页面可能短暂不可达"
echo "======================================================"
