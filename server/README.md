# 管理・リンク別試合・入力担当・配信分離

2026-10-29。初期設定と管理領域のルール公開は所有者が完了しました。
入力・配信の接続を実装し、公式エミュレータとブラウザに加えて実サービスでも確認しました。
試合領域の追加ルールは所有者が公開済みです。GitHub Pagesを新しい保存・配信の仕組みへ切り替えます。
INPUT_ENABLEDがtrueになるまで入力APIと入力用URLの共有は拒否します。

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

Firebase認証アダプターは本番用のfirebase-auth.mjsに配置しています。

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
- INPUT_ENABLED: 試合用ルールと接続確認の準備ができたらtrueにする
- INPUT_URL: 切り替え前はWorkerの/preview/index.htmlを使用し、本番切り替え後は既存GitHub Pagesのindex.htmlを使用する

秘密の実値はGitへ保存しません。初回トークンの期限は発行から24時間です。
期限が切れて未設定の場合は、Cloudflareの管理権限からトークンを再発行します。

## DBルールの導入

同梱database.rules.jsonは、現在のgameの読み書きを維持し、stream_v1/control、rooms、archivesをサーバー用UIDだけに許可します。
例外として配信対象IDと非表示設定、選択したリンクのcurrent/viewJsonだけを公開読み取り可能にします。
roomsの書き込みは、リンクが有効・未廃棄で、保存するgenerationが管理領域と一致することもコミット時に検証します。
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

## 試合保存と交代

scoring-core.mjsがリンクの秘密・担当端末のハッシュと担当世代・対象試合・保存版を照合します。
1リンク1トランザクションとしてETagで競合を解決し、別リンクの試合とは競合しません。
端末の入力世代は交代で変更し、リンクのgenerationは無効化・再有効化・廃棄で変更します。
DBルールでもgenerationを検証するため、無効化と同時進行した古い更新を拒否します。
入力要求はPOST JSONで送信し、リンクの秘密や端末情報をURLクエリへ含めません。

スナップショットは構造・サイズ・配信用のチーム名と得点の一致を検証します。
状態JSONを文字列で保存し、Firebaseが空配列を消してもゲームの構造が変わらないようにします。
操作IDによる再送抑止と保存版による競合検知を両方行います。
通常交代は未送信分の同期後、新端末の申請を現担当が承認します。
故障時は新端末が申請し、管理者が確認後に強制交代します。サーバーに届いていない記録は移りません。

現在の記録はroomsに保存し、次の試合の前にarchivesへ直前版を保存します。
アーカイブ作成後に切り替えが競合しても、履歴一覧への追加と現在試合の更新は一度だけです。
途中でリセットした記録もJSONで取り出せます。管理画面から無効・廃棄済みリンクの記録にもアクセスできます。

## 確認とデプロイ

```sh
node build-preview.mjs
node --test tests/regression.cjs server/management.test.mjs server/scoring.test.mjs
npm ci --prefix experiments/firebase-auth
node --test server/auth-integration.test.mjs
# 公式Database Emulator v4.11.2のjarとJavaを用意する
MOLKKY_DATABASE_EMULATOR_JAR=/path/to/firebase-database-emulator.jar node --test server/database-rules.test.mjs
# PlaywrightとChromiumを用意する。実行ファイルの既定は/tmp/chromium
node server/browser-check.cjs
node server/scoring-browser.cjs
node server/overlay-browser.cjs
```

確認済み: 既存87件、管理14件、試合9件、公式Auth Emulator1件、公式Database Emulator1件（合計112件）。
ブラウザでは管理・入力の390/768px、配信切り替え・非表示・旧同期経路の無視を確認しました。
入力UIでは閲覧、通常交代、強制交代、オフライン再読み込み、旧端末の未送信保持、次試合アーカイブ、応答欠落後の再接続を確認します。
10並列試合はコアの独立性テストです。実サービスの10試合同時負荷を保証する測定ではありません。

Workerをデプロイする前にnode build-preview.mjsを実行します。
生成したserver/preview-assets.mjsは確認画面用で、Gitには保存しません。
APIの初期設定・認証情報は既存のCloudflare Secretを保持して更新します。
/database-setupで、所有者が追加ルールをコピーできます。

## 本番への反映と運用

1. 所有者がFirebaseの試合領域ルールを公開する。アプリ画面からはルールを変更できない。
2. 入力APIと確認用URLを有効にし、実DBでリンク別保存・拒否・配信を検証する。
3. 旧gameの保存済み表示と必要な管理領域をバックアップする。
4. GitHub Pagesへ変更を反映し、INPUT_URLを既存のindex.htmlへ戻す。
5. 配信ソフトのブラウザソースを再読み込みし、固定URLで新しい表示を受信することを確認する。

旧gameは新しい配信画面から参照しません。旧版端末の書き込みが残っても新配信は更新できません。
旧gameへの書き込み権限の削除は、本番切り替え後に既存端末への影響を確認して別途行います。
戻す必要がある場合はGitHub Pagesの変更を戻してから、旧game表示を確認します。新しい試合記録は削除しません。

## 実サービスの接続確認（2026-10-29）

本番と同じCloudflare Worker・Firebase DB・Rulesで、2つの一時リンクを使って確認しました。
試合間の分離、入力担当の排他、同一操作IDの再送、通常交代、管理者の強制交代、旧端末の拒否、次試合のアーカイブ、非公開記録の直接読み取り拒否、無効化後の書き込み拒否、選択した試合の公開表示と最終表示保持が成功しました。
一時リンクと一時管理セッションは片付け、利用者の既存データを保持します。切り替え前の管理領域と旧gameは、所有者側の非公開チェックポイントへバックアップしています。
2試合の接続確認は10試合同時負荷の実測ではありません。
