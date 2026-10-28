# 管理者初期設定・リンク管理（段階導入）

2026-10-28。承認済み仕様のうち、管理者認証・復旧・リンク管理を実装した段階です。
公開中のスコア入力・配信表示にはまだ接続しません。入力用URLの共有はINPUT_ENABLEDがtrueになるまで拒否します。

## 今回の実装

- 初回専用の期限付きトークンを持つ所有者だけが初期設定可能。
- 初回トークンはURLフラグメントで受け取り、サーバーやアクセスログのURLには含めない。
- 管理パスコードは数字6〜12桁。質問は120文字以内。回答は完全一致で照合し、前後空白・全半角を補正しない。
- Firebase標準認証を使う。Googleログインや利用者のメールアドレス入力は不要。
- 60分の管理セッションを発行し、ブラウザのsessionStorageに保持。DBにはトークンのSHA-256だけ保存。
- 管理用・復旧用でそれぞれ1分間6回まで試行予約。制限はサーバーのDBで管理。
- パスコード変更、回答による再設定、質問・回答変更時はアクティブな認証UIDを交換し、管理セッション世代を更新する。
- パスコードを忘れた場合も新しい管理用Firebaseアカウントへ原子的に切り替えるため、Firebase Adminの秘密鍵を要求しない。
- 通常変更では旧資格情報の証明を使って旧Authアカウントを自己削除。忘れた場合の旧管理用アカウントは管理権限を失い、retiredAccountsにUIDを記録する。
- retiredAccountsはAuth側に残る場合があるが、現在の管理者として照合されない。Firebaseコンソールでの整理対象として識別可能。
- 回答変更には管理セッションと現在の回答の両方が必要。
- リンク発行・管理名変更・有効/無効・廃棄・配信対象選択・非表示設定。新規リンクは無効で作成。
- 廃棄は再有効化不可。無効化・廃棄では配信対象の選択を消さず、将来の最終スコア保持につなぐ。
- 状態変更はFirebase RESTのETag/if-matchで競合時に再評価する。
- 保存結果が不明な場合は、アクティブになった可能性のある新しい認証アカウントを勝手に削除しない。
- JSON入力8KiB、管理データ512KiB、保管リンク200件を実装上の初期上限とする。

## 構成

| ファイル | 役割 |
| --- | --- |
| worker.mjs | HTTP API、CORS、CSP、管理画面の配信 |
| admin-ui.mjs | 初期設定・管理者ログイン・リンク管理・認証変更画面 |
| management-core.mjs | 認証世代・管理セッション・リンク管理の原子的な状態変更 |
| firebase-store.mjs | サーバー専用アカウントでのDBアクセス、条件付き書き込み |
| database.rules.json | 新しい管理領域への最小限のアクセス許可。既存gameの設定は維持 |
| provision-storage.mjs | 所有者が許可した一度だけのサーバー用アカウント準備 |
| management.test.mjs | 14件の権限・競合・復旧・障害テスト |
| auth-integration.test.mjs | 公式Auth Emulatorを使う管理者操作の結合テスト |
| browser-check.cjs | 390px/768pxでの初期設定・ログイン・リンク・復旧の操作確認 |

共通のFirebase認証アダプターは../experiments/firebase-auth/firebase-auth.mjsを使用します。
この段階のフォルダー構成は、本番への統合前に整理する対象です。

## サーバー用アカウント

DBアクセス専用のFirebase Authenticationアカウントを1件用意します。
メール名はmolkky-storage-で始まります。検証用のmolkky-probe-とは異なり、動作に必要なので削除しません。
パスワードはランダム生成し、Cloudflare Secretだけで利用します。ブラウザへ返しません。
管理・復旧用のアカウントは、所有者が初期設定画面で値を登録した時点で作成します。

公開ブラウザからDBの管理領域は読めません。管理者自身のFirebase認証トークンも画面には返しません。
DBへアクセスするのはCloudflare側でサーバー用アカウントとして認証した処理のみです。

### Cloudflare設定

- FIREBASE_WEB_API_KEY
- FIREBASE_PROJECT_ID
- DATABASE_URL
- DB_SERVICE_CONFIG: サーバー用UID/メール/ランダムパスワードのJSON
- AUTH_PEPPER: ランダムなサーバー側秘密
- BOOTSTRAP_TOKEN_HASH / BOOTSTRAP_EXPIRES_AT: 初回設定トークンの検証値・期限
- INPUT_ENABLED: スコア画面の接続が完了するまで設定しない（false扱い）

秘密の実値はGitへ保存しません。初回トークンの期限は発行から24時間です。
期限が切れて未設定の場合は、Cloudflareの管理権限からトークンを再発行します。

## DBルールの導入

同梱database.rules.jsonは、現在のgameの読み書きを維持したまま、新しいstream_v1/controlのみをサーバー用UIDに許可します。
既存スコアを止めるルールではなく、管理機能の導入準備用です。
所有者がFirebaseコンソールでルールを確認・公開するまでは、管理画面のAPIはDB_PERMISSION_DENIEDとなり、初期設定できません。
この権限エラーを回避するために、管理領域を公開読み書き可能にはしません。

## パスコードと秘密の回答を両方忘れた場合

FirebaseとCloudflareの所有者権限が必要です。

1. 管理領域をバックアップする。
2. Cloudflare管理権限で新しい初回トークンの検証値と期限を設定する。
3. Firebaseコンソールでcontrolのinitializedをfalse、setupLockをnullへ変更する。
4. 新しい初回設定案内からパスコード・質問・回答を設定する。

初期設定処理は既存リンクを保持し、新しい管理・復旧用UIDへ置き換え、管理セッションを全失効させます。
管理DBを全削除する手順ではありません。作業前に状態を確認して案内する緊急手順です。

## 確認

```sh
node --test server/management.test.mjs
# Auth Emulatorの依存関係はexperiments/firebase-authでnpm install
node --test server/auth-integration.test.mjs
```

ブラウザ確認はPlaywrightとChromiumを使います。browser-check.cjsの実行環境のブラウザパスは/tmp/chromiumです。
本番画面との結合テストではなく、管理画面と管理コアの接続を検証します。

## 未完了

- 所有者によるDBルール公開と、実DBを使う管理画面の初期設定・結合試験。
- 既存スコアアプリのホームに管理者メニューを追加する変更。
- 入力リンクからの試合読み込み、入力担当の取得・交代、投擲同期、オフラインキュー。
- 固定overlay URLへの表示対象反映、旧game書き込み権限の廃止、既存記録の移行。
- 全機能を含む無料枠の負荷計測。

リンク状態と表示対象の変更は、この段階では管理DBだけへの保存です。
スコア画面・配信表示への接続が完了したという意味ではありません。
