// 默认隐私政策内容（多语言支持）

export const DEFAULT_PRIVACY: Record<string, string> = {
  'zh-CN': `# Textox 隐私政策

**生效日期：2026年11月1日**

## 简介

Textox（"我们"、"我们的"或"本应用"）是一款 Markdown 编辑器应用。我们非常重视用户的隐私保护。本隐私政策旨在向您说明我们如何收集、使用和保护您的信息。

## 信息收集

### 我们不收集的信息

Textox 是一款本地优先的 Markdown 编辑器，**我们不会**：

- 主动收集姓名、邮箱、电话等可直接识别您身份的联系信息
- 在您未主动使用 AI 功能时，读取或上传您的文档内容（AI 功能发送的内容见下文）
- 追踪您的编辑行为或使用您的数据展示广告
- 使用分析、营销工具收集您的行为数据或建立用户画像
- 出售或出租您的任何数据

### 我们处理的本地数据

Textox 仅在您的设备本地处理以下数据：

- **Markdown 文档内容**：您创建和编辑的文档完全存储在您的设备上
- **最近打开的文件列表**：保存在本地，用于提供"最近文件"功能
- **应用设置**：如主题偏好、编辑器设置等，存储在本地
- **未保存的更改**：临时保存在本地，用于崩溃恢复

### 崩溃诊断信息

Textox 不会为了崩溃诊断上传您的文档内容。当应用发生崩溃或严重错误时，为了定位和修复问题，应用可能自动向第三方崩溃诊断服务 Sentry（sentry.io）发送以下诊断信息，这些数据存储于 Sentry 的欧盟数据中心（德国）：

- 崩溃原因与错误信息
- 崩溃发生位置的调用栈（代码文件、函数名、行号）
- 应用版本、操作系统与设备架构等基础环境信息
- 崩溃发生时间

这些诊断信息不包含您的文档内容，仅用于定位和修复崩溃问题，不会用于广告、营销分析或用户画像。Sentry 将按照其[隐私政策](https://sentry.io/privacy/)处理这些数据（按我们当前使用的套餐，诊断数据保留 30 天）。

## AI 功能与第三方模型服务

AI 释义与 AI 翻译是需要您主动配置的可选功能。只有在您于设置中填写模型服务与 API Key，并主动选中文字触发「解释」或「翻译」（或点击「测试连接」）时，应用才会向模型服务商发起请求。未配置或停用 AI 插件时，应用不会发起任何 AI 请求。

使用这些功能时，应用会将以下内容直接发送到您选择的模型服务商：

- 您选中的文本（不超过 4000 字符）
- 选中文本所在的段落（不超过 2000 字符）
- 当前内容所属的标题层级
- 用于生成结果的提示词

以上是目前功能发送的内容。若后续功能需要读取整篇文档、您指定的文件或工作区内的文档，应用会在该功能首次使用前说明发送范围，并重新征得您的同意。

「测试连接」仅发送一个用于验证连通性的简短请求（ping）。

请求由您的设备直接发往服务商的 API 端点（OpenAI、DeepSeek，或您填写的自定义 OpenAI 兼容服务），不经过我们的服务器。我们不会接收、存储或分析这些内容。服务商如何处理这些数据（包括是否用于训练、日志保留期限等）由服务商自身的隐私政策决定，请在启用前查阅：

- [OpenAI 隐私政策](https://openai.com/policies/privacy-policy)
- [DeepSeek 隐私政策](https://cdn.deepseek.com/policies/zh-CN/deepseek-privacy-policy.html)

若您使用自定义服务，请自行确认该服务的数据处理方式。

您填写的 API Key 仅保存在您设备的本地配置文件中（以明文存储），用于向所选服务商发起请求；我们不会上传或收集该 Key。请妥善保管您的设备与配置文件。您可以随时在设置中清除 API Key 或停用 AI 插件，停用后应用不会发起任何 AI 请求。

## 文件系统访问

Textox 需要访问您的文件系统来：

- 打开您选择的 Markdown 文件
- 保存文档到您指定的位置
- 管理您的工作目录

**重要说明**：
- 所有文件操作都需要您的明确授权
- 我们不会访问您未选择的文件
- 只有您主动使用 AI 功能时，应用才会把该功能所需的文档内容发送给您指定的服务商；其余情况下您的文档不会离开设备

## 网络访问

Textox 仅在以下情况下使用网络：

- 加载在线图片（仅在您文档中包含网络图片链接时）
- 检查应用更新（可选功能）
- 发生崩溃或严重错误时，上报崩溃诊断信息（见上文"崩溃诊断信息"）
- 您主动使用 AI 释义、AI 翻译或「测试连接」时，向您所选并配置的模型服务商发送请求（见上文"AI 功能与第三方模型服务"）

## 数据安全

- 您的文档、设置等数据默认仅存储在本地设备上
- 我们使用 Apple 的沙盒技术保护您的文件
- 仅在崩溃诊断或您主动使用 AI 功能时发送数据；未触发 AI 功能时不上传文档或设置
- AI API Key 以明文保存在本地配置文件中，请妥善保管您的设备与配置文件

## 第三方服务

Textox 不包含任何第三方广告或追踪服务，也不使用营销分析工具。崩溃诊断由第三方服务 Sentry（sentry.io）提供，数据存储于其欧盟数据中心（德国），详情见上文"崩溃诊断信息"。AI 功能由您自行选择并配置的模型服务商提供，内容直接发送给该服务商，详情见上文"AI 功能与第三方模型服务"。

## 儿童隐私

Textox 不会故意收集 13 岁以下儿童的任何信息。

## 隐私政策变更

我们可能会不时更新本隐私政策。任何变更将在应用更新时通知您。

## 联系我们

如果您对本隐私政策有任何疑问，请通过以下方式联系我们：

- 电子邮件：hi@textox.cn

## 您的权利

Textox 仅收集有限的崩溃诊断信息（不含您的文档内容）。如您对这些信息的处理有疑问，或希望请求删除与您相关的诊断数据，请通过下方联系方式联系我们。您可以随时在设置中清除 AI API Key、停用 AI 插件，或删除本地配置文件以移除相关数据。

---

**最后更新：2026年11月1日**
`,

  'zh-TW': `# Textox 隱私政策

**生效日期：2026年11月1日**

## 簡介

Textox（"我們"、"我們的"或"本應用"）是一款 Markdown 編輯器應用。我們非常重視用戶的隱私保護。本隱私政策旨在向您說明我們如何收集、使用和保護您的信息。

## 信息收集

### 我們不收集的信息

Textox 是一款本地優先的 Markdown 編輯器，**我們不會**：

- 主動收集姓名、郵箱、電話等可直接識別您身份的聯繫信息
- 在您未主動使用 AI 功能時，讀取或上傳您的文檔內容（AI 功能發送的內容見下文）
- 追蹤您的使用行為
- 使用分析工具收集數據
- 顯示廣告或追蹤您的瀏覽習慣

### 我們處理的本地數據

Textox 僅在您的設備本地處理以下數據：

- **Markdown 文檔內容**：您創建和編輯的文檔完全存儲在您的設備上
- **最近打開的文件列表**：保存在本地，用於提供"最近文件"功能
- **應用設置**：如主題偏好、編輯器設置等，存儲在本地
- **未保存的更改**：臨時保存在本地，用於崩潰恢復

## 崩潰診斷信息

Textox 不會為了崩潰診斷上傳您的文檔內容。當應用發生崩潰或嚴重錯誤時，為了定位和修復問題，應用可能自動向第三方崩潰診斷服務 Sentry（sentry.io）發送以下診斷信息，這些數據存儲於 Sentry 的歐盟數據中心（德國）：

- 崩潰原因與錯誤信息
- 崩潰發生位置的調用棧（代碼文件、函數名、行號）
- 應用版本、操作系統與設備架構等基礎環境信息
- 崩潰發生時間

這些診斷信息不包含您的文檔內容，僅用於定位和修復崩潰問題，不會用於廣告、營銷分析或用戶畫像。Sentry 將按照其[隱私政策](https://sentry.io/privacy/)處理這些數據（按我們當前使用的套餐，診斷數據保留 30 天）。

## AI 功能與第三方模型服務

AI 釋義與 AI 翻譯是需要您主動配置的可選功能。只有在您於設定中填寫模型服務與 API Key，並主動選取文字觸發「解釋」或「翻譯」（或點擊「測試連接」）時，應用才會向模型服務商發起請求。未配置或停用 AI 插件時，應用不會發起任何 AI 請求。

使用這些功能時，應用會將以下內容直接發送到您選擇的模型服務商：

- 您選取的文字（不超過 4000 字元）
- 選取文字所在的段落（不超過 2000 字元）
- 當前內容所屬的標題層級
- 用於生成結果的提示詞

以上是目前功能發送的內容。若後續功能需要讀取整篇文檔、您指定的檔案或工作區內的文檔，應用會在該功能首次使用前說明發送範圍，並重新徵得您的同意。

「測試連接」僅發送一個用於驗證連通性的簡短請求（ping）。

請求由您的設備直接發往服務商的 API 端點（OpenAI、DeepSeek，或您填寫的自訂 OpenAI 相容服務），不經過我們的伺服器。我們不會接收、存儲或分析這些內容。服務商如何處理這些數據（包括是否用於訓練、日誌保留期限等）由服務商自身的隱私政策決定，請在啟用前查閱：

- [OpenAI 隱私政策](https://openai.com/policies/privacy-policy)
- [DeepSeek 隱私政策](https://cdn.deepseek.com/policies/zh-CN/deepseek-privacy-policy.html)

若您使用自訂服務，請自行確認該服務的數據處理方式。

您填寫的 API Key 僅保存在您設備的本地配置文件中（以明文存儲），用於向所選服務商發起請求；我們不會上傳或收集該 Key。請妥善保管您的設備與配置文件。您可以隨時在設定中清除 API Key 或停用 AI 插件，停用後應用不會發起任何 AI 請求。

## 文件系統訪問

Textox 需要訪問您的文件系統來：

- 打開您選擇的 Markdown 文件
- 保存文檔到您指定的位置
- 管理您的工作目錄

**重要說明**：
- 所有文件操作都需要您的明確授權
- 我們不會訪問您未選擇的文件
- 只有您主動使用 AI 功能時，應用才會把該功能所需的文檔內容發送給您指定的服務商；其餘情況下您的文檔不會離開設備

## 網絡訪問

Textox 僅在以下情況下使用網絡：

- 加載在線圖片（僅在您文檔中包含網絡圖片鏈接時）
- 檢查應用更新（可選功能）
- 發生崩潰或嚴重錯誤時，上報崩潰診斷信息（見上文"崩潰診斷信息"）
- 您主動使用 AI 釋義、AI 翻譯或「測試連接」時，向您所選並配置的模型服務商發送請求（見上文"AI 功能與第三方模型服務"）

## 數據安全

- 您的文檔、設定等數據預設僅存儲在本地設備上
- 我們使用 Apple 的沙盒技術保護您的文件
- 僅在崩潰診斷或您主動使用 AI 功能時發送數據；未觸發 AI 功能時不上傳文檔或設定
- AI API Key 以明文保存在本地配置文件中，請妥善保管您的設備與配置文件

## 第三方服務

Textox 不包含任何第三方廣告或追蹤服務，也不使用營銷分析工具。崩潰診斷由第三方服務 Sentry（sentry.io）提供，數據存儲於其歐盟數據中心（德國），詳情見上文"崩潰診斷信息"。AI 功能由您自行選擇並配置的模型服務商提供，內容直接發送給該服務商，詳情見上文"AI 功能與第三方模型服務"。

## 兒童隱私

Textox 不會故意收集 13 歲以下兒童的任何信息。

## 隱私政策變更

我們可能會不時更新本隱私政策。任何變更將在應用更新時通知您。

## 聯繫我們

如果您對本隱私政策有任何疑問，請通過以下方式聯繫我們：

- 電子郵件：hi@textox.cn

## 您的權利

由於 Textox 不收集任何個人數據，您無需請求數據訪問、更正或刪除。您的所有數據都由您完全控制，存儲在您的設備上。您可以隨時在設定中清除 AI API Key、停用 AI 插件，或刪除本地配置文件以移除相關數據。

---

**最後更新：2026年11月1日**
`,

  'en-US': `# Textox Privacy Policy

**Effective Date: November 1, 2026**

## Introduction

Textox ("we," "our," or "the app") is a Markdown editor application. We take user privacy very seriously. This Privacy Policy is designed to explain how we collect, use, and protect your information.

## Information Collection

### What We Don't Collect

Textox is a local-first Markdown editor. **We do not**:

- Actively collect contact information that directly identifies you (such as your name or email address)
- Read or upload your document content unless you actively use an AI feature (what those features send is described below)
- Track your editing habits or use your data for advertising
- Use analytics or marketing tools to build a profile of you
- Sell or rent your data

### Local Data We Process

Textox only processes the following data locally on your device:

- **Markdown document content**: Documents you create and edit are stored entirely on your device
- **Recently opened files list**: Saved locally to provide the "Recent Files" feature
- **App settings**: Such as theme preferences, editor settings, etc., stored locally
- **Unsaved changes**: Temporarily saved locally for crash recovery

### Crash Diagnostic Information

Textox does not upload your document content for crash diagnostics. However, when the app crashes or encounters a serious error, it may automatically send limited diagnostic information to the third-party crash reporting service Sentry (sentry.io), where the data is stored in Sentry's EU data center in Germany, so we can diagnose and fix the issue:

- Crash reason and error message
- Stack trace of the crash location (code file, function, and line)
- Basic environment information such as app version, operating system, and device architecture
- Timestamp of the crash

This diagnostic information never includes your document content. It is used solely to diagnose and fix crashes, and is never used for advertising, marketing analytics, or profiling. Sentry processes this data under its own [privacy policy](https://sentry.io/privacy/) (retained for 30 days under the plan we currently use).

## AI Features and Third-Party Model Providers

AI Explain and AI Translate are optional features that require your configuration. The app only contacts a model provider when you enter a model service and API key in Settings and then actively select text to run Explain or Translate (or click Test Connection). When no API key is configured or the AI plugins are disabled, the app makes no AI requests.

When you use these features, the app sends the following directly to the model provider you choose:

- The text you selected (up to 4,000 characters)
- The paragraph containing the selection (up to 2,000 characters)
- The heading hierarchy that contains the current content
- The prompt used to generate the result

That list covers the features available today. If a later feature needs to read a whole document, files you choose, or documents in your workspace, the app will describe the scope before you first use it and ask for your consent again.

Test Connection sends only a short request (ping) to verify connectivity.

Requests go directly from your device to the provider's API endpoint (OpenAI, DeepSeek, or a custom OpenAI-compatible service you enter) and do not pass through our servers. We do not receive, store, or analyze this content. How the provider handles the data, including whether it is used for training and how long logs are retained, is governed by that provider's privacy policy. Please review it before enabling the feature:

- [OpenAI Privacy Policy](https://openai.com/policies/privacy-policy)
- [DeepSeek Privacy Policy](https://cdn.deepseek.com/policies/zh-CN/deepseek-privacy-policy.html)

If you use a custom service, please confirm its data practices yourself.

The API key you enter is stored only in a local configuration file on your device (in plain text) and is used to make requests to the provider you selected. We do not upload or collect it. Please protect your device and configuration file. You can clear the API key or disable the AI plugins at any time; once disabled, the app makes no further AI requests.

## File System Access

Textox needs access to your file system to:

- Open Markdown files you select
- Save documents to your specified location
- Manage your working directory

**Important Notes**:
- All file operations require your explicit authorization
- We do not access files you haven't selected
- The app sends document content to your chosen provider only when you actively use an AI feature; otherwise your document content stays on your device

## Network Access

Textox only uses the network in the following situations:

- Loading online images (only when your document contains network image links)
- Checking for app updates (optional feature)
- Reporting crash diagnostic information when the app crashes (see "Crash Diagnostic Information" above)
- Sending requests to the model provider you selected and configured when you actively use AI Explain, AI Translate, or Test Connection (see "AI Features and Third-Party Model Providers" above)

## Data Security

- Your documents and settings are stored only on your local device by default
- We use Apple's sandbox technology to protect your files
- Data leaves your device only for crash diagnostics or when you actively use an AI feature; nothing is uploaded while no AI feature runs
- AI API keys are stored in plain text in the local configuration file; please protect your device and configuration file

## Third-Party Services

Textox does not include any third-party advertising or tracking services or marketing analytics. Crash diagnostics are provided by the third-party service Sentry (sentry.io), with data stored in Sentry's EU data center in Germany — see "Crash Diagnostic Information" above. AI features are provided by the model provider you choose and configure, and content is sent directly to that provider — see "AI Features and Third-Party Model Providers" above.

## Children's Privacy

Textox does not knowingly collect any information from children under 13.

## Privacy Policy Changes

We may update this Privacy Policy from time to time. Any changes will be notified when the app is updated.

## Contact Us

If you have any questions about this Privacy Policy, please contact us:

- Email: hi@textox.cn

## Your Rights

Textox collects only limited crash diagnostic information, which never includes your document content. If you have questions about how this data is handled, or would like to request deletion of diagnostic data related to you, please contact us via the email address above. You can clear the AI API key, disable the AI plugins, or delete the local configuration file at any time to remove the related data.

---

**Last Updated: November 1, 2026**
`,

  'ja-JP': `# Textox プライバシーポリシー

**発効日：2026年11月1日**

## はじめに

Textox（"当社"、"当社の"、または"本アプリ"）は Markdown エディターアプリケーションです。当社はユーザーのプライバシーを非常に重視しています。本プライバシーポリシーは、当社がどのように情報を収集、使用、保護するかを説明するために作成されました。

## 情報の収集

### 収集しない情報

Textox はローカル優先の Markdown エディターです。**当社は以下を行いません**：

- 個人を特定できる連絡先情報（氏名、メールアドレスなど）の収集
- AI 機能を能動的に使用しない限り、文書コンテンツを読み取ったりアップロードしたりしません（AI 機能が送信する内容は後述）
- 編集行動の追跡や、データを広告に利用
- 分析・マーケティングツールによる行動データの収集やプロファイリング
- データの販売や貸与

### 処理するローカルデータ

Textox はお使いのデバイス上で以下のデータのみをローカルに処理します：

- **Markdown 文書コンテンツ**：作成・編集した文書は完全にお使いのデバイスに保存されます
- **最近開いたファイルリスト**："最近のファイル"機能を提供するためにローカルに保存
- **アプリ設定**：テーマ設定、エディター設定など、ローカルに保存
- **未保存の変更**：クラッシュ復旧のために一時的にローカルに保存

## クラッシュ診断情報

Textox はクラッシュ診断のために文書コンテンツをアップロードすることはありません。ただし、アプリがクラッシュしたり重大なエラーが発生した場合、問題の特定と修正のため、第三者のクラッシュレポートサービス Sentry（sentry.io）に以下の診断情報を自動送信することがあります。データは Sentry の EU データセンター（ドイツ）に保存されます：

- クラッシュの原因とエラーメッセージ
- クラッシュ発生箇所のスタックトレース（コードファイル、関数名、行番号）
- アプリのバージョン、OS、デバイスアーキテクチャなどの基本環境情報
- クラッシュの発生日時

これらの診断情報に文書コンテンツは含まれません。クラッシュの診断と修正のみに使用され、広告、マーケティング分析、プロファイリングには使用されません。Sentry は独自の[プライバシーポリシー](https://sentry.io/privacy/)に従ってこのデータを処理します（現在のプランでは診断データは 30 日間保持されます）。

## AI 機能と第三者のモデルサービス

AI 解説と AI 翻訳は、お客様ご自身で設定するオプション機能です。設定でモデルサービスと API キーを入力し、テキストを選択して「解説」または「翻訳」を実行した場合（または「接続テスト」をクリックした場合）にのみ、アプリはモデルサービスにリクエストを送信します。API キーが未設定の場合、または AI プラグインが無効な場合、アプリは AI リクエストを送信しません。

これらの機能を使用すると、アプリは以下の内容を選択したモデルサービスに直接送信します：

- 選択したテキスト（最大 4,000 文字）
- 選択範囲を含む段落（最大 2,000 文字）
- 現在の内容が属する見出し階層
- 結果を生成するためのプロンプト

上記は現在の機能が送信する内容です。今後、文書全体、お客様が指定したファイル、またはワークスペース内の文書を読み取る機能を追加する場合は、その機能の初回使用前に送信範囲を説明し、改めて同意を求めます。

「接続テスト」は、接続を確認するための短いリクエスト（ping）のみを送信します。

リクエストはお客様のデバイスからサービスの API エンドポイント（OpenAI、DeepSeek、または入力したカスタム OpenAI 互換サービス）に直接送信され、当社のサーバーを経由しません。当社はこの内容を受信、保存、分析しません。サービスによるデータの取り扱い（トレーニングへの利用の有無、ログの保持期間など）は、各サービスのプライバシーポリシーに従います。有効にする前にご確認ください：

- [OpenAI プライバシーポリシー](https://openai.com/policies/privacy-policy)
- [DeepSeek プライバシーポリシー](https://cdn.deepseek.com/policies/zh-CN/deepseek-privacy-policy.html)

カスタムサービスを使用する場合は、そのデータの取り扱いをご自身でご確認ください。

入力した API キーはお使いのデバイスのローカル設定ファイルにのみ（平文で）保存され、選択したサービスへのリクエストに使用されます。当社はこのキーをアップロードまたは収集しません。デバイスと設定ファイルを適切に管理してください。設定で API キーを削除するか、AI プラグインを無効にすることがいつでも可能です。無効にすると、アプリは以降 AI リクエストを送信しません。

## ファイルシステムへのアクセス

Textox は以下の目的でファイルシステムへのアクセスが必要です：

- 選択した Markdown ファイルを開く
- 文書を指定した場所に保存
- 作業ディレクトリの管理

**重要な注意事項**：
- すべてのファイル操作には明示的な承認が必要です
- 選択していないファイルにはアクセスしません
- お客様が AI 機能を能動的に使用したときに限り、アプリはその機能に必要な文書コンテンツを指定したサービスへ送信します。それ以外の場合、文書コンテンツがデバイスから出ることはありません

## ネットワークアクセス

Textox は以下の状況でのみネットワークを使用します：

- オンライン画像の読み込み（文書にネットワーク画像リンクが含まれている場合のみ）
- アプリ更新の確認（オプション機能）
- アプリのクラッシュ時にクラッシュ診断情報を送信（上記「クラッシュ診断情報」を参照）
- AI 解説、AI 翻訳、または「接続テスト」を主動で使用したときに、選択・設定したモデルサービスへリクエストを送信（上記「AI 機能と第三者のモデルサービス」を参照）

## データセキュリティ

- 文書や設定などのデータは、既定ではローカルデバイスにのみ保存されます
- Apple のサンドボックス技術を使用してファイルを保護しています
- データが外部に送信されるのは、クラッシュ診断時、またはお客様が AI 機能を能動的に使用した場合のみです。AI 機能を実行していないときは文書も設定もアップロードされません
- AI の API キーはローカル設定ファイルに平文で保存されます。デバイスと設定ファイルを適切に管理してください

## サードパーティサービス

Textox には第三者の広告、追跡、マーケティング分析サービスは含まれていません。クラッシュ診断は第三者のサービス Sentry（sentry.io）が提供し、データは同社の EU データセンター（ドイツ）に保存されます。詳細は上記「クラッシュ診断情報」を参照してください。AI 機能はお客様が選択・設定したモデルサービスが提供し、内容はそのサービスに直接送信されます。詳細は上記「AI 機能と第三者のモデルサービス」を参照してください。

## 子供のプライバシー

Textox は13歳未満の子供から意図的に情報を収集することはありません。

## プライバシーポリシーの変更

当社は本プライバシーポリシーを随時更新する場合があります。変更はアプリ更新時に通知されます。

## お問い合わせ

本プライバシーポリシーについてご質問がある場合は、以下の方法でお問い合わせください：

- メール：hi@textox.cn

## お客様の権利

Textox は個人データを収集しないため、データへのアクセス、訂正、削除をリクエストする必要はありません。すべてのデータはお客様が完全に管理し、お使いのデバイスに保存されています。設定で AI の API キーを削除するか、AI プラグインを無効にするか、ローカル設定ファイルを削除することで、関連データをいつでも削除できます。

---

**最終更新日：2026年11月1日**
`,

  'ko-KR': `# Textox 개인정보 처리방침

**시행일: 2026년 11월 1일**

## 소개

Textox("우리", "우리의", 또는 "본 앱")는 Markdown 편집기 애플리케이션입니다. 우리는 사용자의 개인정보를 매우 중요하게 생각합니다. 본 개인정보 처리방침은 우리가 정보를 어떻게 수집, 사용, 보호하는지 설명하기 위해 작성되었습니다.

## 정보 수집

### 수집하지 않는 정보

Textox는 로컬 우선 Markdown 편집기입니다. **우리는 다음을 하지 않습니다**：

- 개인을 직접 식별할 수 있는 연락처 정보(이름, 이메일 등) 수집
- AI 기능을 직접 사용하지 않는 한 문서 콘텐츠를 읽거나 업로드하지 않음(AI 기능이 전송하는 내용은 아래 참조)
- 편집 행동 추적 또는 데이터를 광고에 사용
- 분석·마케팅 도구를 통한 행동 데이터 수집 또는 프로파일링
- 데이터 판매 또는 대여

### 처리하는 로컬 데이터

Textox는 사용자의 기기에서 다음 데이터만 로컬로 처리합니다：

- **Markdown 문서 콘텐츠**: 생성 및 편집한 문서는 완전히 사용자의 기기에 저장됩니다
- **최근 열린 파일 목록**: "최근 파일" 기능을 제공하기 위해 로컬에 저장
- **앱 설정**: 테마 설정, 편집기 설정 등, 로컬에 저장
- **저장되지 않은 변경사항**: 충돌 복구를 위해 일시적으로 로컬에 저장

## 충돌 진단 정보

Textox는 충돌 진단을 위해 문서 콘텐츠를 업로드하지 않습니다. 다만 앱이 충돌하거나 심각한 오류가 발생할 경우 문제를 파악하고 수정하기 위해 다음과 같은 진단 정보를 제3자 충돌 보고 서비스인 Sentry(sentry.io)로 자동 전송할 수 있으며, 이 데이터는 Sentry의 EU 데이터 센터(독일)에 저장됩니다:

- 충돌 원인 및 오류 메시지
- 충돌 발생 위치의 스택 트레이스(코드 파일, 함수 이름, 줄 번호)
- 앱 버전, 운영 체제, 기기 아키텍처 등 기본 환경 정보
- 충돌 발생 시각

이 진단 정보에는 문서 콘텐츠가 포함되지 않습니다. 충돌 진단 및 수정에만 사용되며 광고, 마케팅 분석, 프로파일링에는 사용되지 않습니다. Sentry는 자사의 [개인정보 처리방침](https://sentry.io/privacy/)에 따라 이 데이터를 처리합니다(현재 요금제 기준 진단 데이터는 30일간 보관됩니다).

## AI 기능 및 제3자 모델 서비스

AI 설명과 AI 번역은 사용자가 직접 설정해야 하는 선택 기능입니다. 설정에서 모델 서비스와 API 키를 입력하고 텍스트를 선택해 "설명" 또는 "번역"을 실행하거나 "연결 테스트"를 클릭할 때만 앱이 모델 서비스에 요청을 보냅니다. API 키가 설정되지 않았거나 AI 플러그인이 비활성화된 경우 앱은 AI 요청을 보내지 않습니다.

이 기능을 사용하면 앱은 다음 내용을 선택한 모델 서비스로 직접 전송합니다:

- 선택한 텍스트(최대 4,000자)
- 선택 항목이 포함된 문단(최대 2,000자)
- 현재 내용이 속한 제목 계층
- 결과 생성을 위한 프롬프트

위 목록은 현재 기능이 전송하는 내용입니다. 향후 문서 전체, 사용자가 지정한 파일 또는 작업 공간의 문서를 읽는 기능이 추가되면 해당 기능을 처음 사용하기 전에 전송 범위를 안내하고 다시 동의를 받습니다.

"연결 테스트"는 연결 확인을 위한 짧은 요청(ping)만 전송합니다.

요청은 사용자의 기기에서 서비스의 API 엔드포인트(OpenAI, DeepSeek 또는 입력한 사용자 지정 OpenAI 호환 서비스)로 직접 전송되며 당사 서버를 거치지 않습니다. 당사는 이 내용을 수신, 저장 또는 분석하지 않습니다. 서비스의 데이터 처리 방식(학습 이용 여부, 로그 보관 기간 등)은 해당 서비스의 개인정보 처리방침을 따릅니다. 기능을 활성화하기 전에 확인하시기 바랍니다:

- [OpenAI 개인정보 처리방침](https://openai.com/policies/privacy-policy)
- [DeepSeek 개인정보 처리방침](https://cdn.deepseek.com/policies/zh-CN/deepseek-privacy-policy.html)

사용자 지정 서비스를 사용하는 경우 해당 서비스의 데이터 처리 방식을 직접 확인하시기 바랍니다.

입력한 API 키는 사용자 기기의 로컬 설정 파일에만(평문으로) 저장되며 선택한 서비스로 요청을 보내는 데 사용됩니다. 당사는 이 키를 업로드하거나 수집하지 않습니다. 기기와 설정 파일을 안전하게 관리하시기 바랍니다. 설정에서 API 키를 삭제하거나 AI 플러그인을 비활성화할 수 있으며, 비활성화하면 앱은 더 이상 AI 요청을 보내지 않습니다.

## 파일 시스템 접근

Textox는 다음을 위해 파일 시스템 접근이 필요합니다：

- 선택한 Markdown 파일 열기
- 문서를 지정한 위치에 저장
- 작업 디렉토리 관리

**중요한 참고사항**：
- 모든 파일 작업에는 명시적인 승인이 필요합니다
- 선택하지 않은 파일에는 접근하지 않습니다
- 사용자가 AI 기능을 직접 사용할 때만 앱이 해당 기능에 필요한 문서 콘텐츠를 지정한 서비스로 전송합니다. 그 외의 경우 문서 콘텐츠는 기기를 떠나지 않습니다

## 네트워크 접근

Textox는 다음 상황에서만 네트워크를 사용합니다：

- 온라인 이미지 로드(문서에 네트워크 이미지 링크가 포함된 경우에만)
- 앱 업데이트 확인(선택적 기능)
- 앱 충돌 시 충돌 진단 정보 전송(위 "충돌 진단 정보" 참조)
- AI 설명, AI 번역 또는 "연결 테스트"를 직접 사용할 때 선택·설정한 모델 서비스로 요청 전송(위 "AI 기능 및 제3자 모델 서비스" 참조)

## 데이터 보안

- 문서, 설정 등 데이터는 기본적으로 로컬 기기에만 저장됩니다
- Apple의 샌드박스 기술을 사용하여 파일을 보호합니다
- 데이터는 충돌 진단 시 또는 사용자가 AI 기능을 직접 사용할 때만 외부로 전송되며, AI 기능이 실행되지 않을 때는 문서나 설정이 업로드되지 않습니다
- AI API 키는 로컬 설정 파일에 평문으로 저장됩니다. 기기와 설정 파일을 안전하게 관리하시기 바랍니다

## 제3자 서비스

Textox에는 제3자 광고, 추적 또는 마케팅 분석 서비스가 포함되어 있지 않습니다. 충돌 진단은 제3자 서비스인 Sentry(sentry.io)가 제공하며 데이터는 Sentry의 EU 데이터 센터(독일)에 저장됩니다. 자세한 내용은 위 "충돌 진단 정보"를 참조하세요. AI 기능은 사용자가 선택하고 설정한 모델 서비스가 제공하며, 내용은 해당 서비스로 직접 전송됩니다. 자세한 내용은 위 "AI 기능 및 제3자 모델 서비스"를 참조하세요.

## 어린이 개인정보

Textox는 13세 미만 어린이로부터 의도적으로 정보를 수집하지 않습니다.

## 개인정보 처리방침 변경

우리는 본 개인정보 처리방침을 수시로 업데이트할 수 있습니다. 변경사항은 앱 업데이트 시 알려드립니다.

## 문의하기

본 개인정보 처리방침에 대해 질문이 있으시면 다음 방법으로 문의해 주세요：

- 이메일: hi@textox.cn

## 사용자의 권리

Textox는 개인 데이터를 수집하지 않으므로 데이터 접근, 수정, 삭제를 요청할 필요가 없습니다. 모든 데이터는 사용자가 완전히 제어하며 사용자의 기기에 저장됩니다. 설정에서 AI API 키를 삭제하거나, AI 플러그인을 비활성화하거나, 로컬 설정 파일을 삭제하여 관련 데이터를 언제든지 제거할 수 있습니다.

---

**마지막 업데이트: 2026년 11월 1일**
`,
};

// 获取默认隐私政策内容
export function getDefaultPrivacy(language: string): string {
  // 尝试精确匹配
  if (DEFAULT_PRIVACY[language]) {
    return DEFAULT_PRIVACY[language];
  }

  // 尝试匹配语言前缀（如 'zh' 匹配 'zh-CN'）
  const langPrefix = language.split('-')[0];
  const matchedKey = Object.keys(DEFAULT_PRIVACY).find(key =>
    key.startsWith(langPrefix)
  );
  if (matchedKey) {
    return DEFAULT_PRIVACY[matchedKey];
  }

  // 默认返回英文
  return DEFAULT_PRIVACY['en-US'];
}
