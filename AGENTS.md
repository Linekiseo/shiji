# 拾迹维护约定

- `app/` 是 Android 正式项目。保持两步记录、直接勾选完成、主任务＋一层子任务及统一进展历史。
- 界面采用浅色玻璃材质，正文清晰优先；不添加冗余状态标签或将完成事项强制拆成另一页。
- 新增入口明确呈现分类，图片、拍照、录音和文字共用保存路径；进展和子任务继承主任务分类。
- 数据保存在设备本地。修改数据结构时保留旧备份兼容性，不重置已有记录，不把附件写入公开仓库。
- 核心验证：`cd app && npm test && npm run build`；Android 改动额外运行 `:app:lintDebug`、适用的设备测试，并区分模拟器与真机证据。
- 发布签名密钥、密码、个人记录、录音与图片不得提交。GitHub Release 只上传签名 APK、校验文件和发布说明。
- 图标由 imagegen 生成，源文件为 `branding/icon-artwork.png` 与透明的 `branding/icon-foreground.png`；运行 `cd app && node scripts/icons.mjs` 更新 Android 自适应图标与各尺寸 PNG。不得用旧的勾选符号覆盖新图标。
- `prototype/` 仅是本机设计预览，不参与正式构建或发行。不要改变其受保护的设备运行时。
