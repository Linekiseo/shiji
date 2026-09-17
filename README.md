<p align="center"><img src="branding/icon.png" width="112" alt="拾迹图标" /></p>
<h1 align="center">拾迹 · Shiji</h1>
<p align="center">记录工作，留住进展。</p>

一个个人使用的 Android 工作记录工具。把待办、子任务、处理记录与图片录音放在同一件工作里，按日、周、月回看。

[下载 APK](https://github.com/Linekiseo/shiji/releases/latest) · [反馈问题](https://github.com/Linekiseo/shiji/issues) · [MIT License](LICENSE)

## 已有功能

- 文字快速记录；图片选择、系统相机拍摄、麦克风录音与回放。
- 勾选完成、撤销、未开始／进行中／已完成；主任务与一层子任务联动。
- 工作台按天折叠；待办清单提供分类、时间线两种视图。
- 自定义分类、16 种图标、6 种颜色；新记录显示分类，子任务继承主任务分类。
- 日／周／月回顾，分别统计新增、完成、状态变化和进展。
- 全文搜索、回收站、取消跟进、包含附件的完整 JSON 备份与恢复。
- 离线使用，无账号、广告、统计 SDK。数据保存在设备应用私有目录。

首版录音保存为音频附件；**尚未接入语音转写和 AI 语义整理**。系统相机与相册由 Android 提供。卸载应用会删除本地记录，换机前请在“更多功能 → 数据与备份”导出完整备份。

## 开发与构建

应用使用 React、TypeScript、Vite 与 Capacitor Android。`prototype/` 是本地设计稿，未加入发行仓库；`app/` 是可独立构建的正式项目。

安装需要 Android 9 或更新版本及近期更新的 Android System WebView。构建需要 Node.js 22+、JDK 21、Android SDK 36。首次构建需要网络下载依赖。

```sh
cd app
npm ci
npm test
npm run dev                 # 浏览器预览，使用 IndexedDB 保存
npm run android:sync        # 编译前端并同步安卓工程
cd android
./gradlew assembleDebug     # 本地调试包
```

Android SDK 路径通过 `ANDROID_HOME` 或未入库的 `app/android/local.properties` 设置。JDK 使用 `JAVA_HOME`。调试 APK 位于 `app/android/app/build/outputs/apk/debug/`。

正式版本采用独立发布证书签名，密钥不入库。构建签名版本需要设置 `SHIJI_KEYSTORE`、`SHIJI_STORE_PASSWORD`、`SHIJI_KEY_ALIAS`、`SHIJI_KEY_PASSWORD` 后运行 `./gradlew assembleRelease`。没有发布证书时可构建自己的调试版，不能覆盖官方签名版本。

## 项目结构

```text
app/src/WorkApp.tsx       记录、清单、分类、详情和回顾
app/src/mobile.tsx       原生滚动、系统键盘与返回键适配
app/src/storage.ts       原生文件持久化／浏览器 IndexedDB
app/src/native.ts        相机、相册与系统分享
app/android/             原生 Android 工程
app/tests/               备份边界、时间与数据契约测试
branding/                图标原图、透明前景与生成提示词
docs/                    产品与发布说明
```

Android 采用 `AtomicFile` 写入任务快照，图片和录音单独存放，避免普通文本操作重复写大文件。页面刷新和应用重启不会恢复示例数据。导入备份先校验完整数据再合并，并可撤销。

## 图标与授权

图标由 imagegen 生成，以折叠纸页构成 S 形轨迹，蓝色玻璃质感呼应应用界面。Android 提供自适应图标及单色主题图标，并保留圆形裁切的安全区域。原始图像与提示词见 [branding](branding/README.md)。图标、应用代码和项目原创背景随仓库按 MIT 开源。第三方组件分别遵循其原有许可，见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
