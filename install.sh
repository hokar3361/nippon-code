#!/bin/bash

# VLLMCode インストールスクリプト

echo "🚀 VLLMCode をインストールしています..."

# Node.js バージョンチェック
NODE_VERSION=$(node -v 2>/dev/null)
if [ $? -ne 0 ]; then
    echo "❌ Node.js がインストールされていません"
    echo "Node.js 18.0.0 以上が必要です"
    exit 1
fi

# バージョン番号を抽出
NODE_MAJOR=$(echo $NODE_VERSION | cut -d. -f1 | sed 's/v//')
if [ $NODE_MAJOR -lt 18 ]; then
    echo "❌ Node.js のバージョンが古すぎます: $NODE_VERSION"
    echo "Node.js 18.0.0 以上が必要です"
    exit 1
fi

echo "✓ Node.js $NODE_VERSION を検出しました"

# 依存関係のインストール
echo "📦 依存関係をインストールしています..."
npm install

# ビルド
echo "🔨 プロジェクトをビルドしています..."
npm run build

# グローバルリンク
echo "🔗 グローバルコマンドを設定しています..."
npm link

echo ""
echo "✨ インストールが完了しました！"
echo ""
echo "次のステップ:"
echo "  1. vllmcode init  # 初期設定を行う"
echo "  2. vllmcode chat  # 対話を開始する"
echo ""
echo "詳細は README.md を参照してください"
