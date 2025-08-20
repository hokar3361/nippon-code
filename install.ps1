# VLLMCode インストールスクリプト (Windows)

Write-Host "🚀 VLLMCode をインストールしています..." -ForegroundColor Cyan

# Node.js バージョンチェック
try {
    $nodeVersion = node -v 2>$null
    if (-not $nodeVersion) {
        throw "Node.js not found"
    }
} catch {
    Write-Host "❌ Node.js がインストールされていません" -ForegroundColor Red
    Write-Host "Node.js 18.0.0 以上が必要です" -ForegroundColor Yellow
    exit 1
}

# バージョン番号を抽出
$majorVersion = [int]($nodeVersion -replace 'v(\d+)\..*', '$1')
if ($majorVersion -lt 18) {
    Write-Host "❌ Node.js のバージョンが古すぎます: $nodeVersion" -ForegroundColor Red
    Write-Host "Node.js 18.0.0 以上が必要です" -ForegroundColor Yellow
    exit 1
}

Write-Host "✓ Node.js $nodeVersion を検出しました" -ForegroundColor Green

# 依存関係のインストール
Write-Host "📦 依存関係をインストールしています..." -ForegroundColor Cyan
npm install
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ 依存関係のインストールに失敗しました" -ForegroundColor Red
    exit 1
}

# ビルド
Write-Host "🔨 プロジェクトをビルドしています..." -ForegroundColor Cyan
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ ビルドに失敗しました" -ForegroundColor Red
    exit 1
}

# グローバルリンク
Write-Host "🔗 グローバルコマンドを設定しています..." -ForegroundColor Cyan
npm link
if ($LASTEXITCODE -ne 0) {
    Write-Host "⚠️  グローバルリンクの作成に失敗しました（管理者権限が必要かもしれません）" -ForegroundColor Yellow
    Write-Host "手動で 'npm install -g .' を実行してください" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "✨ インストールが完了しました！" -ForegroundColor Green
Write-Host ""
Write-Host "次のステップ:" -ForegroundColor Cyan
Write-Host "  1. vllmcode init  # 初期設定を行う" -ForegroundColor White
Write-Host "  2. vllmcode chat  # 対話を開始する" -ForegroundColor White
Write-Host ""
Write-Host "詳細は README.md を参照してください" -ForegroundColor Gray
