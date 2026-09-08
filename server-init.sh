#!/usr/bin/env bash
# 新服务器一键初始化脚本（2核2GB）
# 用法：在 ECS 控制台「远程连接」(Workbench) 的终端里，把本脚本内容整段粘贴执行即可。
set -e

echo "===== 0. 提权（输入你创建实例时设的密码）====="
sudo -v

# 检测系统 / 包管理器
if [ -f /etc/os-release ]; then . /etc/os-release; fi
if [[ "$ID" == "ubuntu" || "$ID_LIKE" == *"debian"* ]]; then
  PM="apt"
elif [[ "$ID" == "alinux" || "$ID" == "alios" || "$ID_LIKE" == *"rhel"* || "$ID" == "centos" ]]; then
  PM="dnf"
else
  echo "未知系统 ID=$ID，请手动安装 git/node"; exit 1
fi
echo "检测到系统: $ID，包管理器: $PM"

echo "===== 1. 安装基础工具 ====="
if [ "$PM" = "apt" ]; then
  sudo apt-get update -y
  sudo apt-get install -y git curl build-essential ca-certificates python3
else
  sudo dnf install -y git curl gcc gcc-c++ make python3
fi

echo "===== 2. 安装 Node.js 22 ====="
if [ "$PM" = "apt" ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
else
  curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash -
  sudo dnf install -y nodejs
fi
node -v && npm -v

echo "===== 3. 安装 PM2 ====="
sudo npm install -g pm2

echo "===== 4. 配置 2GB swap（2核2GB 必备，防编译时内存不足）====="
if ! sudo swapon --show | grep -q /swapfile; then
  sudo fallocate -l 2G /swapfile 2>/dev/null || sudo dd if=/dev/zero of=/swapfile bs=1M count=2048
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
fi
free -h

echo "===== 5. 写入部署公钥（供 GitHub Actions 免密登录）====="
mkdir -p ~/.ssh && chmod 700 ~/.ssh
# 下面这行是本地 id_rsa.pub 的内容（公钥，可公开）
cat >> ~/.ssh/authorized_keys <<'PUBEOF'
ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAACAQCombTf0hrQqdOmvm4OFIudupNhowsinD8m/1Mwtq3SwNPZmVX75F3zWm//yJs4zFKJIE5R/eUOnQWHQhNxgUI8VRap/EIuF8mgvx/YVEwjwD23+Wq0FxFBVE5rF0CTn+R7QeG8A7mPjTgBRVjCx4PhfZ7QBCO5MCkR9KtYcIv88eeWZK6Ri9xV6pJmj7Ksr7WtUQaedAJj1qd4vnSpnO/z6b9FwDH/q6zpl6MuYzk96kexGaVI4mbIj/UxcOziepvtGgpMvkSVC4pBCoizNx674zxZZgCf11YeoaDDSSbEguDxVhA20TybCs2Yy9c9dzik7yTa1pgRHTmBbI/hD+wV9L0JSomaUElR1AVIVVervE5Sh+q9WoBh6O/BFDa4gfHye6WM20kV7KbPaO/2axWLr+LsrzlP319rbaHpeBL3pW6CUMkHzAvCK4MOl2BTh71e7g9bL8nCIRTLFsJgTR1UvMyKcz7sfLlUVbMlxQ4+5iC1Zzhitks4ysRZ70X4Ub95khs2ClV/fdEXWLL8EtqqAuuAN+T+NIEJVeBEi2tdAAOsu3XGOdL15Yt2oZNyLIlb5bZh40l46zNGq7RbPHeEcQPbeBGHImtpK3u/UZMpMjmVWaZ6X28tm/jblCfjKZtN2V44/1imYgMXLJQaspBZxfysIxWxFL7Czip46LIU7w== ydy@ydy
PUBEOF
chmod 600 ~/.ssh/authorized_keys
echo "公钥已写入。"

echo "===== 6. 克隆仓库（需要 GitHub PAT，仅 repo 读权限）====="
read -s -p "请输入 GitHub Personal Access Token: " GH_PAT; echo
REPO_URL="https://x-access-token:${GH_PAT}@github.com/ydy075280-oss/vocabulario-espanol.git"
sudo mkdir -p /opt/vocabulario-espanol
sudo chown -R "$(whoami)" /opt/vocabulario-espanol
git clone "$REPO_URL" /opt/vocabulario-espanol
cd /opt/vocabulario-espanol
# 把 PAT 写进 remote，后续 git pull 也能免密
git remote set-url origin "$REPO_URL"
echo "仓库已克隆到 /opt/vocabulario-espanol"

echo "===== 7. 配置 PM2 开机自启（best-effort）====="
sudo pm2 startup || true
pm2 save || true

echo "===== 完成 ✅ ====="
echo "当前用户: $(whoami)"
echo "Node: $(node -v)  npm: $(npm -v)  pm2: $(pm2 -v)"
echo "请确认 /opt/vocabulario-espanol 存在且 git pull 正常，然后去改 GitHub Secret 并 push 触发部署。"
