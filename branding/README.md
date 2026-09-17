# 拾迹图标

0.1.1 使用折叠纸页形成的 S 形轨迹。浅瓷色背景、钴蓝外侧和冰蓝折面延续应用的玻璃材质。

图像使用内置 **imagegen** 生成和编辑，未使用 CLI 或外部模型。三个阶段的完整提示词保存在 [imagegen-prompts.md](imagegen-prompts.md)。

- `icon-artwork.png`：生成的完整图标原图。
- `icon-foreground.png`：由 imagegen 提取的透明前景。
- `icon.png`：512 像素的标准应用图标。

运行 `cd app && node scripts/icons.mjs` 可重新生成应用内 PNG、五档桌面图标、圆形图标及 Android 自适应前景。脚本只负责尺寸适配、系统裁切和格式转换，不重新绘制主符号。

自适应前景在 108 dp 画布中占高 48 dp，主体位于系统的 66 dp 安全圆内。单色主题使用同一前景的 alpha 轮廓，颜色由 Android 主题提供。
